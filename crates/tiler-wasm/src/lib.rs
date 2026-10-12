//! O motor de tiles da City View no navegador: colunas lidas pelo importador → PMTiles em memória.
//!
//! Os arquivos do usuário nunca saem do computador dele (docs/adr/0002); este módulo roda num Web
//! Worker e devolve os bytes do PMTiles, que o app guarda no navegador e abre no mapa.

use std::sync::Once;

use tiler::{
    pipeline::{self, BuildOptions, FINEST_RESOLUTION, Stage},
    table::{ColorInput, InputColumn, table_from_points},
};
use wasm_bindgen::prelude::*;

static POOL: Once = Once::new();

/// Separador das colunas de texto (U+001F, "unit separator"). Texto chega como uma string só: passar
/// milhões de strings soltas pela ponte JS↔WASM quebra quando a memória do WASM cresce no meio da cópia.
const SEP: char = '\u{1f}';

fn split(joined: &str) -> Vec<String> {
    joined.split(SEP).map(str::to_owned).collect()
}

/// Função JS de progresso. No wasm32 sem threads tudo roda numa thread só (o pool do rayon usa a
/// própria thread do worker), então compartilhá-la é seguro — o rayon só exige `Sync` no tipo.
struct Progress<'a>(&'a js_sys::Function);
unsafe impl Sync for Progress<'_> {}

impl Progress<'_> {
    fn report(&self, stage: &str, fraction: f32) {
        let _ = self.0.call2(&JsValue::NULL, &JsValue::from_str(stage), &JsValue::from_f64(fraction as f64));
    }
}

static LAST_PANIC: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// Mensagem do último pânico do motor (o wasm só mostra "unreachable"); limpa ao ler.
#[wasm_bindgen]
pub fn last_panic() -> Option<String> {
    LAST_PANIC.lock().ok()?.take()
}

/// Sem threads no wasm32 "puro": o rayon trabalha na própria thread do worker.
fn init_pool() {
    POOL.call_once(|| {
        std::panic::set_hook(Box::new(|info| {
            if let Ok(mut last) = LAST_PANIC.lock() {
                *last = Some(info.to_string());
            }
        }));
        let _ = rayon::ThreadPoolBuilder::new().num_threads(1).use_current_thread().build_global();
    });
}

/// Um processamento: preencha as colunas e chame `build`.
#[wasm_bindgen]
pub struct TileJob {
    name: String,
    lat: Vec<f64>,
    lon: Vec<f64>,
    color: ColorInput,
    color_by: Option<String>,
    title: Option<String>,
    columns: Vec<InputColumn>,
    report: Option<String>,
}

#[wasm_bindgen]
impl TileJob {
    #[wasm_bindgen(constructor)]
    pub fn new(name: String) -> TileJob {
        TileJob { name, lat: Vec::new(), lon: Vec::new(), color: ColorInput::None, color_by: None, title: None, columns: Vec::new(), report: None }
    }

    /// Coordenadas em graus (`NaN` = sem coordenada; a linha sai).
    pub fn set_points(&mut self, lat: Vec<f64>, lon: Vec<f64>) {
        self.lat = lat;
        self.lon = lon;
    }

    /// Coluna que colore o mapa: rótulo de cada linha (vazio = sem), unidos por `SEP`.
    pub fn set_color(&mut self, column: String, labels: String) {
        self.color_by = Some(column);
        self.color = ColorInput::Labels(split(&labels));
    }

    /// Coluna de cor compacta: índice por linha no dicionário (`u32::MAX` = sem); dicionário unido por `SEP`.
    pub fn set_color_ids(&mut self, column: String, ids: Vec<u32>, dict: String) {
        self.color_by = Some(column);
        self.color = ColorInput::Ids(ids, split(&dict));
    }

    /// Categoria compacta: índice por linha no dicionário (`u32::MAX` = vazio); dicionário unido por `SEP`.
    pub fn add_category_ids(&mut self, name: String, ids: Vec<u32>, dict: String) {
        self.columns.push(InputColumn::CategoryIds(name, ids, split(&dict)));
    }

    /// Coluna de título (nome do lugar), mostrada nos rótulos e na busca.
    pub fn set_title(&mut self, column: String) {
        self.title = Some(column);
    }

    pub fn add_number(&mut self, name: String, values: Vec<f64>) {
        self.columns.push(InputColumn::Number(name, values));
    }

    /// Valores unidos por `SEP` (um por linha).
    pub fn add_category(&mut self, name: String, values: String) {
        self.columns.push(InputColumn::Category(name, split(&values)));
    }

    /// Valores unidos por `SEP` (um por linha).
    pub fn add_text(&mut self, name: String, values: String) {
        self.columns.push(InputColumn::Text(name, split(&values)));
    }

    /// Gera o PMTiles. `progress(etapa, fração)` é chamado durante o processo.
    pub fn build(&mut self, progress: &js_sys::Function) -> Result<Vec<u8>, JsError> {
        init_pool();
        let columns = std::mem::take(&mut self.columns);
        let color = std::mem::replace(&mut self.color, ColorInput::None);
        let table = table_from_points(&self.lat, &self.lon, color, columns, FINEST_RESOLUTION).map_err(|e| JsError::new(&e.to_string()))?;
        self.lat = Vec::new();
        self.lon = Vec::new();
        let opts = BuildOptions { name: &self.name, color_by: self.color_by.as_deref(), title: self.title.as_deref() };
        let progress = Progress(progress);
        let report_progress = |stage: Stage, f: f32| {
            let label = match stage {
                Stage::Reading => "reading",
                Stage::Indexing => "indexing",
                Stage::Tiling => "tiling",
                Stage::Writing => "writing",
            };
            progress.report(label, f);
        };
        let (bytes, report) = pipeline::build_in_memory(&table, &opts, &report_progress).map_err(|e| JsError::new(&e.to_string()))?;
        self.report = serde_json::to_string(&report).ok();
        Ok(bytes)
    }

    /// Relatório do último `build` (JSON): registros, inválidos, categorias, tempos.
    pub fn report(&self) -> Option<String> {
        self.report.clone()
    }
}
