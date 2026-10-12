//! Tabela genérica em memória: o que o pipeline precisa de cada linha válida.
//!
//! Só guardamos o necessário para os tiles (posição, célula H3, categoria de cor e as
//! colunas numéricas/categóricas). Texto livre e datas ficam no arquivo de origem e são
//! lidos sob demanda pela posição de cada linha (`offsets`).

use std::collections::HashMap;

use h3o::{LatLng, Resolution};
use rayon::prelude::*;
use serde::Serialize;

use crate::{
    mercator,
    spec::{ColumnKind, ImportSpec, NumberLocale},
    values::parse_number,
};

pub type Error = Box<dyn std::error::Error + Send + Sync>;

/// Linha sem categoria de cor.
pub const NO_CATEGORY: u8 = u8::MAX;
/// Categorias com cor própria; as demais viram "Outros".
pub const MAX_COLOR_CATEGORIES: usize = 10;
/// Limite de valores distintos guardados por coluna categórica.
const MAX_DISTINCT: usize = 65_536;
const INVALID_SAMPLE: usize = 20;

pub enum ColumnData {
    /// `NaN` = vazio.
    Number(Vec<f64>),
    /// Índice no dicionário; `u32::MAX` = vazio.
    Category { ids: Vec<u32>, dict: Vec<String> },
    /// Texto livre, só nos tiles de pontos (não entra nos hexágonos). `""` = vazio.
    Text(Vec<String>),
}

pub struct TileColumn {
    pub name: String,
    pub data: ColumnData,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum InvalidReason {
    SemCoordenadas,
    CoordenadaInvalida,
    ForaDoMundo,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadStats {
    pub rows: u64,
    pub invalid: u64,
    pub sem_coordenadas: u64,
    pub coordenada_invalida: u64,
    pub fora_do_mundo: u64,
    pub outside_brazil: u64,
    /// (linha na planilha, motivo)
    pub invalid_sample: Vec<(u64, InvalidReason)>,
}

impl ReadStats {
    fn reject(&mut self, line: u64, reason: InvalidReason) {
        self.invalid += 1;
        match reason {
            InvalidReason::SemCoordenadas => self.sem_coordenadas += 1,
            InvalidReason::CoordenadaInvalida => self.coordenada_invalida += 1,
            InvalidReason::ForaDoMundo => self.fora_do_mundo += 1,
        }
        if self.invalid_sample.len() < INVALID_SAMPLE {
            self.invalid_sample.push((line, reason));
        }
    }
}

pub struct Table {
    pub x: Vec<u32>,
    pub y: Vec<u32>,
    pub cells: Vec<u64>,
    /// Índice da categoria de cor de cada linha (`NO_CATEGORY` = sem).
    pub category: Vec<u8>,
    /// Rótulos das categorias por índice (a última pode ser "Outros").
    pub categories: Vec<String>,
    pub columns: Vec<TileColumn>,
    /// Posição (byte) de cada linha no CSV UTF-8 de origem, para buscar os detalhes.
    pub offsets: Option<Vec<u64>>,
    pub bounds: [f64; 4],
    pub stats: ReadStats,
}

impl Table {
    pub fn len(&self) -> usize {
        self.x.len()
    }

    pub fn is_empty(&self) -> bool {
        self.x.is_empty()
    }
}

#[derive(Default)]
pub(crate) struct Interner {
    index: HashMap<String, u32>,
    values: Vec<String>,
}

impl Interner {
    pub(crate) fn id(&mut self, v: &str) -> u32 {
        let v = v.trim();
        if v.is_empty() {
            return u32::MAX;
        }
        if let Some(&id) = self.index.get(v) {
            return id;
        }
        if self.values.len() >= MAX_DISTINCT {
            return u32::MAX;
        }
        let id = self.values.len() as u32;
        self.values.push(v.to_owned());
        self.index.insert(v.to_owned(), id);
        id
    }
}

#[cfg_attr(not(feature = "files"), allow(dead_code))]
pub(crate) enum Builder {
    Number(Vec<f64>, NumberLocale),
    Category(Vec<u32>, Interner),
    Text(Vec<String>),
}

/// Acumula linhas válidas antes de projetar/indexar em paralelo.
pub(crate) struct RawTable {
    pub(crate) lat: Vec<f64>,
    pub(crate) lon: Vec<f64>,
    pub(crate) color: Vec<u32>,
    pub(crate) color_dict: Interner,
    pub(crate) columns: Vec<(String, Builder)>,
    pub(crate) offsets: Vec<u64>,
    pub(crate) stats: ReadStats,
}

#[cfg_attr(not(feature = "files"), allow(dead_code))]
impl RawTable {
    pub(crate) fn new(spec: &ImportSpec) -> Self {
        let columns = spec
            .columns
            .iter()
            .filter_map(|c| match c.kind {
                ColumnKind::Number => Some((c.name.clone(), Builder::Number(Vec::new(), c.locale.unwrap_or_default()))),
                ColumnKind::Category => Some((c.name.clone(), Builder::Category(Vec::new(), Interner::default()))),
                // Título e textos marcados vão nos pontos; o resto sai do arquivo de origem no clique.
                ColumnKind::Text if c.in_tiles || spec.title.as_deref() == Some(c.name.as_str()) => {
                    Some((c.name.clone(), Builder::Text(Vec::new())))
                }
                ColumnKind::Date | ColumnKind::Text => None,
            })
            .collect();
        Self {
            lat: Vec::new(),
            lon: Vec::new(),
            color: Vec::new(),
            color_dict: Interner::default(),
            columns,
            offsets: Vec::new(),
            stats: ReadStats::default(),
        }
    }

    /// Valida coordenadas em texto; devolve `true` se a linha entra.
    pub(crate) fn accept(&mut self, line: u64, lat: Option<&str>, lon: Option<&str>, spec: &ImportSpec) -> bool {
        let (Some(lat), Some(lon)) = (lat.filter(|s| !s.trim().is_empty()), lon.filter(|s| !s.trim().is_empty())) else {
            return self.accept_coords(line, Err(InvalidReason::SemCoordenadas));
        };
        match (
            parse_number(lat, spec.lat_locale.unwrap_or_default()),
            parse_number(lon, spec.lon_locale.unwrap_or_default()),
        ) {
            (Some(lat), Some(lon)) => self.accept_coords(line, Ok((lat, lon))),
            _ => self.accept_coords(line, Err(InvalidReason::CoordenadaInvalida)),
        }
    }

    /// Valida coordenadas já numéricas (ou o motivo da rejeição); devolve `true` se a linha entra.
    pub(crate) fn accept_coords(&mut self, line: u64, coords: Result<(f64, f64), InvalidReason>) -> bool {
        self.stats.rows += 1;
        let (lat, lon) = match coords {
            Ok(c) => c,
            Err(reason) => {
                self.stats.reject(line, reason);
                return false;
            }
        };
        if lat.abs() > 85.0 || lon.abs() >= 180.0 || (lat == 0.0 && lon == 0.0) {
            self.stats.reject(line, InvalidReason::ForaDoMundo);
            return false;
        }
        if !(-34.0..=6.0).contains(&lat) || !(-74.0..=-34.0).contains(&lon) {
            self.stats.outside_brazil += 1;
        }
        self.lat.push(lat);
        self.lon.push(lon);
        true
    }

    pub(crate) fn finish(self, finest: Resolution) -> Result<Table, Error> {
        if self.lat.is_empty() {
            return Err("nenhuma linha com coordenadas válidas".into());
        }
        let (projected, cells): (Vec<(u32, u32)>, Vec<u64>) = self
            .lat
            .par_iter()
            .zip(self.lon.par_iter())
            .map(|(&lat, &lon)| {
                let xy = mercator::project(lon, lat).unwrap_or((0, 0));
                let cell = LatLng::new(lat, lon).map(|ll| u64::from(ll.to_cell(finest))).unwrap_or(0);
                (xy, cell)
            })
            .unzip();
        let (x, y): (Vec<u32>, Vec<u32>) = projected.into_iter().unzip();

        let bounds = self.lat.par_iter().zip(self.lon.par_iter()).fold(
            || [f64::MAX, f64::MAX, f64::MIN, f64::MIN],
            |b, (&lat, &lon)| [b[0].min(lon), b[1].min(lat), b[2].max(lon), b[3].max(lat)],
        );
        let bounds = bounds.reduce(
            || [f64::MAX, f64::MAX, f64::MIN, f64::MIN],
            |a, b| [a[0].min(b[0]), a[1].min(b[1]), a[2].max(b[2]), a[3].max(b[3])],
        );

        // Categorias de cor: as mais frequentes ganham índice; o resto vira "Outros".
        let (category, categories) = if self.color_dict.values.is_empty() {
            (vec![NO_CATEGORY; x.len()], Vec::new())
        } else {
            let mut counts = vec![0u64; self.color_dict.values.len()];
            for &id in &self.color {
                if id != u32::MAX {
                    counts[id as usize] += 1;
                }
            }
            let mut order: Vec<usize> = (0..counts.len()).collect();
            order.sort_by(|&a, &b| counts[b].cmp(&counts[a]).then(a.cmp(&b)));
            let has_others = order.len() > MAX_COLOR_CATEGORIES;
            let others = MAX_COLOR_CATEGORIES as u8;
            let mut remap = vec![others; counts.len()];
            for (rank, &id) in order.iter().take(MAX_COLOR_CATEGORIES).enumerate() {
                remap[id] = rank as u8;
            }
            let mut labels: Vec<String> =
                order.iter().take(MAX_COLOR_CATEGORIES).map(|&id| self.color_dict.values[id].clone()).collect();
            if has_others {
                labels.push("Outros".to_owned());
            }
            let category = self.color.iter().map(|&id| if id == u32::MAX { NO_CATEGORY } else { remap[id as usize] }).collect();
            (category, labels)
        };

        let columns = self
            .columns
            .into_iter()
            .map(|(name, b)| TileColumn {
                name,
                data: match b {
                    Builder::Number(v, _) => ColumnData::Number(v),
                    Builder::Category(ids, dict) => ColumnData::Category { ids, dict: dict.values },
                    Builder::Text(v) => ColumnData::Text(v),
                },
            })
            .collect();

        Ok(Table {
            x,
            y,
            cells,
            category,
            categories,
            columns,
            offsets: (!self.offsets.is_empty()).then_some(self.offsets),
            bounds,
            stats: self.stats,
        })
    }
}


/// Coluna já lida (ex.: pelo importador do navegador), na ordem das linhas.
pub enum InputColumn {
    /// `NaN` = vazio.
    Number(String, Vec<f64>),
    Category(String, Vec<String>),
    /// Categoria compacta: índice no dicionário por linha (`u32::MAX` = vazio). Para milhões de linhas.
    CategoryIds(String, Vec<u32>, Vec<String>),
    /// Texto livre (título etc.), só nos tiles de pontos.
    Text(String, Vec<String>),
}

/// Coluna que colore o mapa.
pub enum ColorInput {
    None,
    /// Rótulo por linha (vazio = sem).
    Labels(Vec<String>),
    /// Índice no dicionário por linha (`u32::MAX` = sem).
    Ids(Vec<u32>, Vec<String>),
}

/// Reaproveita um dicionário vindo de fora num `Interner` (rótulos repetidos/vazios viram o mesmo id).
fn remap(dict: &[String], into: &mut Interner) -> Vec<u32> {
    dict.iter().map(|v| into.id(v)).collect()
}

/// Monta a tabela a partir de colunas prontas (sem arquivo): `lat`/`lon` em graus (`NaN` = sem coordenada).
/// Linhas inválidas saem, como na leitura de CSV.
pub fn table_from_points(lat: &[f64], lon: &[f64], color: ColorInput, columns: Vec<InputColumn>, finest: Resolution) -> Result<Table, Error> {
    if lat.len() != lon.len() {
        return Err("lat e lon com tamanhos diferentes".into());
    }
    let mut raw = RawTable {
        lat: Vec::with_capacity(lat.len()),
        lon: Vec::with_capacity(lat.len()),
        color: Vec::new(),
        color_dict: Interner::default(),
        columns: Vec::new(),
        offsets: Vec::new(),
        stats: ReadStats::default(),
    };
    let color_map = match &color {
        ColorInput::Ids(_, dict) => remap(dict, &mut raw.color_dict),
        _ => Vec::new(),
    };
    let mut builders: Vec<(String, Builder, InputColumn, Vec<u32>)> = Vec::new();
    for c in columns {
        let (name, b, map) = match &c {
            InputColumn::Number(n, _) => (n.clone(), Builder::Number(Vec::new(), NumberLocale::default()), Vec::new()),
            InputColumn::Category(n, _) => (n.clone(), Builder::Category(Vec::new(), Interner::default()), Vec::new()),
            InputColumn::CategoryIds(n, _, dict) => {
                let mut interner = Interner::default();
                let map = remap(dict, &mut interner);
                (n.clone(), Builder::Category(Vec::new(), interner), map)
            }
            InputColumn::Text(n, _) => (n.clone(), Builder::Text(Vec::new()), Vec::new()),
        };
        builders.push((name, b, c, map));
    }
    let mapped = |map: &[u32], id: Option<&u32>| id.and_then(|&i| map.get(i as usize).copied()).unwrap_or(u32::MAX);
    for i in 0..lat.len() {
        let coords = if lat[i].is_nan() || lon[i].is_nan() { Err(InvalidReason::SemCoordenadas) } else { Ok((lat[i], lon[i])) };
        if !raw.accept_coords(i as u64 + 2, coords) {
            continue;
        }
        match &color {
            ColorInput::None => {}
            ColorInput::Labels(labels) => {
                let id = raw.color_dict.id(labels.get(i).map_or("", String::as_str));
                raw.color.push(id);
            }
            ColorInput::Ids(ids, _) => raw.color.push(mapped(&color_map, ids.get(i))),
        }
        for (_, builder, input, map) in builders.iter_mut() {
            match (builder, &*input) {
                (Builder::Number(v, _), InputColumn::Number(_, src)) => v.push(src.get(i).copied().unwrap_or(f64::NAN)),
                (Builder::Category(ids, dict), InputColumn::Category(_, src)) => ids.push(dict.id(src.get(i).map_or("", String::as_str))),
                (Builder::Category(ids, _), InputColumn::CategoryIds(_, src, _)) => ids.push(mapped(map, src.get(i))),
                (Builder::Text(v), InputColumn::Text(_, src)) => v.push(src.get(i).map_or_else(String::new, |s| s.trim().to_owned())),
                _ => unreachable!("builder e coluna do mesmo tipo"),
            }
        }
    }
    raw.columns = builders.into_iter().map(|(name, b, _, _)| (name, b)).collect();
    raw.finish(finest)
}
