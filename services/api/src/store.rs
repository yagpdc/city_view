//! Datasets em disco: uma pasta por dataset com `meta.json`, o arquivo enviado e os tiles.
//! Sem banco por enquanto; o estado em memória espelha os `meta.json`.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tiler::ImportSpec;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Queued,
    Processing,
    Ready,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub id: String,
    pub name: String,
    pub file_name: String,
    pub file_bytes: u64,
    pub created_at: u64,
    pub status: Status,
    /// Etapa atual ("reading", "indexing", "tiling", "writing") e fração dela.
    pub stage: Option<String>,
    pub progress: f32,
    pub error: Option<String>,
    pub spec: ImportSpec,
    /// Relatório do motor (contagens, categorias, colunas, tempos), como JSON.
    pub report: Option<serde_json::Value>,
}

pub struct Store {
    root: PathBuf,
    items: Mutex<HashMap<String, Meta>>,
    counter: AtomicU64,
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

impl Store {
    /// Carrega os datasets existentes. Jobs interrompidos (servidor caiu) viram erro.
    pub fn open(root: PathBuf) -> std::io::Result<Self> {
        std::fs::create_dir_all(&root)?;
        let mut items = HashMap::new();
        for entry in std::fs::read_dir(&root)? {
            let path = entry?.path().join("meta.json");
            let Ok(text) = std::fs::read_to_string(&path) else { continue };
            let Ok(mut meta) = serde_json::from_str::<Meta>(&text) else { continue };
            if matches!(meta.status, Status::Queued | Status::Processing) {
                meta.status = Status::Error;
                meta.error = Some("Processamento interrompido (o servidor foi reiniciado). Envie de novo.".into());
                let _ = std::fs::write(&path, serde_json::to_vec_pretty(&meta).unwrap_or_default());
            }
            items.insert(meta.id.clone(), meta);
        }
        Ok(Self { root, items: Mutex::new(items), counter: AtomicU64::new(0) })
    }

    pub fn new_id(&self) -> String {
        format!("ds{:x}{:02x}", now_ms(), self.counter.fetch_add(1, Ordering::Relaxed) % 256)
    }

    pub fn dir(&self, id: &str) -> PathBuf {
        self.root.join(id)
    }

    pub fn list(&self) -> Vec<Meta> {
        let mut all: Vec<Meta> = self.items.lock().unwrap().values().cloned().collect();
        all.sort_by_key(|m| m.created_at);
        all
    }

    pub fn get(&self, id: &str) -> Option<Meta> {
        self.items.lock().unwrap().get(id).cloned()
    }

    /// Atualiza em memória; grava em disco quando `persist` (mudanças de status, não progresso).
    pub fn update(&self, id: &str, persist: bool, f: impl FnOnce(&mut Meta)) -> Option<Meta> {
        let meta = {
            let mut items = self.items.lock().unwrap();
            let meta = items.get_mut(id)?;
            f(meta);
            meta.clone()
        };
        if persist {
            self.save(&meta);
        }
        Some(meta)
    }

    pub fn insert(&self, meta: Meta) {
        self.save(&meta);
        self.items.lock().unwrap().insert(meta.id.clone(), meta);
    }

    pub fn remove(&self, id: &str) -> bool {
        let existed = self.items.lock().unwrap().remove(id).is_some();
        if existed {
            let _ = std::fs::remove_dir_all(self.dir(id));
        }
        existed
    }

    fn save(&self, meta: &Meta) {
        let dir = self.dir(&meta.id);
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(bytes) = serde_json::to_vec_pretty(meta) {
            let tmp = dir.join("meta.json.tmp");
            if std::fs::write(&tmp, bytes).is_ok() {
                let _ = std::fs::rename(&tmp, dir.join("meta.json"));
            }
        }
    }
}

/// Lê a linha `row_id` (1..) do CSV de origem pelo índice de posições e devolve coluna → valor.
pub fn read_row(dir: &Path, delimiter: u8, row_id: u64) -> Result<Vec<(String, String)>, String> {
    use std::io::{Read, Seek, SeekFrom};
    if row_id == 0 {
        return Err("linha inválida".into());
    }
    let mut idx = std::fs::File::open(dir.join("rows.idx")).map_err(|_| "este dataset não tem índice de linhas")?;
    idx.seek(SeekFrom::Start((row_id - 1) * 8)).map_err(|e| e.to_string())?;
    let mut buf = [0u8; 8];
    idx.read_exact(&mut buf).map_err(|_| "linha não encontrada")?;
    let offset = u64::from_le_bytes(buf);

    let source = dir.join("source.csv");
    let mut headers_reader = csv::ReaderBuilder::new().delimiter(delimiter).flexible(true).from_path(&source).map_err(|e| e.to_string())?;
    let headers: Vec<String> = headers_reader
        .headers()
        .map_err(|e| e.to_string())?
        .iter()
        .map(|h| h.trim_start_matches('\u{feff}').trim().to_owned())
        .collect();

    let mut file = std::fs::File::open(&source).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    // A posição gravada pode cair no "\n" que fecha a linha anterior (arquivos com \r\n).
    let mut reader = csv::ReaderBuilder::new().delimiter(delimiter).flexible(true).has_headers(false).from_reader(file);
    let mut record = csv::StringRecord::new();
    loop {
        if !reader.read_record(&mut record).map_err(|e| e.to_string())? {
            return Err("linha não encontrada".into());
        }
        if !(record.len() == 1 && record[0].is_empty()) {
            break;
        }
    }
    Ok(headers.into_iter().zip(record.iter().map(str::to_owned)).collect())
}
