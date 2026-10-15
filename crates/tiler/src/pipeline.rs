//! Pipeline genérico: tabela → agregação H3 por zoom + pontos individuais → PMTiles.
//!
//! Contrato de saída (metadados `pinny` versão 2, consumido pelo @pinny/engine):
//! - layer `hex`, zooms 0..=HEX_MAX_ZOOM: polígonos H3 com `n` (total), `a` (área km²) e
//!   `c0`..`cN` (contagem por categoria de cor; omitida quando zero)
//! - layer `points`, zooms POINTS_MIN_ZOOM..=POINTS_ZOOM (overzoom acima): id da feição = id da linha (1..);
//!   `_c` = índice da categoria de cor; colunas numéricas e categóricas pelo nome. Abaixo de POINTS_ZOOM,
//!   tile com mais de POINT_BUDGET pontos fica com um ponto por célula de uma grade 256×256 (só `_c`):
//!   as bolinhas continuam mostrando onde há dado; os números exatos vêm dos hexágonos.
//! - `rows.idx`: posição (u64 LE) de cada linha no CSV de origem, indexada por id - 1

use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{BufWriter, Write},
    path::Path,
};

use h3o::{CellIndex, Resolution};
use rayon::prelude::*;
use serde::Serialize;
use serde_json::json;

use crate::{
    clock::Stopwatch,
    mercator::{self, EXTENT_BITS},
    mvt::{LayerBuilder, Value},
    pmtiles::{self, HeaderInfo, Writer},
    regions::{self, RegionLevel},
    table::{ColumnData, Error, NO_CATEGORY, ReadStats, Table},
};

pub const HEX_MAX_ZOOM: u8 = 13;
pub const POINTS_ZOOM: u8 = 14;
/// Pontos desde o mundo inteiro: planilhas pequenas aparecem como bolinhas em qualquer zoom.
pub const POINTS_MIN_ZOOM: u8 = 0;
/// Acima disso (por tile, abaixo de POINTS_ZOOM) os pontos são rarefeitos pela grade.
const POINT_BUDGET: usize = 5_000;
/// Grade de rarefação: 2^8 = 256 células por lado do tile (~1 px num tile de 256 px).
const GRID_BITS: u32 = 8;
/// Resolução H3 usada em cada zoom 0..=13 (hexágono com ~15–40 px de lado na tela).
pub const ZOOM_RESOLUTION: [u8; HEX_MAX_ZOOM as usize + 1] = [1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 6, 6, 7, 8];
pub const FINEST_RESOLUTION: Resolution = Resolution::Eight;

/// Categorias de cor + "Outros".
const K: usize = crate::table::MAX_COLOR_CATEGORIES + 1;
const COUNT_KEYS: [&str; K] = ["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10"];
/// Tiles codificados em paralelo por lote antes de gravar (limita memória).
const WRITE_BATCH: usize = 4096;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Stage {
    Reading,
    Indexing,
    Tiling,
    Writing,
}

#[derive(Clone, Copy, Default)]
struct Agg {
    n: u32,
    by: [u32; K],
}

impl Agg {
    fn merge(&mut self, o: &Agg) {
        self.n += o.n;
        self.by.iter_mut().zip(o.by).for_each(|(a, b)| *a += b);
    }
}

struct Hex {
    ring: Vec<(i64, i64)>,
    bbox: [i64; 4],
    agg: Agg,
    area_km2: f32,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoomStats {
    pub zoom: u8,
    pub tiles: usize,
    pub features: usize,
    pub bytes: usize,
    pub max_raw: usize,
    pub max_gz: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: &'static str,
    /// Menor e maior valor (colunas de número): escala de cor e de tamanho no editor de estilo.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub records: usize,
    pub stats: ReadStats,
    pub bounds: [f64; 4],
    pub categories: Vec<String>,
    pub color_by: Option<String>,
    /// Colunas presentes nos tiles de pontos.
    pub tile_columns: Vec<ColumnInfo>,
    pub zooms: Vec<ZoomStats>,
    pub timings: Vec<(&'static str, f64)>,
    pub tiles_bytes: u64,
    /// Registros tirados pelo recorte (`clip_to`).
    pub clipped: u64,
}

fn aggregate_finest(t: &Table) -> HashMap<u64, Agg> {
    t.cells
        .par_iter()
        .zip(t.category.par_iter())
        .fold(HashMap::new, |mut map: HashMap<u64, Agg>, (&cell, &cat)| {
            let a = map.entry(cell).or_default();
            a.n += 1;
            if cat != NO_CATEGORY {
                a.by[cat as usize] += 1;
            }
            map
        })
        .reduce(HashMap::new, |a, b| {
            let (mut big, small) = if a.len() >= b.len() { (a, b) } else { (b, a) };
            for (k, v) in small {
                big.entry(k).or_default().merge(&v);
            }
            big
        })
}

fn aggregate_parent(children: &HashMap<u64, Agg>, res: Resolution) -> HashMap<u64, Agg> {
    let mut out: HashMap<u64, Agg> = HashMap::with_capacity(children.len() / 5);
    for (&cell, agg) in children {
        let Ok(c) = CellIndex::try_from(cell) else { continue };
        if let Some(parent) = c.parent(res) {
            out.entry(u64::from(parent)).or_default().merge(agg);
        }
    }
    out
}

fn to_hexes(map: &HashMap<u64, Agg>) -> Vec<Hex> {
    map.par_iter()
        .filter_map(|(&cell, &agg)| {
            let cell = CellIndex::try_from(cell).ok()?;
            let ring: Vec<(i64, i64)> = cell
                .boundary()
                .iter()
                .map(|ll| {
                    let (x, y) = mercator::project_f64(ll.lng(), ll.lat());
                    (x as i64, y as i64)
                })
                .collect();
            let bbox = ring.iter().fold([i64::MAX, i64::MAX, i64::MIN, i64::MIN], |b, &(x, y)| {
                [b[0].min(x), b[1].min(y), b[2].max(x), b[3].max(y)]
            });
            Some(Hex { ring, bbox, agg, area_km2: cell.area_km2() as f32 })
        })
        .collect()
}

fn gzip_layer(layer: &LayerBuilder) -> (Vec<u8>, usize) {
    let mut raw = Vec::new();
    layer.write_to(&mut raw);
    (pmtiles::gzip(&raw), raw.len())
}

type Pair = (u64, u32, u32, u32);

fn write_groups<F>(writer: &mut Writer, pairs: &[Pair], zoom: u8, encode: F) -> Result<ZoomStats, Error>
where
    F: Fn(u32, u32, &[Pair]) -> Option<(Vec<u8>, usize, usize)> + Sync,
{
    let groups: Vec<&[Pair]> = pairs.chunk_by(|a, b| a.0 == b.0).collect();
    let mut stats = ZoomStats { zoom, ..Default::default() };
    for batch in groups.chunks(WRITE_BATCH) {
        let encoded: Vec<Option<(u64, Vec<u8>, usize, usize)>> = batch
            .par_iter()
            .map(|g| encode(g[0].1, g[0].2, g).map(|(gz, raw, n)| (g[0].0, gz, raw, n)))
            .collect();
        for (id, gz, raw, features) in encoded.into_iter().flatten() {
            writer.add_tile(id, &gz)?;
            stats.tiles += 1;
            stats.features += features;
            stats.bytes += gz.len();
            stats.max_raw = stats.max_raw.max(raw);
            stats.max_gz = stats.max_gz.max(gz.len());
        }
    }
    Ok(stats)
}

fn hex_pairs(hexes: &[Hex], z: u8) -> Vec<Pair> {
    let max_tile = (1i64 << z) - 1;
    let mut pairs: Vec<Pair> = hexes
        .par_iter()
        .enumerate()
        .flat_map_iter(|(i, h)| {
            let tx0 = mercator::tile_index(h.bbox[0], z).clamp(0, max_tile);
            let ty0 = mercator::tile_index(h.bbox[1], z).clamp(0, max_tile);
            let tx1 = mercator::tile_index(h.bbox[2], z).clamp(0, max_tile);
            let ty1 = mercator::tile_index(h.bbox[3], z).clamp(0, max_tile);
            (tx0..=tx1).flat_map(move |tx| {
                (ty0..=ty1).map(move |ty| (pmtiles::tile_id(z, tx as u32, ty as u32), tx as u32, ty as u32, i as u32))
            })
        })
        .collect();
    pairs.par_sort_unstable();
    pairs
}

/// Camada `hex` de um tile, já codificada (sem gzip); None se ficou vazia.
fn encode_hex(hexes: &[Hex], group: &[Pair], tx: u32, ty: u32, z: u8) -> Option<(Vec<u8>, usize)> {
    let mut layer = LayerBuilder::new("hex");
    let mut ring = Vec::with_capacity(7);
    let mut props: Vec<(&str, Value)> = Vec::with_capacity(2 + K);
    for &(_, _, _, idx) in group {
        let h = &hexes[idx as usize];
        ring.clear();
        ring.extend(h.ring.iter().map(|&(x, y)| (mercator::to_local(x, tx as i64, z), mercator::to_local(y, ty as i64, z))));
        props.clear();
        props.push(("n", Value::UInt(h.agg.n as u64)));
        props.push(("a", Value::Float(h.area_km2)));
        for (key, &count) in COUNT_KEYS.iter().zip(&h.agg.by) {
            if count > 0 {
                props.push((key, Value::UInt(count as u64)));
            }
        }
        layer.add_polygon(None, &mut ring, &props);
    }
    if layer.is_empty() {
        return None;
    }
    let mut raw = Vec::new();
    layer.write_to(&mut raw);
    Some((raw, layer.len()))
}

/// Pares (tile, índice da linha) dos pontos num zoom.
fn point_pairs(t: &Table, indices: &[u32], z: u8) -> Vec<Pair> {
    let shift = 32 - z as u32;
    let mut pairs: Vec<Pair> = indices
        .par_iter()
        .map(|&i| {
            let (tx, ty) = ((t.x[i as usize] as u64 >> shift) as u32, (t.y[i as usize] as u64 >> shift) as u32);
            (pmtiles::tile_id(z, tx, ty), tx, ty, i)
        })
        .collect();
    pairs.par_sort_unstable();
    pairs
}

/// Camada `points` de um tile (sem gzip). `full`: com todas as colunas; senão só a categoria (tile rarefeito).
fn encode_points(t: &Table, group: &[Pair], tx: u32, ty: u32, z: u8, full: bool) -> (Vec<u8>, usize) {
    let shift = 32 - z as u32;
    let local_shift = shift - EXTENT_BITS;
    let mut layer = LayerBuilder::new("points");
    let mut props: Vec<(&str, Value)> = Vec::with_capacity(1 + t.columns.len());
    for &(_, _, _, idx) in group {
        let i = idx as usize;
        let x = ((t.x[i] as u64 - ((tx as u64) << shift)) >> local_shift) as i32;
        let y = ((t.y[i] as u64 - ((ty as u64) << shift)) >> local_shift) as i32;
        props.clear();
        if t.category[i] != NO_CATEGORY {
            props.push(("_c", Value::UInt(t.category[i] as u64)));
        }
        if full {
            for col in &t.columns {
                match &col.data {
                    ColumnData::Number(v) if !v[i].is_nan() => props.push((&col.name, Value::Double(v[i]))),
                    ColumnData::Category { ids, dict } if ids[i] != u32::MAX => props.push((&col.name, Value::Str(&dict[ids[i] as usize]))),
                    ColumnData::Text(v) if !v[i].is_empty() => props.push((&col.name, Value::Str(&v[i]))),
                    _ => {}
                }
            }
        }
        layer.add_point(Some(i as u64 + 1), x, y, &props);
    }
    let mut raw = Vec::new();
    layer.write_to(&mut raw);
    (raw, layer.len())
}

/// Pontos de um zoom abaixo de POINTS_ZOOM, a partir dos do zoom de cima: tile que passa de POINT_BUDGET (ou que
/// já veio rarefeito) fica com um ponto por célula da grade. Devolve os índices, se cada um veio de tile
/// rarefeito, e os tiles rarefeitos (gravados só com a categoria).
fn thin_points(t: &Table, from: &[u32], from_lossy: &[bool], z: u8) -> (Vec<u32>, Vec<bool>, HashSet<u64>) {
    let shift = 32 - z as u32;
    let cell_shift = shift - GRID_BITS;
    let mask = (1u64 << GRID_BITS) - 1;
    let mut items: Vec<(u64, u32, u32, bool)> = from
        .par_iter()
        .zip(from_lossy.par_iter())
        .map(|(&i, &lossy)| {
            let (x, y) = (t.x[i as usize] as u64, t.y[i as usize] as u64);
            let tile = pmtiles::tile_id(z, (x >> shift) as u32, (y >> shift) as u32);
            let cell = ((((x >> cell_shift) & mask) << GRID_BITS) | ((y >> cell_shift) & mask)) as u32;
            (tile, cell, i, lossy)
        })
        .collect();
    items.par_sort_unstable_by_key(|it| (it.0, it.1, it.2));
    let mut out = Vec::with_capacity(items.len());
    let mut out_lossy = Vec::with_capacity(items.len());
    let mut lossy_tiles = HashSet::new();
    for group in items.chunk_by(|a, b| a.0 == b.0) {
        let crowded = group.len() > POINT_BUDGET;
        if crowded || group.iter().any(|it| it.3) {
            lossy_tiles.insert(group[0].0);
        }
        if crowded {
            for cell in group.chunk_by(|a, b| a.1 == b.1) {
                out.push(cell[0].2);
                out_lossy.push(true);
            }
        } else {
            for it in group {
                out.push(it.2);
                out_lossy.push(it.3);
            }
        }
    }
    (out, out_lossy, lossy_tiles)
}

/// Um zoom com hexágonos e pontos no mesmo tile (o PMTiles guarda um tile por z/x/y).
fn mixed_zoom(writer: &mut Writer, t: &Table, hexes: &[Hex], points: &[u32], lossy: &HashSet<u64>, z: u8) -> Result<ZoomStats, Error> {
    let hp = hex_pairs(hexes, z);
    let pp = point_pairs(t, points, z);
    let hg: Vec<&[Pair]> = hp.chunk_by(|a, b| a.0 == b.0).collect();
    let pg: Vec<&[Pair]> = pp.chunk_by(|a, b| a.0 == b.0).collect();
    // União ordenada pelos ids de tile.
    let mut tiles: Vec<(u64, u32, u32, Option<&[Pair]>, Option<&[Pair]>)> = Vec::with_capacity(hg.len().max(pg.len()));
    let (mut i, mut j) = (0, 0);
    while i < hg.len() || j < pg.len() {
        let hid = hg.get(i).map(|g| g[0].0);
        let pid = pg.get(j).map(|g| g[0].0);
        match (hid, pid) {
            (Some(a), Some(b)) if a == b => {
                tiles.push((a, hg[i][0].1, hg[i][0].2, Some(hg[i]), Some(pg[j])));
                i += 1;
                j += 1;
            }
            (Some(a), Some(b)) if a < b => {
                tiles.push((a, hg[i][0].1, hg[i][0].2, Some(hg[i]), None));
                i += 1;
            }
            (Some(a), None) => {
                tiles.push((a, hg[i][0].1, hg[i][0].2, Some(hg[i]), None));
                i += 1;
            }
            (_, Some(b)) => {
                tiles.push((b, pg[j][0].1, pg[j][0].2, None, Some(pg[j])));
                j += 1;
            }
            (None, None) => break,
        }
    }
    let mut stats = ZoomStats { zoom: z, ..Default::default() };
    for batch in tiles.chunks(WRITE_BATCH) {
        let encoded: Vec<Option<(u64, Vec<u8>, usize, usize)>> = batch
            .par_iter()
            .map(|&(id, tx, ty, h, p)| {
                let mut raw = Vec::new();
                let mut features = 0;
                if let Some((bytes, n)) = h.and_then(|g| encode_hex(hexes, g, tx, ty, z)) {
                    raw.extend_from_slice(&bytes);
                    features += n;
                }
                if let Some(g) = p {
                    let (bytes, n) = encode_points(t, g, tx, ty, z, !lossy.contains(&id));
                    raw.extend_from_slice(&bytes);
                    features += n;
                }
                (!raw.is_empty()).then(|| (id, pmtiles::gzip(&raw), raw.len(), features))
            })
            .collect();
        for (id, gz, raw, features) in encoded.into_iter().flatten() {
            writer.add_tile(id, &gz)?;
            stats.tiles += 1;
            stats.features += features;
            stats.bytes += gz.len();
            stats.max_raw = stats.max_raw.max(raw);
            stats.max_gz = stats.max_gz.max(gz.len());
        }
    }
    Ok(stats)
}

fn points_zoom(writer: &mut Writer, t: &Table) -> Result<ZoomStats, Error> {
    let z = POINTS_ZOOM;
    let shift = 32 - z as u32;
    let mut pairs: Vec<Pair> = t
        .x
        .par_iter()
        .zip(t.y.par_iter())
        .enumerate()
        .map(|(i, (&x, &y))| {
            let (tx, ty) = (x >> shift, y >> shift);
            (pmtiles::tile_id(z, tx, ty), tx, ty, i as u32)
        })
        .collect();
    pairs.par_sort_unstable();

    let local_shift = shift - EXTENT_BITS;
    write_groups(writer, &pairs, z, |tx, ty, group| {
        let mut layer = LayerBuilder::new("points");
        let mut props: Vec<(&str, Value)> = Vec::with_capacity(1 + t.columns.len());
        for &(_, _, _, idx) in group {
            let i = idx as usize;
            let x = ((t.x[i] - (tx << shift)) >> local_shift) as i32;
            let y = ((t.y[i] - (ty << shift)) >> local_shift) as i32;
            props.clear();
            if t.category[i] != NO_CATEGORY {
                props.push(("_c", Value::UInt(t.category[i] as u64)));
            }
            for col in &t.columns {
                match &col.data {
                    ColumnData::Number(v) if !v[i].is_nan() => props.push((&col.name, Value::Double(v[i]))),
                    ColumnData::Category { ids, dict } if ids[i] != u32::MAX => {
                        props.push((&col.name, Value::Str(&dict[ids[i] as usize])))
                    }
                    ColumnData::Text(v) if !v[i].is_empty() => props.push((&col.name, Value::Str(&v[i]))),
                    _ => {}
                }
            }
            layer.add_point(Some(i as u64 + 1), x, y, &props);
        }
        let (gz, raw) = gzip_layer(&layer);
        Some((gz, raw, layer.len()))
    })
}

/// Quebras de densidade (registros/km²) para a escala de cor, a partir das resoluções finas.
fn density_breaks(levels: &[(Resolution, Vec<Hex>)]) -> Vec<f64> {
    let mut d: Vec<f64> = levels
        .iter()
        .filter(|(res, _)| u8::from(*res) >= 6)
        .flat_map(|(_, hexes)| hexes.iter().map(|h| h.agg.n as f64 / h.area_km2 as f64))
        .collect();
    if d.is_empty() {
        return vec![1.0];
    }
    d.par_sort_unstable_by(f64::total_cmp);
    [0.25, 0.5, 0.75, 0.9, 0.97, 0.995]
        .iter()
        .map(|q| (d[((d.len() - 1) as f64 * q) as usize] * 100.0).round() / 100.0)
        .collect()
}

pub struct BuildOptions<'a> {
    pub name: &'a str,
    pub color_by: Option<&'a str>,
    pub title: Option<&'a str>,
    /// Malhas para contar por região (vazio = sem contagem por região).
    pub regions: &'a [RegionLevel],
}

/// Gera `<out_dir>/tiles.pmtiles` (e `rows.idx` quando há posições de linha).
pub fn build(t: &Table, out_dir: &Path, opts: &BuildOptions, progress: &(dyn Fn(Stage, f32) + Sync)) -> Result<Report, Error> {
    let tiles_path = out_dir.join("tiles.pmtiles");
    let (writer, info, metadata, mut report) = build_tiles(t, opts, progress, Writer::create(&tiles_path)?)?;
    let clock = Stopwatch::start();
    writer.finish(&tiles_path, &info, &metadata)?;
    if let Some(offsets) = &t.offsets {
        let mut idx = BufWriter::with_capacity(1 << 20, File::create(out_dir.join("rows.idx"))?);
        for o in offsets {
            idx.write_all(&o.to_le_bytes())?;
        }
        idx.flush()?;
    }
    report.timings.push(("gravação", clock.secs()));
    report.tiles_bytes = std::fs::metadata(&tiles_path)?.len();
    progress(Stage::Writing, 1.0);
    Ok(report)
}

/// O mesmo PMTiles, inteiro em memória (sem sistema de arquivos) — para rodar no navegador (WASM).
pub fn build_in_memory(t: &Table, opts: &BuildOptions, progress: &(dyn Fn(Stage, f32) + Sync)) -> Result<(Vec<u8>, Report), Error> {
    let (writer, info, metadata, mut report) = build_tiles(t, opts, progress, Writer::in_memory())?;
    let bytes = writer.finish_to_vec(&info, &metadata)?;
    report.tiles_bytes = bytes.len() as u64;
    progress(Stage::Writing, 1.0);
    Ok((bytes, report))
}

/// Agregação, tiles de hexágonos e de pontos e os metadados; quem chama grava (arquivo ou memória).
fn build_tiles(
    t: &Table,
    opts: &BuildOptions,
    progress: &(dyn Fn(Stage, f32) + Sync),
    mut writer: Writer,
) -> Result<(Writer, HeaderInfo, serde_json::Value, Report), Error> {
    let mut timings = Vec::new();
    let mut clock = Stopwatch::start();
    let mut lap = |label: &'static str, clock: &mut Stopwatch| {
        timings.push((label, clock.secs()));
        *clock = Stopwatch::start();
    };

    progress(Stage::Indexing, 0.0);
    let mut maps: Vec<(Resolution, HashMap<u64, Agg>)> = vec![(FINEST_RESOLUTION, aggregate_finest(t))];
    let mut resolutions: Vec<u8> = ZOOM_RESOLUTION.to_vec();
    resolutions.sort_unstable();
    resolutions.dedup();
    for &r in resolutions.iter().rev().skip(1) {
        let res = Resolution::try_from(r)?;
        let parent = aggregate_parent(&maps.last().expect("há um nível").1, res);
        maps.push((res, parent));
    }
    let levels: Vec<(Resolution, Vec<Hex>)> = maps.iter().map(|(res, map)| (*res, to_hexes(map))).collect();
    drop(maps);
    let breaks = density_breaks(&levels);
    lap("agregação H3", &mut clock);

    // Pontos de cada zoom, de baixo (mais perto) para cima: cada nível parte do anterior, já rarefeito.
    let mut point_levels: Vec<(Vec<u32>, HashSet<u64>)> = vec![(Vec::new(), HashSet::new()); HEX_MAX_ZOOM as usize + 1];
    let mut from: Vec<u32> = (0..t.len() as u32).collect();
    let mut from_lossy = vec![false; t.len()];
    for z in (POINTS_MIN_ZOOM..=HEX_MAX_ZOOM).rev() {
        let (kept, kept_lossy, lossy_tiles) = thin_points(t, &from, &from_lossy, z);
        point_levels[z as usize] = (kept.clone(), lossy_tiles);
        from = kept;
        from_lossy = kept_lossy;
    }
    drop((from, from_lossy));
    lap("rarefação dos pontos", &mut clock);

    let mut zooms = Vec::new();
    for z in 0..=HEX_MAX_ZOOM {
        progress(Stage::Tiling, z as f32 / (POINTS_ZOOM as f32 + 1.0));
        let res = Resolution::try_from(ZOOM_RESOLUTION[z as usize])?;
        let hexes = &levels.iter().find(|(r, _)| *r == res).expect("nível calculado").1;
        let (points, lossy) = &point_levels[z as usize];
        zooms.push(mixed_zoom(&mut writer, t, hexes, points, lossy, z)?);
        point_levels[z as usize] = (Vec::new(), HashSet::new());
    }
    lap("tiles de hexágonos e pontos", &mut clock);
    progress(Stage::Tiling, 0.9);
    zooms.push(points_zoom(&mut writer, t)?);
    lap("tiles de pontos", &mut clock);

    let region_counts = (!opts.regions.is_empty()).then(|| regions::count(opts.regions, t));
    if region_counts.is_some() {
        lap("contagem por região", &mut clock);
    }

    progress(Stage::Writing, 0.0);
    let tile_columns: Vec<ColumnInfo> = t
        .columns
        .iter()
        .map(|c| {
            let (min, max) = match &c.data {
                ColumnData::Number(v) => {
                    let (lo, hi) = v.iter().filter(|x| x.is_finite()).fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), &x| (lo.min(x), hi.max(x)));
                    if lo <= hi { (Some(lo), Some(hi)) } else { (None, None) }
                }
                _ => (None, None),
            };
            ColumnInfo {
                name: c.name.clone(),
                kind: match c.data {
                    ColumnData::Number(_) => "number",
                    ColumnData::Category { .. } => "category",
                    ColumnData::Text(_) => "text",
                },
                min,
                max,
            }
        })
        .collect();
    let mut point_fields = serde_json::Map::new();
    point_fields.insert("_c".into(), json!("Number"));
    for c in &tile_columns {
        point_fields.insert(c.name.clone(), json!(if c.kind == "number" { "Number" } else { "String" }));
    }
    let hex_fields: serde_json::Map<String, serde_json::Value> =
        ["n", "a"].iter().chain(COUNT_KEYS.iter()).map(|k| (k.to_string(), json!("Number"))).collect();
    let metadata = json!({
        "name": opts.name,
        "format": "pbf",
        "type": "overlay",
        "generator": "pinny-tiler",
        "vector_layers": [
            { "id": "hex", "fields": hex_fields, "minzoom": 0, "maxzoom": HEX_MAX_ZOOM },
            { "id": "points", "fields": point_fields, "minzoom": POINTS_MIN_ZOOM, "maxzoom": POINTS_ZOOM },
        ],
        "pinny": {
            "version": 2,
            "records": t.len(),
            "hexMaxZoom": HEX_MAX_ZOOM,
            "pointsZoom": POINTS_ZOOM,
            "pointsMinZoom": POINTS_MIN_ZOOM,
            "zoomResolutions": ZOOM_RESOLUTION,
            "densityBreaks": breaks,
            "categoryProperty": "_c",
            "categoryCountPrefix": "c",
            "categories": t.categories,
            "colorBy": opts.color_by,
            "title": opts.title,
            "columns": tile_columns,
            "bounds": t.bounds,
            "hasRowIndex": t.offsets.is_some(),
            "regions": region_counts,
        },
    });
    let info = HeaderInfo { min_zoom: 0, max_zoom: POINTS_ZOOM, bounds: t.bounds, center_zoom: 4 };
    lap("metadados", &mut clock);

    let report = Report {
        records: t.len(),
        stats: t.stats.clone(),
        bounds: t.bounds,
        categories: t.categories.clone(),
        color_by: opts.color_by.map(str::to_owned),
        tile_columns,
        zooms,
        timings,
        tiles_bytes: 0,
        clipped: 0,
    };
    Ok((writer, info, metadata, report))
}
