//! Motor de dados da City View: dataset (CSV/Parquet) → vector tiles agregados → PMTiles.

#[cfg(feature = "files")]
pub mod files;
pub mod mercator;
pub mod mvt;
pub mod pipeline;
pub mod pmtiles;
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
    let started = std::time::Instant::now();
    let table = if is_parquet {
        files::read_parquet(input, spec, pipeline::FINEST_RESOLUTION, &read_progress)?
    } else {
        let source = out_dir.join("source.csv");
        if input != source {
            files::normalize_to_utf8(input, &source, spec.is_windows_1252())?;
        }
        files::read_csv(&source, spec, pipeline::FINEST_RESOLUTION, &read_progress)?
    };
    let read_secs = started.elapsed().as_secs_f64();
    let opts = pipeline::BuildOptions { name: &spec.name, color_by: spec.color_by.as_deref(), title: spec.title.as_deref() };
    let mut report = pipeline::build(&table, out_dir, &opts, progress)?;
    report.timings.insert(0, ("leitura + projeção + H3", read_secs));
    Ok(report)
}
