//! Tabela genérica em memória: o que o pipeline precisa de cada linha válida.
//!
//! Só guardamos o necessário para os tiles (posição, célula H3, categoria de cor e as
//! colunas numéricas/categóricas). Texto livre e datas ficam no arquivo de origem e são
//! lidos sob demanda pela posição de cada linha (`offsets`).

use std::{
    collections::HashMap,
    fs::File,
    io::{BufReader, BufWriter, Read, Write},
    path::Path,
};

use arrow_array::{Array, ArrayRef, cast::AsArray, types::*};
use arrow_schema::DataType;
use encoding_rs_io::DecodeReaderBytesBuilder;
use h3o::{LatLng, Resolution};
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
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
struct Interner {
    index: HashMap<String, u32>,
    values: Vec<String>,
}

impl Interner {
    fn id(&mut self, v: &str) -> u32 {
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

enum Builder {
    Number(Vec<f64>, NumberLocale),
    Category(Vec<u32>, Interner),
}

/// Acumula linhas válidas antes de projetar/indexar em paralelo.
struct RawTable {
    lat: Vec<f64>,
    lon: Vec<f64>,
    color: Vec<u32>,
    color_dict: Interner,
    columns: Vec<(String, Builder)>,
    offsets: Vec<u64>,
    stats: ReadStats,
}

impl RawTable {
    fn new(spec: &ImportSpec) -> Self {
        let columns = spec
            .columns
            .iter()
            .filter_map(|c| match c.kind {
                ColumnKind::Number => Some((c.name.clone(), Builder::Number(Vec::new(), c.locale.unwrap_or_default()))),
                ColumnKind::Category => Some((c.name.clone(), Builder::Category(Vec::new(), Interner::default()))),
                // Texto e datas não vão para os tiles: saem do arquivo de origem no clique.
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
    fn accept(&mut self, line: u64, lat: Option<&str>, lon: Option<&str>, spec: &ImportSpec) -> bool {
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
    fn accept_coords(&mut self, line: u64, coords: Result<(f64, f64), InvalidReason>) -> bool {
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

    fn finish(self, finest: Resolution) -> Result<Table, Error> {
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

/// Converte o arquivo enviado para UTF-8 (necessário para as posições de linha baterem).
pub fn normalize_to_utf8(input: &Path, output: &Path, windows_1252: bool) -> Result<(), Error> {
    if !windows_1252 {
        std::fs::copy(input, output)?;
        return Ok(());
    }
    let mut reader = DecodeReaderBytesBuilder::new()
        .encoding(Some(encoding_rs::WINDOWS_1252))
        .build(BufReader::with_capacity(1 << 20, File::open(input)?));
    let mut writer = BufWriter::with_capacity(1 << 20, File::create(output)?);
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        writer.write_all(&buf[..n])?;
    }
    writer.flush()?;
    Ok(())
}

fn find(headers: &[String], name: &str) -> Result<usize, Error> {
    headers
        .iter()
        .position(|h| h == name.trim())
        .ok_or_else(|| format!("coluna não encontrada no arquivo: \"{name}\"").into())
}

/// Lê um CSV já em UTF-8 conforme o mapeamento. `progress` recebe a fração lida (0..1).
pub fn read_csv(path: &Path, spec: &ImportSpec, finest: Resolution, progress: &dyn Fn(f32)) -> Result<Table, Error> {
    let size = std::fs::metadata(path)?.len().max(1);
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(spec.delimiter_byte())
        .flexible(true)
        .buffer_capacity(1 << 20)
        .from_path(path)?;

    let mut empty = 0;
    let headers: Vec<String> = reader
        .headers()?
        .iter()
        .map(|h| {
            let h = h.trim_start_matches('\u{feff}').trim();
            if h.is_empty() {
                empty += 1;
                format!("coluna_{empty}")
            } else {
                h.to_owned()
            }
        })
        .collect();
    let lat_i = find(&headers, &spec.lat)?;
    let lon_i = find(&headers, &spec.lon)?;
    let color_i = spec.color_by.as_deref().map(|c| find(&headers, c)).transpose()?;

    let mut raw = RawTable::new(spec);
    let column_i: Vec<usize> = raw.columns.iter().map(|(name, _)| find(&headers, name)).collect::<Result<_, _>>()?;

    let mut record = csv::StringRecord::new();
    let mut line = 1u64;
    while reader.read_record(&mut record)? {
        line += 1;
        let offset = record.position().map_or(0, |p| p.byte());
        if !raw.accept(line, record.get(lat_i), record.get(lon_i), spec) {
            continue;
        }
        raw.offsets.push(offset);
        if let Some(ci) = color_i {
            let id = raw.color_dict.id(record.get(ci).unwrap_or(""));
            raw.color.push(id);
        }
        for ((_, builder), &i) in raw.columns.iter_mut().zip(&column_i) {
            let v = record.get(i).unwrap_or("");
            match builder {
                Builder::Number(values, locale) => values.push(parse_number(v, *locale).unwrap_or(f64::NAN)),
                Builder::Category(ids, dict) => ids.push(dict.id(v)),
            }
        }
        if line % 65_536 == 0 {
            progress(offset as f32 / size as f32);
        }
    }
    progress(1.0);
    raw.finish(finest)
}

fn number_at(array: &ArrayRef, i: usize) -> Option<f64> {
    if array.is_null(i) {
        return None;
    }
    Some(match array.data_type() {
        DataType::Float64 => array.as_primitive::<Float64Type>().value(i),
        DataType::Float32 => array.as_primitive::<Float32Type>().value(i) as f64,
        DataType::Int64 => array.as_primitive::<Int64Type>().value(i) as f64,
        DataType::Int32 => array.as_primitive::<Int32Type>().value(i) as f64,
        DataType::Int16 => array.as_primitive::<Int16Type>().value(i) as f64,
        DataType::Int8 => array.as_primitive::<Int8Type>().value(i) as f64,
        DataType::UInt64 => array.as_primitive::<UInt64Type>().value(i) as f64,
        DataType::UInt32 => array.as_primitive::<UInt32Type>().value(i) as f64,
        DataType::UInt16 => array.as_primitive::<UInt16Type>().value(i) as f64,
        DataType::UInt8 => array.as_primitive::<UInt8Type>().value(i) as f64,
        DataType::Utf8 => return parse_number(array.as_string::<i32>().value(i), NumberLocale::Intl),
        _ => return None,
    })
}

fn text_at(array: &ArrayRef, i: usize) -> String {
    if array.is_null(i) {
        return String::new();
    }
    match array.data_type() {
        DataType::Utf8 => array.as_string::<i32>().value(i).to_owned(),
        DataType::LargeUtf8 => array.as_string::<i64>().value(i).to_owned(),
        _ => number_at(array, i).map(|v| if v.fract() == 0.0 { format!("{v:.0}") } else { v.to_string() }).unwrap_or_default(),
    }
}

/// Lê um Parquet conforme o mapeamento (sem índice de linhas: os detalhes vêm dos tiles).
pub fn read_parquet(path: &Path, spec: &ImportSpec, finest: Resolution, progress: &dyn Fn(f32)) -> Result<Table, Error> {
    let builder = ParquetRecordBatchReaderBuilder::try_new(File::open(path)?)?;
    let total = builder.metadata().file_metadata().num_rows().max(1) as f32;
    let reader = builder.with_batch_size(1 << 20).build()?;
    let mut raw = RawTable::new(spec);
    let mut line = 1u64;
    let mut done = 0f32;

    for batch in reader {
        let batch = batch?;
        let col = |name: &str| -> Result<ArrayRef, Error> {
            batch.column_by_name(name).cloned().ok_or_else(|| format!("coluna não encontrada: \"{name}\"").into())
        };
        let (lat, lon) = (col(&spec.lat)?, col(&spec.lon)?);
        let color = spec.color_by.as_deref().map(col).transpose()?;
        let columns: Vec<ArrayRef> = raw.columns.iter().map(|(name, _)| col(name)).collect::<Result<_, _>>()?;

        for i in 0..batch.num_rows() {
            line += 1;
            let coords = match (number_at(&lat, i), number_at(&lon, i)) {
                (Some(la), Some(lo)) => Ok((la, lo)),
                _ => Err(InvalidReason::SemCoordenadas),
            };
            if !raw.accept_coords(line, coords) {
                continue;
            }
            if let Some(c) = &color {
                let id = raw.color_dict.id(&text_at(c, i));
                raw.color.push(id);
            }
            for ((_, builder), array) in raw.columns.iter_mut().zip(&columns) {
                match builder {
                    Builder::Number(values, _) => values.push(number_at(array, i).unwrap_or(f64::NAN)),
                    Builder::Category(ids, dict) => ids.push(dict.id(&text_at(array, i))),
                }
            }
        }
        done += batch.num_rows() as f32;
        progress(done / total);
    }
    raw.finish(finest)
}
