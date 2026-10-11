//! Gera um dataset sintético de empresas no Brasil, em Parquet, para testes e benchmarks.
//!
//! Uso: synth [--rows 30000000] [--out data/out/empresas.parquet] [--seed 42]
//!
//! Os pontos se concentram nas maiores cidades, proporcional à população, com
//! espalhamento gaussiano (centro denso, periferia rala) e uma cauda regional.

use std::{fs::File, path::PathBuf, sync::Arc, time::Instant};

use arrow_array::{Float64Array, RecordBatch, UInt8Array, UInt16Array, UInt32Array};
use arrow_schema::{DataType, Field, Schema};
use parquet::{arrow::ArrowWriter, basic::Compression, file::properties::WriterProperties};
use rand::{RngExt, SeedableRng, rngs::Xoshiro256PlusPlus};

/// (nome, lon, lat, população em milhares) — região metropolitana aproximada.
const CITIES: &[(&str, f64, f64, f64)] = &[
    ("São Paulo", -46.633, -23.550, 21_900.0),
    ("Rio de Janeiro", -43.196, -22.908, 13_500.0),
    ("Belo Horizonte", -43.938, -19.920, 6_000.0),
    ("Brasília", -47.882, -15.794, 4_800.0),
    ("Porto Alegre", -51.230, -30.033, 4_400.0),
    ("Fortaleza", -38.543, -3.717, 4_100.0),
    ("Recife", -34.881, -8.054, 4_100.0),
    ("Salvador", -38.511, -12.971, 4_000.0),
    ("Curitiba", -49.273, -25.428, 3_700.0),
    ("Campinas", -47.061, -22.906, 3_300.0),
    ("Goiânia", -49.254, -16.686, 2_700.0),
    ("Manaus", -60.025, -3.119, 2_700.0),
    ("Belém", -48.504, -1.456, 2_500.0),
    ("Vitória", -40.338, -20.320, 2_000.0),
    ("Santos", -46.333, -23.961, 1_900.0),
    ("São Luís", -44.302, -2.530, 1_600.0),
    ("Natal", -35.209, -5.795, 1_600.0),
    ("Florianópolis", -48.548, -27.595, 1_300.0),
    ("Maceió", -35.735, -9.666, 1_300.0),
    ("João Pessoa", -34.861, -7.115, 1_300.0),
    ("Teresina", -42.802, -5.089, 1_200.0),
    ("Sorocaba", -47.458, -23.501, 1_100.0),
    ("Ribeirão Preto", -47.810, -21.177, 1_100.0),
    ("São José dos Campos", -45.887, -23.179, 1_100.0),
    ("Cuiabá", -56.097, -15.601, 1_000.0),
    ("Aracaju", -37.073, -10.947, 1_000.0),
    ("Campo Grande", -54.646, -20.469, 950.0),
    ("Londrina", -51.162, -23.304, 900.0),
    ("Joinville", -48.846, -26.304, 750.0),
    ("Uberlândia", -48.277, -18.918, 720.0),
    ("Juiz de Fora", -43.350, -21.764, 700.0),
    ("Maringá", -51.938, -23.420, 700.0),
    ("Caxias do Sul", -51.179, -29.168, 650.0),
    ("Feira de Santana", -38.966, -12.266, 650.0),
    ("Porto Velho", -63.900, -8.761, 550.0),
    ("Macapá", -51.066, 0.034, 550.0),
    ("Piracicaba", -47.649, -22.725, 550.0),
    ("Bauru", -49.060, -22.315, 400.0),
    ("Montes Claros", -43.861, -16.735, 420.0),
    ("Campina Grande", -35.881, -7.230, 420.0),
    ("Rio Branco", -67.810, -9.975, 420.0),
    ("Boa Vista", -60.673, 2.820, 440.0),
    ("Palmas", -48.333, -10.184, 320.0),
    ("Chapecó", -52.618, -27.100, 270.0),
    ("Santarém", -54.708, -2.443, 330.0),
    ("Imperatriz", -47.491, -5.526, 280.0),
    ("Petrolina", -40.500, -9.389, 360.0),
    ("Vitória da Conquista", -40.839, -14.866, 350.0),
    ("Cascavel", -53.455, -24.955, 350.0),
    ("Pelotas", -52.342, -31.771, 350.0),
];

/// Setores (CNAE simplificado) e seus pesos.
const SECTOR_WEIGHTS: [f64; 10] = [
    0.28, // 0 comércio varejista
    0.06, // 1 comércio atacadista
    0.10, // 2 alimentação
    0.14, // 3 serviços profissionais
    0.08, // 4 construção
    0.07, // 5 indústria
    0.07, // 6 saúde
    0.05, // 7 educação
    0.06, // 8 transporte e logística
    0.09, // 9 tecnologia e informação
];

/// Porte: MEI, ME, EPP, demais.
const SIZE_WEIGHTS: [f64; 4] = [0.58, 0.27, 0.10, 0.05];

const BATCH_ROWS: usize = 1 << 20;
const KM_PER_DEG_LAT: f64 = 111.32;

struct Args {
    rows: usize,
    out: PathBuf,
    seed: u64,
}

fn parse_args() -> Args {
    let mut args = Args { rows: 30_000_000, out: PathBuf::from("data/out/empresas.parquet"), seed: 42 };
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        let value = it.next().unwrap_or_else(|| panic!("faltou valor para {flag}"));
        match flag.as_str() {
            "--rows" => args.rows = value.replace('_', "").parse().expect("--rows inválido"),
            "--out" => args.out = PathBuf::from(value),
            "--seed" => args.seed = value.parse().expect("--seed inválido"),
            _ => panic!("argumento desconhecido: {flag}"),
        }
    }
    args
}

/// Tabela cumulativa para sorteio ponderado.
fn cumulative(weights: impl IntoIterator<Item = f64>) -> Vec<f64> {
    let mut acc = 0.0;
    let mut out: Vec<f64> = weights.into_iter().map(|w| {
        acc += w;
        acc
    }).collect();
    let total = acc;
    out.iter_mut().for_each(|v| *v /= total);
    out
}

fn pick(cdf: &[f64], rng: &mut impl RngExt) -> usize {
    let r: f64 = rng.random();
    cdf.partition_point(|&c| c < r).min(cdf.len() - 1)
}

/// Par de normais padrão (Box-Muller).
fn gaussian_pair(rng: &mut impl RngExt) -> (f64, f64) {
    let u1: f64 = rng.random::<f64>().max(f64::MIN_POSITIVE);
    let u2: f64 = rng.random();
    let r = (-2.0 * u1.ln()).sqrt();
    let theta = std::f64::consts::TAU * u2;
    (r * theta.cos(), r * theta.sin())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = parse_args();
    let started = Instant::now();

    let city_cdf = cumulative(CITIES.iter().map(|c| c.3));
    let sector_cdf = cumulative(SECTOR_WEIGHTS);
    let size_cdf = cumulative(SIZE_WEIGHTS);
    let mut rng = Xoshiro256PlusPlus::seed_from_u64(args.seed);

    let schema = Arc::new(Schema::new(vec![
        Field::new("id", DataType::UInt32, false),
        Field::new("lon", DataType::Float64, false),
        Field::new("lat", DataType::Float64, false),
        Field::new("sector", DataType::UInt8, false),
        Field::new("size", DataType::UInt8, false),
        Field::new("opened_year", DataType::UInt16, false),
    ]));

    if let Some(dir) = args.out.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let props = WriterProperties::builder().set_compression(Compression::SNAPPY).build();
    let mut writer = ArrowWriter::try_new(File::create(&args.out)?, schema.clone(), Some(props))?;

    let mut written = 0usize;
    while written < args.rows {
        let n = BATCH_ROWS.min(args.rows - written);
        let mut ids = Vec::with_capacity(n);
        let mut lons = Vec::with_capacity(n);
        let mut lats = Vec::with_capacity(n);
        let mut sectors = Vec::with_capacity(n);
        let mut sizes = Vec::with_capacity(n);
        let mut years = Vec::with_capacity(n);

        for i in 0..n {
            let (_, lon0, lat0, pop) = CITIES[pick(&city_cdf, &mut rng)];
            // Raio cresce com a cidade; parte dos pontos vai para a periferia e a região.
            let base_km = 2.0 + 3.5 * (pop / 1000.0).sqrt();
            let r: f64 = rng.random();
            let sigma_km = if r < 0.70 { base_km } else if r < 0.95 { base_km * 2.5 } else { base_km * 6.0 };
            let (gx, gy) = gaussian_pair(&mut rng);
            let lat = lat0 + gy * sigma_km / KM_PER_DEG_LAT;
            let lon = lon0 + gx * sigma_km / (KM_PER_DEG_LAT * lat0.to_radians().cos());

            ids.push((written + i) as u32 + 1);
            lons.push(lon);
            lats.push(lat);
            sectors.push(pick(&sector_cdf, &mut rng) as u8);
            sizes.push(pick(&size_cdf, &mut rng) as u8);
            // Mais aberturas recentes: distribuição triangular inclinada para 2026.
            let t: f64 = rng.random::<f64>().max(rng.random::<f64>());
            years.push(1970 + (t * 56.0) as u16);
        }

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(UInt32Array::from(ids)),
                Arc::new(Float64Array::from(lons)),
                Arc::new(Float64Array::from(lats)),
                Arc::new(UInt8Array::from(sectors)),
                Arc::new(UInt8Array::from(sizes)),
                Arc::new(UInt16Array::from(years)),
            ],
        )?;
        writer.write(&batch)?;
        written += n;
        eprint!("\r[synth] {written}/{} linhas", args.rows);
    }
    writer.close()?;

    let size_mb = std::fs::metadata(&args.out)?.len() as f64 / 1e6;
    eprintln!(
        "\n[synth] {} linhas em {:.1}s → {} ({size_mb:.0} MB)",
        args.rows,
        started.elapsed().as_secs_f64(),
        args.out.display()
    );
    Ok(())
}
