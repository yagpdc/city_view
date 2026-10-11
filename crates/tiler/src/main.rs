//! Uso: tiler <entrada.csv|parquet> <pasta-de-saída> <spec.json>
//!
//! O spec descreve colunas de coordenada, tipos e coluna de cor (mesmo formato do wizard).

use std::{path::PathBuf, process::ExitCode, sync::Mutex, time::Instant};

use tiler::{ImportSpec, Stage};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [input, out_dir, spec_path] = args.as_slice() else {
        eprintln!("uso: tiler <entrada.csv|parquet> <pasta-de-saída> <spec.json>");
        return ExitCode::FAILURE;
    };
    let spec: ImportSpec = match std::fs::read_to_string(spec_path).map_err(|e| e.to_string()).and_then(|s| serde_json::from_str(&s).map_err(|e| e.to_string())) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[tiler] spec inválido: {e}");
            return ExitCode::FAILURE;
        }
    };

    let started = Instant::now();
    let last = Mutex::new((String::new(), 0u32));
    let progress = |stage: Stage, f: f32| {
        let pct = (f * 100.0) as u32;
        let label = format!("{stage:?}");
        let mut last = last.lock().unwrap();
        if last.0 != label || pct >= last.1 + 10 {
            eprintln!("[tiler] {label} {pct}%");
            *last = (label, pct);
        }
    };
    let report = match tiler::process(&PathBuf::from(input), &PathBuf::from(out_dir), &spec, &progress) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[tiler] erro: {e}");
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
            z.bytes as f64 / 1e6,
            z.max_raw as f64 / 1e3,
            z.max_gz as f64 / 1e3
        );
    }
    println!("\netapas:");
    for (label, secs) in &report.timings {
        println!("  {label:<28} {secs:>6.1}s");
    }
    let s = &report.stats;
    println!(
        "\n{} linhas · {} válidas · {} ignoradas (sem coordenadas {}, inválidas {}, impossíveis {}) · {} fora do Brasil",
        s.rows, report.records, s.invalid, s.sem_coordenadas, s.coordenada_invalida, s.fora_do_mundo, s.outside_brazil
    );
    if !report.categories.is_empty() {
        println!("categorias de cor: {}", report.categories.join(", "));
    }
    println!(
        "→ {}/tiles.pmtiles ({:.0} MB) em {:.1}s",
        out_dir,
        report.tiles_bytes as f64 / 1e6,
        started.elapsed().as_secs_f64()
    );
    ExitCode::SUCCESS
}
