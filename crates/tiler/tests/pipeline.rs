//! Ponta a ponta: CSV estilo Excel brasileiro (Latin-1, ";", vírgula decimal, \r\n) → tiles + índice.

use std::io::{Read, Seek, SeekFrom};

use tiler::{ImportSpec, Stage};

fn spec() -> ImportSpec {
    serde_json::from_str(
        r#"{
            "name": "teste",
            "lat": "Latitude",
            "lon": "Longitude",
            "latLocale": "br",
            "lonLocale": "br",
            "delimiter": ";",
            "encoding": "windows-1252",
            "colorBy": "Categoria",
            "columns": [
                { "name": "Nome", "type": "text" },
                { "name": "Categoria", "type": "category" },
                { "name": "Valor", "type": "number", "locale": "br" }
            ]
        }"#,
    )
    .unwrap()
}

#[test]
fn csv_latin1_to_tiles_and_row_index() {
    let dir = std::env::temp_dir().join(format!("pinny-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    // "Farmácia" e "Açaí" em Windows-1252 (á = 0xE1, ç = 0xE7, í = 0xED).
    let mut csv: Vec<u8> = b"Nome;Categoria;Valor;Latitude;Longitude\r\n".to_vec();
    csv.extend_from_slice(b"Loja A;Farm\xe1cia;1.234,50;-23,55;-46,63\r\n");
    csv.extend_from_slice(b"Loja B;A\xe7a\xed;10,00;;\r\n"); // sem coordenada
    csv.extend_from_slice(b"Loja C;Farm\xe1cia;5,5;N/D;-46,6\r\n"); // coordenada inválida
    csv.extend_from_slice(b"Loja D;A\xe7a\xed;7;-22,9;-43,2\r\n");
    csv.extend_from_slice(b"Loja E;Farm\xe1cia;8;0;0\r\n"); // impossível
    let input = dir.join("upload.csv");
    std::fs::write(&input, csv).unwrap();

    let report = tiler::process(&input, &dir, &spec(), &|_: Stage, _: f32| {}).unwrap();

    assert_eq!(report.records, 2);
    assert_eq!(report.stats.rows, 5);
    assert_eq!((report.stats.sem_coordenadas, report.stats.coordenada_invalida, report.stats.fora_do_mundo), (1, 1, 1));
    assert_eq!(report.stats.invalid_sample.iter().map(|(line, _)| *line).collect::<Vec<_>>(), vec![3, 4, 6]);
    // Empate em contagem: vale a ordem de aparição. Acentos decodificados de Latin-1.
    assert_eq!(report.categories, vec!["Farmácia", "Açaí"]);
    assert!(report.tile_columns.iter().any(|c| c.name == "Valor"));
    assert!(!report.tile_columns.iter().any(|c| c.name == "Nome"), "texto livre não vai para os tiles");

    // O índice aponta para a linha certa no CSV já em UTF-8 (pulando o \n do \r\n anterior).
    let idx = std::fs::read(dir.join("rows.idx")).unwrap();
    assert_eq!(idx.len(), 2 * 8);
    let mut source = std::fs::File::open(dir.join("source.csv")).unwrap();
    let mut line_at = |id: usize| {
        let offset = u64::from_le_bytes(idx[(id - 1) * 8..id * 8].try_into().unwrap());
        source.seek(SeekFrom::Start(offset)).unwrap();
        let mut buf = vec![0u8; 64];
        let n = source.read(&mut buf).unwrap();
        String::from_utf8_lossy(&buf[..n]).trim_start_matches(['\r', '\n']).lines().next().unwrap().to_owned()
    };
    assert!(line_at(1).starts_with("Loja A;Farmácia;1.234,50"));
    assert!(line_at(2).starts_with("Loja D;Açaí;7"));

    let tiles = std::fs::metadata(dir.join("tiles.pmtiles")).unwrap();
    assert!(tiles.len() > 127);
    let _ = std::fs::remove_dir_all(&dir);
}
