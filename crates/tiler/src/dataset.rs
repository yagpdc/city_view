//! Leitura do dataset de entrada (Parquet) para estruturas compactas em memória.
//!
//! Esquema esperado (prova de conceito): id u32, lon f64, lat f64, sector u8, size u8,
//! opened_year u16. O mapeamento genérico de colunas entra na fase 2.

use std::{fs::File, path::Path};

use arrow_array::{
    RecordBatch,
    cast::AsArray,
    types::{Float64Type, UInt8Type, UInt16Type, UInt32Type},
};
use h3o::{LatLng, Resolution};
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use rayon::prelude::*;

use crate::mercator;

pub const NUM_SECTORS: usize = 10;

/// Um registro projetado. 16 bytes: 30M registros ≈ 480 MB.
#[derive(Clone, Copy)]
pub struct Record {
    pub x: u32,
    pub y: u32,
    pub id: u32,
    pub sector: u8,
    pub size: u8,
    pub year: u16,
}

pub struct Dataset {
    pub records: Vec<Record>,
    /// Célula H3 de cada registro na resolução mais fina usada (alinhado com `records`).
    pub cells: Vec<u64>,
    /// [oeste, sul, leste, norte]
    pub bounds: [f64; 4],
    pub skipped: usize,
}

type Error = Box<dyn std::error::Error + Send + Sync>;

fn column<'a>(batch: &'a RecordBatch, name: &str) -> Result<&'a arrow_array::ArrayRef, Error> {
    batch.column_by_name(name).ok_or_else(|| format!("coluna obrigatória ausente: {name}").into())
}

pub fn read_parquet(path: &Path, finest: Resolution) -> Result<Dataset, Error> {
    let reader = ParquetRecordBatchReaderBuilder::try_new(File::open(path)?)?.with_batch_size(1 << 20).build()?;

    let mut records = Vec::new();
    let mut cells = Vec::new();
    let mut skipped = 0usize;
    let mut bounds = [f64::MAX, f64::MAX, f64::MIN, f64::MIN];

    for batch in reader {
        let batch = batch?;
        let ids = column(&batch, "id")?.as_primitive::<UInt32Type>();
        let lons = column(&batch, "lon")?.as_primitive::<Float64Type>();
        let lats = column(&batch, "lat")?.as_primitive::<Float64Type>();
        let sectors = column(&batch, "sector")?.as_primitive::<UInt8Type>();
        let sizes = column(&batch, "size")?.as_primitive::<UInt8Type>();
        let years = column(&batch, "opened_year")?.as_primitive::<UInt16Type>();

        let parsed: Vec<Option<(Record, u64, f64, f64)>> = (0..batch.num_rows())
            .into_par_iter()
            .map(|i| {
                let (lon, lat) = (lons.value(i), lats.value(i));
                let (x, y) = mercator::project(lon, lat)?;
                let cell = LatLng::new(lat, lon).ok()?.to_cell(finest);
                let record = Record {
                    x,
                    y,
                    id: ids.value(i),
                    sector: sectors.value(i),
                    size: sizes.value(i),
                    year: years.value(i),
                };
                Some((record, u64::from(cell), lon, lat))
            })
            .collect();

        records.reserve(parsed.len());
        cells.reserve(parsed.len());
        for item in parsed {
            match item {
                Some((record, cell, lon, lat)) => {
                    records.push(record);
                    cells.push(cell);
                    bounds = [bounds[0].min(lon), bounds[1].min(lat), bounds[2].max(lon), bounds[3].max(lat)];
                }
                None => skipped += 1,
            }
        }
    }

    if records.is_empty() {
        return Err("nenhum registro válido no dataset".into());
    }
    Ok(Dataset { records, cells, bounds, skipped })
}
