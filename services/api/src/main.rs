//! Servidor local da City View: recebe arquivos, processa com o motor (tiler) e serve os tiles.
//!
//! Uso: pinny-api [--port 8787] [--data data/workspace/datasets]

mod store;

use std::{net::SocketAddr, path::PathBuf, sync::Arc, time::Instant};

use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path, State},
    http::{Request, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Deserialize;
use serde_json::json;
use store::{Meta, Status, Store};
use tiler::{ImportSpec, Stage};
use tokio::{io::AsyncWriteExt, sync::Semaphore};
use tower::ServiceExt;
use tower_http::services::ServeFile;

struct App {
    store: Store,
    /// Um processamento por vez: o motor usa todos os núcleos e bastante memória.
    jobs: Semaphore,
}

type Shared = Arc<App>;

fn error(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(json!({ "error": message.into() }))).into_response()
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_target(false).init();
    let mut port = 8787u16;
    let mut data = PathBuf::from("data/workspace/datasets");
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        match (flag.as_str(), args.next()) {
            ("--port", Some(v)) => port = v.parse().expect("--port inválido"),
            ("--data", Some(v)) => data = PathBuf::from(v),
            _ => panic!("argumento desconhecido: {flag}"),
        }
    }

    let app = Arc::new(App { store: Store::open(data.clone()).expect("pasta de dados"), jobs: Semaphore::new(1) });
    let router = Router::new()
        .route("/api/health", get(|| async { Json(json!({ "ok": true, "version": env!("CARGO_PKG_VERSION") })) }))
        .route("/api/datasets", get(list).post(create))
        .route("/api/datasets/{id}", get(detail).delete(remove).patch(rename))
        .route("/api/datasets/{id}/tiles.pmtiles", get(tiles))
        .route("/api/datasets/{id}/rows/{row}", get(row))
        .layer(DefaultBodyLimit::disable())
        .with_state(app);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    tracing::info!("City View API em http://{addr} (dados em {})", data.display());
    let listener = tokio::net::TcpListener::bind(addr).await.expect("porta ocupada?");
    axum::serve(listener, router).await.expect("servidor");
}

async fn list(State(app): State<Shared>) -> Json<Vec<Meta>> {
    Json(app.store.list())
}

async fn detail(State(app): State<Shared>, Path(id): Path<String>) -> Response {
    match app.store.get(&id) {
        Some(m) => Json(m).into_response(),
        None => error(StatusCode::NOT_FOUND, "dataset não encontrado"),
    }
}

async fn remove(State(app): State<Shared>, Path(id): Path<String>) -> Response {
    match app.store.get(&id) {
        Some(m) if matches!(m.status, Status::Queued | Status::Processing) => {
            error(StatusCode::CONFLICT, "o dataset ainda está sendo processado")
        }
        Some(_) => {
            app.store.remove(&id);
            StatusCode::NO_CONTENT.into_response()
        }
        None => error(StatusCode::NOT_FOUND, "dataset não encontrado"),
    }
}

#[derive(Deserialize)]
struct RenameBody {
    name: String,
}

async fn rename(State(app): State<Shared>, Path(id): Path<String>, Json(body): Json<RenameBody>) -> Response {
    let name = body.name.trim().to_owned();
    if name.is_empty() {
        return error(StatusCode::BAD_REQUEST, "nome vazio");
    }
    match app.store.update(&id, true, |m| m.name = name) {
        Some(m) => Json(m).into_response(),
        None => error(StatusCode::NOT_FOUND, "dataset não encontrado"),
    }
}

/// Tiles com suporte a Range (o PMTiles lê pedaços do arquivo).
async fn tiles(State(app): State<Shared>, Path(id): Path<String>, req: Request<Body>) -> Response {
    match app.store.get(&id) {
        Some(m) if m.status == Status::Ready => {
            let path = app.store.dir(&id).join("tiles.pmtiles");
            match ServeFile::new(path).oneshot(req).await {
                Ok(res) => res.into_response(),
                Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
            }
        }
        Some(_) => error(StatusCode::CONFLICT, "o dataset ainda não está pronto"),
        None => error(StatusCode::NOT_FOUND, "dataset não encontrado"),
    }
}

/// Detalhes completos de uma linha (todas as colunas do arquivo original).
async fn row(State(app): State<Shared>, Path((id, row)): Path<(String, u64)>) -> Response {
    let Some(meta) = app.store.get(&id) else { return error(StatusCode::NOT_FOUND, "dataset não encontrado") };
    let dir = app.store.dir(&id);
    let delimiter = meta.spec.delimiter_byte();
    match tokio::task::spawn_blocking(move || store::read_row(&dir, delimiter, row)).await {
        // Lista de pares para manter a ordem das colunas da planilha.
        Ok(Ok(fields)) => Json(json!({ "id": row, "fields": fields })).into_response(),
        Ok(Err(e)) => error(StatusCode::NOT_FOUND, e),
        Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

/// Recebe `spec` (JSON) e `file` (multipart, em streaming para o disco) e enfileira o processamento.
async fn create(State(app): State<Shared>, mut multipart: Multipart) -> Response {
    let id = app.store.new_id();
    let dir = app.store.dir(&id);
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        return error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string());
    }
    let mut spec: Option<ImportSpec> = None;
    let mut upload: Option<(PathBuf, String, u64)> = None;

    loop {
        let field = match multipart.next_field().await {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(e) => {
                let _ = tokio::fs::remove_dir_all(&dir).await;
                return error(StatusCode::BAD_REQUEST, format!("envio interrompido: {e}"));
            }
        };
        match field.name() {
            Some("spec") => match field.text().await.map_err(|e| e.to_string()).and_then(|t| serde_json::from_str(&t).map_err(|e| e.to_string())) {
                Ok(s) => spec = Some(s),
                Err(e) => {
                    let _ = tokio::fs::remove_dir_all(&dir).await;
                    return error(StatusCode::BAD_REQUEST, format!("spec inválido: {e}"));
                }
            },
            Some("file") => {
                let file_name = field.file_name().unwrap_or("dados.csv").to_owned();
                let ext = if file_name.to_lowercase().ends_with(".parquet") { "parquet" } else { "csv" };
                let path = dir.join(format!("upload.{ext}"));
                let mut out = match tokio::fs::File::create(&path).await {
                    Ok(f) => tokio::io::BufWriter::with_capacity(1 << 20, f),
                    Err(e) => return error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
                };
                let mut field = field;
                let mut bytes = 0u64;
                loop {
                    match field.chunk().await {
                        Ok(Some(chunk)) => {
                            bytes += chunk.len() as u64;
                            if let Err(e) = out.write_all(&chunk).await {
                                return error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string());
                            }
                        }
                        Ok(None) => break,
                        Err(e) => {
                            let _ = tokio::fs::remove_dir_all(&dir).await;
                            return error(StatusCode::BAD_REQUEST, format!("envio interrompido: {e}"));
                        }
                    }
                }
                if let Err(e) = out.flush().await {
                    return error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string());
                }
                upload = Some((path, file_name, bytes));
            }
            _ => {}
        }
    }

    let (Some(spec), Some((path, file_name, file_bytes))) = (spec, upload) else {
        let _ = tokio::fs::remove_dir_all(&dir).await;
        return error(StatusCode::BAD_REQUEST, "envie os campos `spec` e `file`");
    };
    let meta = Meta {
        id: id.clone(),
        name: spec.name.clone(),
        file_name,
        file_bytes,
        created_at: store::now_ms(),
        status: Status::Queued,
        stage: None,
        progress: 0.0,
        error: None,
        spec,
        report: None,
    };
    app.store.insert(meta.clone());
    tracing::info!("dataset {id} recebido ({:.1} MB), na fila", file_bytes as f64 / 1e6);
    tokio::spawn(run_job(app, id, path));
    (StatusCode::ACCEPTED, Json(meta)).into_response()
}

async fn run_job(app: Shared, id: String, input: PathBuf) {
    let _permit = app.jobs.acquire().await.expect("fila");
    let Some(meta) = app.store.update(&id, true, |m| m.status = Status::Processing) else { return };
    let started = Instant::now();
    let worker = app.clone();
    let job_id = id.clone();
    let result = tokio::task::spawn_blocking(move || {
        let dir = worker.store.dir(&job_id);
        let progress = |stage: Stage, f: f32| {
            let label = format!("{stage:?}").to_lowercase();
            worker.store.update(&job_id, false, |m| {
                m.stage = Some(label);
                m.progress = f.clamp(0.0, 1.0);
            });
        };
        let report = tiler::process(&input, &dir, &meta.spec, &progress);
        // O arquivo enviado não é mais necessário (o CSV vira source.csv em UTF-8).
        if report.is_ok() && input.extension().is_some_and(|e| e == "csv") {
            let _ = std::fs::remove_file(&input);
        }
        report
    })
    .await;

    match result {
        Ok(Ok(report)) => {
            tracing::info!("dataset {id} pronto: {} pontos em {:.1}s", report.records, started.elapsed().as_secs_f64());
            app.store.update(&id, true, |m| {
                m.status = Status::Ready;
                m.stage = None;
                m.progress = 1.0;
                m.report = serde_json::to_value(&report).ok();
            });
        }
        Ok(Err(e)) => {
            tracing::warn!("dataset {id} falhou: {e}");
            app.store.update(&id, true, |m| {
                m.status = Status::Error;
                m.error = Some(e.to_string());
            });
        }
        Err(e) => {
            app.store.update(&id, true, |m| {
                m.status = Status::Error;
                m.error = Some(format!("falha interna: {e}"));
            });
        }
    }
}
