//! Motor de dados da City View: dataset (CSV/Parquet) → vector tiles agregados → PMTiles.

#[cfg(feature = "files")]
pub mod files;
pub mod clock;
pub mod mercator;
pub mod mvt;
pub mod pipeline;
pub mod pmtiles;
pub mod regions;
pub mod spec;
pub mod table;
pub mod values;

#[cfg(feature = "files")]
use std::path::Path;

pub use pipeline::{Report, Stage};
pub use spec::ImportSpec;
pub use table::Error;

#[cfg(feature = "files")]
/// Processa um arquivo enviado do início ao fim, dentro de `out_dir`:
/// `source.csv` (UTF-8), `tiles.pmtiles` e `rows.idx`. Parquet é lido direto.
pub fn process(input: &Path, out_dir: &Path, spec: &ImportSpec, progress: &(dyn Fn(Stage, f32) + Sync)) -> Result<Report, Error> {
    std::fs::create_dir_all(out_dir)?;
    let is_parquet = input.extension().is_some_and(|e| e.eq_ignore_ascii_case("parquet"));
    let read_progress = |f: f32| progress(Stage::Reading, f);
    let started = clock::Stopwatch::start();
    let table = if is_parquet {
        files::read_parquet(input, spec, pipeline::FINEST_RESOLUTION, &read_progress)?
    } else {
        let source = out_dir.join("source.csv");
        if input != source {
            files::normalize_to_utf8(input, &source, spec.is_windows_1252())?;
        }
        files::read_csv(&source, spec, pipeline::FINEST_RESOLUTION, &read_progress)?
    };
    let read_secs = started.secs();
    let mut table = table;
    let mut levels = Vec::new();
    for r in &spec.regions {
        let json = std::fs::read_to_string(&r.path)?;
        levels.push(regions::RegionLevel::from_geojson(&r.id, &json, &r.code).map_err(Error::from)?);
    }
    let clip_started = clock::Stopwatch::start();
    let mut clipped = None;
    if let Some(id) = &spec.clip_to {
        let level = levels.iter().find(|l| &l.id == id).ok_or_else(|| Error::from(format!("clip_to: malha \"{id}\" não está em regions")))?;
        let removed = regions::clip(level, &mut table);
        if table.is_empty() {
            return Err("nenhum registro dentro da malha do recorte".into());
        }
        clipped = Some(removed);
    }
    let opts = pipeline::BuildOptions { name: &spec.name, color_by: spec.color_by.as_deref(), title: spec.title.as_deref(), regions: &levels };
    let mut report = pipeline::build(&table, out_dir, &opts, progress)?;
    report.timings.insert(0, ("leitura + projeção + H3", read_secs));
    if let Some(removed) = clipped {
        report.timings.insert(1, ("recorte pela malha", clip_started.secs()));
        report.clipped = removed as u64;
    }
    Ok(report)
}
