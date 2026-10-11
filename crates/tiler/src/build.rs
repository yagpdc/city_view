//! Pipeline: dataset → agregação H3 por zoom + pontos individuais → PMTiles.
//!
//! Contrato de saída (consumido pelo @cityview/sdk):
//! - layer `hex`, zooms 0..=HEX_MAX_ZOOM: polígonos H3 com `n` (total), `a` (área km²) e
//!   `s0`..`s9` (contagem por setor; omitida quando zero)
//! - layer `points`, zoom POINTS_ZOOM (overzoom acima): id da feature = id do registro,
//!   propriedades `sector`, `size`, `year`
//! - metadados `cityview` com quebras de densidade para a escala de cor

use std::{collections::HashMap, path::Path, time::Instant};

use h3o::{CellIndex, Resolution};
use rayon::prelude::*;
use serde_json::json;

use crate::{
    dataset::{Dataset, NUM_SECTORS},
    mercator::{self, EXTENT_BITS},
    mvt::{LayerBuilder, Value},
    pmtiles::{self, HeaderInfo, Writer},
};

pub const HEX_MAX_ZOOM: u8 = 13;
pub const POINTS_ZOOM: u8 = 14;
/// Resolução H3 usada em cada zoom 0..=13 (hexágono com ~15–40 px de lado na tela).
pub const ZOOM_RESOLUTION: [u8; HEX_MAX_ZOOM as usize + 1] = [1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 6, 6, 7, 8];
pub const FINEST_RESOLUTION: Resolution = Resolution::Eight;

const SECTOR_KEYS: [&str; NUM_SECTORS] = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"];
/// Tiles codificados em paralelo por lote antes de gravar (limita memória).
const WRITE_BATCH: usize = 4096;

#[derive(Clone, Copy, Default)]
struct Agg {
    n: u32,
    sectors: [u32; NUM_SECTORS],
}

impl Agg {
    fn merge(&mut self, other: &Agg) {
        self.n += other.n;
        self.sectors.iter_mut().zip(other.sectors).for_each(|(a, b)| *a += b);
    }
}

struct Hex {
    /// Vértices em coordenadas de mundo.
    ring: Vec<(i64, i64)>,
    bbox: [i64; 4],
    agg: Agg,
    area_km2: f32,
}

#[derive(Default)]
pub struct ZoomStats {
    pub zoom: u8,
    pub tiles: usize,
    pub features: usize,
    pub bytes: usize,
    pub max_raw: usize,
    pub max_gz: usize,
}

pub struct Report {
    pub records: usize,
    pub skipped: usize,
    pub zooms: Vec<ZoomStats>,
    pub timings: Vec<(&'static str, f64)>,
    pub file_bytes: u64,
}

type Error = Box<dyn std::error::Error + Send + Sync>;

fn aggregate_finest(ds: &Dataset) -> HashMap<u64, Agg> {
    ds.cells
        .par_iter()
        .zip(ds.records.par_iter())
        .fold(HashMap::new, |mut map: HashMap<u64, Agg>, (&cell, r)| {
            let agg = map.entry(cell).or_default();
            agg.n += 1;
            if let Some(s) = agg.sectors.get_mut(r.sector as usize) {
                *s += 1;
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
        let parent = CellIndex::try_from(cell).expect("célula válida").parent(res).expect("resolução menor");
        out.entry(u64::from(parent)).or_default().merge(agg);
    }
    out
}

fn to_hexes(map: &HashMap<u64, Agg>) -> Vec<Hex> {
    map.par_iter()
        .map(|(&cell, &agg)| {
            let cell = CellIndex::try_from(cell).expect("célula válida");
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
            Hex { ring, bbox, agg, area_km2: cell.area_km2() as f32 }
        })
        .collect()
}

fn gzip_layer(layer: &LayerBuilder) -> (Vec<u8>, usize) {
    let mut raw = Vec::new();
    layer.write_to(&mut raw);
    (pmtiles::gzip(&raw), raw.len())
}

/// Grava grupos de (tile id, tx, ty, índice) já ordenados, codificando em paralelo por lote.
fn write_groups<F>(writer: &mut Writer, pairs: &[(u64, u32, u32, u32)], zoom: u8, encode: F) -> Result<ZoomStats, Error>
where
    F: Fn(u32, u32, &[(u64, u32, u32, u32)]) -> Option<(Vec<u8>, usize, usize)> + Sync,
{
    let groups: Vec<&[(u64, u32, u32, u32)]> = pairs.chunk_by(|a, b| a.0 == b.0).collect();
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

fn hex_zoom(writer: &mut Writer, hexes: &[Hex], z: u8) -> Result<ZoomStats, Error> {
    let max_tile = (1i64 << z) - 1;
    let mut pairs: Vec<(u64, u32, u32, u32)> = hexes
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

    write_groups(writer, &pairs, z, |tx, ty, group| {
        let mut layer = LayerBuilder::new("hex");
        let mut ring = Vec::with_capacity(7);
        let mut props: Vec<(&'static str, Value)> = Vec::with_capacity(2 + NUM_SECTORS);
        for &(_, _, _, idx) in group {
            let h = &hexes[idx as usize];
            ring.clear();
            ring.extend(h.ring.iter().map(|&(x, y)| {
                (mercator::to_local(x, tx as i64, z), mercator::to_local(y, ty as i64, z))
            }));
            props.clear();
            props.push(("n", Value::UInt(h.agg.n as u64)));
            props.push(("a", Value::Float(h.area_km2)));
            for (key, &count) in SECTOR_KEYS.iter().zip(&h.agg.sectors) {
                if count > 0 {
                    props.push((key, Value::UInt(count as u64)));
                }
            }
            layer.add_polygon(None, &mut ring, &props);
        }
        (!layer.is_empty()).then(|| {
            let (gz, raw) = gzip_layer(&layer);
            (gz, raw, layer.len())
        })
    })
}

fn points_zoom(writer: &mut Writer, ds: &Dataset) -> Result<ZoomStats, Error> {
    let z = POINTS_ZOOM;
    let shift = 32 - z as u32;
    let mut pairs: Vec<(u64, u32, u32, u32)> = ds
        .records
        .par_iter()
        .enumerate()
        .map(|(i, r)| {
            let (tx, ty) = (r.x >> shift, r.y >> shift);
            (pmtiles::tile_id(z, tx, ty), tx, ty, i as u32)
        })
        .collect();
    pairs.par_sort_unstable();

    let local_shift = shift - EXTENT_BITS;
    write_groups(writer, &pairs, z, |tx, ty, group| {
        let mut layer = LayerBuilder::new("points");
        for &(_, _, _, idx) in group {
            let r = &ds.records[idx as usize];
            let x = ((r.x - (tx << shift)) >> local_shift) as i32;
            let y = ((r.y - (ty << shift)) >> local_shift) as i32;
            layer.add_point(
                Some(r.id as u64),
                x,
                y,
                &[
                    ("sector", Value::UInt(r.sector as u64)),
                    ("size", Value::UInt(r.size as u64)),
                    ("year", Value::UInt(r.year as u64)),
                ],
            );
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
    d.par_sort_unstable_by(f64::total_cmp);
    [0.25, 0.5, 0.75, 0.9, 0.97, 0.995]
        .iter()
        .map(|q| {
            let v = d[((d.len() - 1) as f64 * q) as usize];
            (v * 100.0).round() / 100.0
        })
        .collect()
}

pub fn build(ds: &Dataset, out: &Path, name: &str) -> Result<Report, Error> {
    let mut timings = Vec::new();
    let mut t = Instant::now();
    let mut lap = |label: &'static str, t: &mut Instant| {
        timings.push((label, t.elapsed().as_secs_f64()));
        *t = Instant::now();
    };

    // Agregação: resolução mais fina a partir dos registros, as demais subindo pela hierarquia.
    let mut maps: Vec<(Resolution, HashMap<u64, Agg>)> = vec![(FINEST_RESOLUTION, aggregate_finest(ds))];
    let mut resolutions: Vec<u8> = ZOOM_RESOLUTION.to_vec();
    resolutions.sort_unstable();
    resolutions.dedup();
    for &r in resolutions.iter().rev().skip(1) {
        let res = Resolution::try_from(r)?;
        let parent = aggregate_parent(&maps.last().expect("há um nível").1, res);
        maps.push((res, parent));
    }
    lap("agregação H3", &mut t);

    let levels: Vec<(Resolution, Vec<Hex>)> = maps.iter().map(|(res, map)| (*res, to_hexes(map))).collect();
    drop(maps);
    let breaks = density_breaks(&levels);
    lap("geometria dos hexágonos", &mut t);

    let mut writer = Writer::create(out)?;
    let mut zooms = Vec::new();
    for z in 0..=HEX_MAX_ZOOM {
        let res = Resolution::try_from(ZOOM_RESOLUTION[z as usize])?;
        let hexes = &levels.iter().find(|(r, _)| *r == res).expect("nível calculado").1;
        zooms.push(hex_zoom(&mut writer, hexes, z)?);
    }
    lap("tiles de hexágonos (z0–13)", &mut t);

    zooms.push(points_zoom(&mut writer, ds)?);
    lap("tiles de pontos (z14)", &mut t);

    let fields_hex: serde_json::Map<String, serde_json::Value> = ["n", "a"]
        .iter()
        .chain(SECTOR_KEYS.iter())
        .map(|k| (k.to_string(), json!("Number")))
        .collect();
    let metadata = json!({
        "name": name,
        "format": "pbf",
        "type": "overlay",
        "generator": "cityview-tiler",
        "vector_layers": [
            { "id": "hex", "fields": fields_hex, "minzoom": 0, "maxzoom": HEX_MAX_ZOOM },
            { "id": "points", "fields": { "sector": "Number", "size": "Number", "year": "Number" },
              "minzoom": POINTS_ZOOM, "maxzoom": POINTS_ZOOM },
        ],
        "cityview": {
            "version": 1,
            "records": ds.records.len(),
            "sectors": NUM_SECTORS,
            "hexMaxZoom": HEX_MAX_ZOOM,
            "pointsZoom": POINTS_ZOOM,
            "zoomResolutions": ZOOM_RESOLUTION,
            "densityBreaks": breaks,
        },
    });
    let info = HeaderInfo { min_zoom: 0, max_zoom: POINTS_ZOOM, bounds: ds.bounds, center_zoom: 4 };
    writer.finish(out, &info, &metadata)?;
    lap("gravação do PMTiles", &mut t);

    Ok(Report {
        records: ds.records.len(),
        skipped: ds.skipped,
        zooms,
        timings,
        file_bytes: std::fs::metadata(out)?.len(),
    })
}
