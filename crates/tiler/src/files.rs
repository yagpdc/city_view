//! Leitura de arquivos (CSV/Parquet) para o pipeline — só no servidor/CLI (feature `files`).
//! No navegador, o importador lê o arquivo e entrega as colunas (`table::table_from_points`).

use std::{
    fs::File,
    io::{BufReader, BufWriter, Read, Write},
    path::Path,
};

use arrow_array::{Array, ArrayRef, cast::AsArray, types::*};
use arrow_schema::DataType;
use encoding_rs_io::DecodeReaderBytesBuilder;
use h3o::Resolution;
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;

use crate::{
    spec::{ImportSpec, NumberLocale},
    table::{Builder, Error, InvalidReason, RawTable, Table},
    values::parse_number,
};

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
                Builder::Text(values) => values.push(v.trim().to_owned()),
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
                    Builder::Text(values) => values.push(text_at(array, i).trim().to_owned()),
                }
            }
        }
        done += batch.num_rows() as f32;
        progress(done / total);
    }
    raw.finish(finest)
}
