/// <reference lib="webworker" />
import {
  buildFeatures,
  detectColumns,
  guessLocation,
  guessStyleColumns,
  summarize,
  type ImportMapping,
  type Row,
} from "@cityview/importer";
import Papa from "papaparse";
import { MAX_BROWSER_ROWS, type Delimiter, type Encoding, type WorkerRequest, type WorkerResponse } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

const PREVIEW_ROWS = 50;
const DETECT_ROWS = 2000;

let rows: Row[] = [];
let lastMapping: ImportMapping | null = null;

const post = (msg: WorkerResponse) => self.postMessage(msg);

/** UTF-8 válido? Senão assume Windows-1252 (planilhas brasileiras exportadas pelo Excel). */
async function detectEncoding(file: File): Promise<Encoding> {
  const head = await file.slice(0, 1 << 20).arrayBuffer();
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true });
    return "utf-8";
  } catch {
    return "windows-1252";
  }
}

function open(file: File, delimiter: Delimiter | undefined, encoding: Encoding): Promise<Delimiter> {
  rows = [];
  let detected: Delimiter = delimiter ?? ",";
  let emptyHeaders = 0;
  return new Promise((resolve, reject) => {
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: "greedy",
      delimiter: delimiter ?? "",
      encoding,
      chunkSize: 4 << 20,
      transformHeader: (h) => h.trim() || `coluna_${++emptyHeaders}`,
      chunk: (results, parser) => {
        detected = results.meta.delimiter as Delimiter;
        for (const row of results.data) rows.push(row);
        post({ type: "progress", loaded: results.meta.cursor, total: file.size });
        if (rows.length > MAX_BROWSER_ROWS) {
          parser.abort();
          reject(
            new Error(
              `O arquivo tem mais de ${MAX_BROWSER_ROWS.toLocaleString("pt-BR")} linhas. ` +
                "Por enquanto o navegador processa até esse limite; arquivos maiores vão usar o motor local.",
            ),
          );
        }
      },
      complete: () => resolve(detected),
      error: (err) => reject(err),
    });
  });
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === "open") {
      const encoding = msg.options.encoding ?? (await detectEncoding(msg.file));
      const delimiter = await open(msg.file, msg.options.delimiter, encoding);
      if (rows.length === 0) throw new Error("Não encontramos linhas de dados no arquivo.");
      const headers = Object.keys(rows[0]!);
      const columns = detectColumns(headers, rows.slice(0, DETECT_ROWS));
      const location = guessLocation(columns);
      const style = guessStyleColumns(columns, location ? [location.lat, location.lon] : []);
      post({
        type: "opened",
        file: { headers, preview: rows.slice(0, PREVIEW_ROWS), rowCount: rows.length, delimiter, encoding, columns, location, style },
      });
    } else if (msg.type === "build") {
      lastMapping = msg.mapping;
      post({ type: "built", summary: summarize(rows, msg.mapping, msg.colorBy) });
    } else if (msg.type === "export") {
      if (!lastMapping) throw new Error("Nada para exportar: valide os dados antes.");
      const { features } = buildFeatures(rows, lastMapping);
      const json = JSON.stringify({ type: "FeatureCollection", features });
      post({ type: "exported", blob: new Blob([json], { type: "application/geo+json" }) });
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
