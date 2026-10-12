//! Caminho do navegador: colunas prontas → PMTiles em memória.

use tiler::{
    pipeline::{self, BuildOptions, FINEST_RESOLUTION},
    table::{ColorInput, InputColumn, table_from_points},
};

#[test]
fn colunas_viram_pmtiles_em_memoria() {
    let n = 2_000;
    let lat: Vec<f64> = (0..n).map(|i| -23.55 + (i % 50) as f64 * 0.001).collect();
    let mut lon: Vec<f64> = (0..n).map(|i| -46.63 + (i / 50) as f64 * 0.001).collect();
    lon[7] = f64::NAN; // linha sem coordenada sai
    let color: Vec<String> = (0..n).map(|i| ["Mercado", "Padaria", "Farmácia"][i % 3].to_owned()).collect();
    let names: Vec<String> = (0..n).map(|i| format!("Loja {i}")).collect();
    let area: Vec<f64> = (0..n).map(|i| i as f64).collect();

    let table = table_from_points(
        &lat,
        &lon,
        ColorInput::Labels(color),
        vec![InputColumn::Text("nome".into(), names), InputColumn::Number("area".into(), area)],
        FINEST_RESOLUTION,
    )
    .expect("tabela");
    assert_eq!(table.len(), n - 1);
    assert_eq!(table.stats.sem_coordenadas, 1);
    assert_eq!(table.categories.len(), 3);

    let opts = BuildOptions { name: "teste", color_by: Some("tipo"), title: Some("nome") };
    let (bytes, report) = pipeline::build_in_memory(&table, &opts, &|_, _| {}).expect("pmtiles");
    assert_eq!(&bytes[..7], b"PMTiles");
    assert_eq!(bytes[7], 3);
    assert_eq!(report.records, n - 1);
    assert_eq!(report.tiles_bytes, bytes.len() as u64);
}

#[test]
fn categorias_compactas_dao_o_mesmo_resultado() {
    let lat = vec![-23.55, -23.56, -23.57, -23.58];
    let lon = vec![-46.63, -46.64, -46.65, -46.66];
    let dict = vec!["Mercado".to_owned(), "Padaria".to_owned()];
    let table = table_from_points(
        &lat,
        &lon,
        ColorInput::Ids(vec![0, 1, 1, u32::MAX], dict.clone()),
        vec![InputColumn::CategoryIds("tipo".into(), vec![1, 0, u32::MAX, 1], dict)],
        FINEST_RESOLUTION,
    )
    .expect("tabela");
    assert_eq!(table.len(), 4);
    // Padaria aparece mais: fica com o índice 0 nas categorias de cor.
    assert_eq!(table.categories, vec!["Padaria".to_owned(), "Mercado".to_owned()]);
    assert_eq!(table.category, vec![1, 0, 0, tiler::table::NO_CATEGORY]);
}
