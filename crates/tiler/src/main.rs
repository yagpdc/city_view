//! Uso: tiler <entrada.parquet> <saida.pmtiles> [--name nome]

use std::{path::PathBuf, process::ExitCode, time::Instant};

use tiler::{build, dataset};

fn mb(bytes: usize) -> f64 {
    bytes as f64 / 1e6
}

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let (Some(input), Some(output)) = (args.next(), args.next()) else {
        eprintln!("uso: tiler <entrada.parquet> <saida.pmtiles> [--name nome]");
        return ExitCode::FAILURE;
    };
    let name = match (args.next().as_deref(), args.next()) {
        (Some("--name"), Some(n)) => n,
        _ => "dataset".to_string(),
    };
    let (input, output) = (PathBuf::from(input), PathBuf::from(output));

    let started = Instant::now();
    eprintln!("[tiler] lendo {}", input.display());
    let ds = match dataset::read_parquet(&input, build::FINEST_RESOLUTION) {
        Ok(ds) => ds,
        Err(e) => {
            eprintln!("[tiler] erro ao ler: {e}");
            return ExitCode::FAILURE;
        }
    };
    let read_secs = started.elapsed().as_secs_f64();
    eprintln!("[tiler] {} registros ({} descartados) em {read_secs:.1}s", ds.records.len(), ds.skipped);

    let report = match build::build(&ds, &output, &name) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[tiler] erro ao gerar tiles: {e}");
            return ExitCode::FAILURE;
        }
    };

    println!("\nzoom  tiles     features   total MB  maior tile (raw/gz KB)");
    for z in &report.zooms {
        println!(
            "{:>4}  {:>7}  {:>10}  {:>9.1}  {:>8.0} / {:.0}",
            z.zoom,
            z.tiles,
            z.features,
            mb(z.bytes),
            z.max_raw as f64 / 1e3,
            z.max_gz as f64 / 1e3
        );
    }
    println!("\netapas:");
    println!("  {:<28} {read_secs:>6.1}s", "leitura + projeção + H3");
    for (label, secs) in &report.timings {
        println!("  {label:<28} {secs:>6.1}s");
    }
    println!(
        "\n{} registros → {} ({:.0} MB) em {:.1}s",
        report.records,
        output.display(),
        report.file_bytes as f64 / 1e6,
        started.elapsed().as_secs_f64()
    );
    ExitCode::SUCCESS
}
