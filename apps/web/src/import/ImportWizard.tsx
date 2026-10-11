import type { DatapackManifest } from "@cityview/engine";
import { SECTOR_COLORS } from "@cityview/engine";
import { parseNumber, type ColumnInfo, type ColumnType, type ImportMapping } from "@cityview/importer";
import { useEffect, useMemo, useState } from "react";
import type { BuildSummary, Delimiter, Encoding, OpenedFile } from "./protocol";
import { useImportWorker } from "./useImportWorker";

export interface ImportedDataset {
  manifest: DatapackManifest;
  /** URL (blob:) do GeoJSON gerado; revogar ao remover o dataset. */
  dataUrl: string;
  count: number;
  bounds: [number, number, number, number];
  fileName: string;
}

interface ImportWizardProps {
  file: File;
  onCancel: () => void;
  onImport: (dataset: ImportedDataset) => void;
}

type Step = 0 | 1 | 2 | 3;
const STEPS = ["Arquivo", "Localização", "Colunas", "Revisão"];

const TYPE_LABELS: Record<ColumnType, string> = { number: "Número", category: "Categoria", date: "Data", text: "Texto" };
const DELIMITERS: { value: Delimiter; label: string }[] = [
  { value: ",", label: "Vírgula ( , )" },
  { value: ";", label: "Ponto e vírgula ( ; )" },
  { value: "\t", label: "Tabulação" },
  { value: "|", label: "Barra vertical ( | )" },
];
const REASONS: Record<string, string> = {
  "sem-coordenadas": "sem latitude/longitude",
  "coordenada-invalida": "coordenada que não é número",
  "fora-do-mundo": "coordenada impossível (ex.: 0,0)",
};
const MAX_COLOR_CATEGORIES = SECTOR_COLORS.length;

const int = new Intl.NumberFormat("pt-BR");
const formatBytes = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.ceil(b / 1e3)} KB`);

interface ColumnChoice {
  name: string;
  include: boolean;
  type: ColumnType;
}

export function ImportWizard({ file, onCancel, onImport }: ImportWizardProps) {
  const worker = useImportWorker();
  const [step, setStep] = useState<Step>(0);
  const [opened, setOpened] = useState<OpenedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [delimiter, setDelimiter] = useState<Delimiter | undefined>();
  const [encoding, setEncoding] = useState<Encoding | undefined>();
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [choices, setChoices] = useState<ColumnChoice[]>([]);
  const [title, setTitle] = useState("");
  const [colorBy, setColorBy] = useState("");
  const [name, setName] = useState(file.name.replace(/\.[^.]+$/, ""));
  const [built, setBuilt] = useState<BuildSummary | null>(null);
  const [building, setBuilding] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Abre (ou reabre, ao trocar separador/codificação) o arquivo no worker.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setOpened(null);
    worker
      .open(file, { delimiter, encoding })
      .then((o) => {
        if (cancelled) return;
        setOpened(o);
        setLat(o.location?.lat ?? "");
        setLon(o.location?.lon ?? "");
        setChoices(o.columns.map((c) => ({ name: c.name, include: true, type: c.type })));
        setTitle(o.style.title ?? "");
        setColorBy(o.style.colorBy ?? "");
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [file, delimiter, encoding, worker.open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const columnInfo = (n: string): ColumnInfo | undefined => opened?.columns.find((c) => c.name === n);

  const mapping = useMemo<ImportMapping | null>(() => {
    if (!opened || !lat || !lon) return null;
    return {
      lat,
      lon,
      latLocale: columnInfo(lat)?.locale,
      lonLocale: columnInfo(lon)?.locale,
      columns: choices
        .filter((c) => c.include && c.name !== lat && c.name !== lon)
        .map((c) => ({ name: c.name, type: c.type, locale: columnInfo(c.name)?.locale })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, lat, lon, choices]);

  // Validação rápida na amostra para dar confiança no passo de localização.
  const sampleCheck = useMemo(() => {
    if (!opened || !lat || !lon) return null;
    let valid = 0;
    let brazil = 0;
    for (const row of opened.preview) {
      const y = parseNumber(row[lat], columnInfo(lat)?.locale);
      const x = parseNumber(row[lon], columnInfo(lon)?.locale);
      if (y === null || x === null || Math.abs(y) > 90 || Math.abs(x) > 180) continue;
      valid++;
      if (y >= -34 && y <= 6 && x >= -74 && x <= -34) brazil++;
    }
    return { valid, brazil, total: opened.preview.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, lat, lon]);

  const goToReview = async () => {
    if (!mapping) return;
    setStep(3);
    setBuilding(true);
    setBuilt(null);
    try {
      setBuilt(await worker.build(mapping, colorBy || undefined));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBuilding(false);
    }
  };

  const categories = useMemo(
    () => (built && colorBy ? built.categories.slice(0, MAX_COLOR_CATEGORIES) : []),
    [built, colorBy],
  );

  const finish = async () => {
    if (!built?.bounds || !mapping) return;
    setExporting(true);
    let blob: Blob;
    try {
      blob = await worker.exportBlob();
    } catch (e) {
      setError((e as Error).message);
      setExporting(false);
      return;
    }
    const included = mapping.columns;
    const ordered = [...included].sort((a, b) => (a.name === title ? -1 : b.name === title ? 1 : 0));
    const manifest: DatapackManifest = {
      id: `user-${Date.now()}`,
      name: name.trim() || file.name,
      description: `Importado de ${file.name}`,
      category: "Seus dados",
      geometry: "point",
      source: { name: `Arquivo enviado: ${file.name}`, url: "" },
      license: { name: "Dado do usuário", url: "", commercial: true },
      attribution: "",
      refresh: `Importado em ${new Date().toLocaleString("pt-BR")}`,
      render: {
        type: "points",
        color: "#5b6475",
        ...(colorBy && categories.length
          ? {
              colorBy: {
                property: colorBy,
                categories: categories.map(([c]) => c),
                colors: categories.map((_, i) => SECTOR_COLORS[i]!),
              },
            }
          : {}),
      },
      fields: ordered.map((c) => ({
        key: c.name,
        label: c.name,
        ...(c.type === "number" ? { format: "decimal" as const } : c.type === "date" ? { format: "date" as const } : {}),
      })),
    };
    onImport({
      manifest,
      dataUrl: URL.createObjectURL(blob),
      count: built.count,
      bounds: built.bounds,
      fileName: file.name,
    });
  };

  const canContinue =
    (step === 0 && opened !== null) ||
    (step === 1 && Boolean(lat && lon && lat !== lon)) ||
    (step === 2 && mapping !== null) ||
    (step === 3 && Boolean(built && built.count > 0) && !exporting);

  const next = () => {
    if (step === 2) void goToReview();
    else if (step === 3) void finish();
    else setStep((s) => (s + 1) as Step);
  };

  const columnNames = opened?.headers ?? [];
  const textLike = choices.filter((c) => c.include && (c.type === "text" || c.type === "category"));
  const categoryCols = choices.filter((c) => c.include && c.type === "category" && c.name !== lat && c.name !== lon);

  return (
    <div className="wizard-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="wizard" role="dialog" aria-modal="true" aria-labelledby="wizard-title">
        <header className="wizard-header">
          <h2 id="wizard-title">Importar dados</h2>
          <ol className="wizard-steps">
            {STEPS.map((label, i) => (
              <li key={label} className={i === step ? "is-current" : i < step ? "is-done" : ""}>
                <span>{i + 1}</span>
                {label}
              </li>
            ))}
          </ol>
          <button type="button" className="wizard-close" onClick={onCancel} aria-label="Cancelar importação">
            ×
          </button>
        </header>

        <div className="wizard-body">
          {error && <p className="wizard-error">{error}</p>}

          {!opened && !error && (
            <div className="wizard-loading">
              <p>
                Lendo <b>{file.name}</b> ({formatBytes(file.size)})…
              </p>
              <div className="progress">
                <div style={{ width: `${Math.round((worker.progress ?? 0) * 100)}%` }} />
              </div>
            </div>
          )}

          {opened && step === 0 && (
            <>
              <p className="wizard-lead">
                <b>{file.name}</b> · {formatBytes(file.size)} · <b>{int.format(opened.rowCount)}</b> linhas ·{" "}
                {opened.headers.length} colunas
              </p>
              <div className="wizard-row">
                <label>
                  Separador
                  <select value={delimiter ?? opened.delimiter} onChange={(e) => setDelimiter(e.target.value as Delimiter)}>
                    {DELIMITERS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Codificação
                  <select value={encoding ?? opened.encoding} onChange={(e) => setEncoding(e.target.value as Encoding)}>
                    <option value="utf-8">UTF-8</option>
                    <option value="windows-1252">Latin-1 / Windows (Excel)</option>
                  </select>
                </label>
              </div>
              {opened.headers.length === 1 && (
                <p className="wizard-warn">Só encontramos uma coluna. O separador provavelmente está errado.</p>
              )}
              <PreviewTable headers={opened.headers} rows={opened.preview.slice(0, 8)} />
            </>
          )}

          {opened && step === 1 && (
            <>
              <p className="wizard-lead">Como cada linha vira um lugar no mapa?</p>
              <div className="wizard-options">
                <label className="option is-selected">
                  <input type="radio" checked readOnly />
                  <div>
                    <b>Colunas de latitude e longitude</b>
                    {opened.location ? (
                      <span>
                        Detectamos {opened.location.reason === "names" ? "pelos nomes das colunas" : "pelos valores"}.
                        Confira abaixo.
                      </span>
                    ) : (
                      <span>Escolha as colunas abaixo.</span>
                    )}
                  </div>
                </label>
                <label className="option is-disabled">
                  <input type="radio" disabled />
                  <div>
                    <b>Endereço ou CEP</b>
                    <span>Em breve: vamos localizar os endereços para você.</span>
                  </div>
                </label>
              </div>
              <div className="wizard-row">
                <label>
                  Latitude
                  <select value={lat} onChange={(e) => setLat(e.target.value)}>
                    <option value="">Escolha…</option>
                    {columnNames.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="swap"
                  onClick={() => {
                    setLat(lon);
                    setLon(lat);
                  }}
                  title="Inverter latitude e longitude"
                >
                  ⇄
                </button>
                <label>
                  Longitude
                  <select value={lon} onChange={(e) => setLon(e.target.value)}>
                    <option value="">Escolha…</option>
                    {columnNames.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
              {sampleCheck && (
                <p className={sampleCheck.brazil >= sampleCheck.total * 0.8 ? "wizard-ok" : "wizard-warn"}>
                  Na amostra, {sampleCheck.valid} de {sampleCheck.total} linhas têm coordenadas válidas e{" "}
                  {sampleCheck.brazil} caem no Brasil.
                  {sampleCheck.valid > 0 && sampleCheck.brazil === 0 && " Latitude e longitude podem estar trocadas."}
                </p>
              )}
            </>
          )}

          {opened && step === 2 && (
            <>
              <p className="wizard-lead">Quais colunas levar para o mapa, e como interpretá-las?</p>
              <table className="columns-table">
                <thead>
                  <tr>
                    <th aria-label="Incluir" />
                    <th>Coluna</th>
                    <th>Tipo</th>
                    <th>Exemplos</th>
                  </tr>
                </thead>
                <tbody>
                  {choices
                    .filter((c) => c.name !== lat && c.name !== lon)
                    .map((c) => (
                      <tr key={c.name} className={c.include ? "" : "is-off"}>
                        <td>
                          <input
                            type="checkbox"
                            checked={c.include}
                            aria-label={`Incluir ${c.name}`}
                            onChange={(e) =>
                              setChoices((all) => all.map((x) => (x.name === c.name ? { ...x, include: e.target.checked } : x)))
                            }
                          />
                        </td>
                        <td>{c.name}</td>
                        <td>
                          <select
                            value={c.type}
                            onChange={(e) =>
                              setChoices((all) =>
                                all.map((x) => (x.name === c.name ? { ...x, type: e.target.value as ColumnType } : x)),
                              )
                            }
                          >
                            {Object.entries(TYPE_LABELS).map(([v, l]) => (
                              <option key={v} value={v}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="muted">{columnInfo(c.name)?.examples.join(" · ")}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <div className="wizard-row">
                <label>
                  Título do ponto
                  <select value={title} onChange={(e) => setTitle(e.target.value)}>
                    <option value="">Nenhum</option>
                    {textLike.map((c) => (
                      <option key={c.name}>{c.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Colorir por
                  <select value={colorBy} onChange={(e) => setColorBy(e.target.value)}>
                    <option value="">Uma cor só</option>
                    {categoryCols.map((c) => (
                      <option key={c.name}>{c.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          )}

          {opened && step === 3 && (
            <>
              <label className="wizard-name">
                Nome no mapa
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              {building && <p className="muted">Preparando os pontos…</p>}
              {built && (
                <div className="review">
                  <p className="wizard-ok">
                    <b>{int.format(built.count)}</b> pontos prontos para o mapa.
                  </p>
                  {built.invalidCount > 0 && (
                    <details className="wizard-warn">
                      <summary>
                        <b>{int.format(built.invalidCount)}</b> linhas serão ignoradas
                      </summary>
                      <ul>
                        {Object.entries(built.reasons)
                          .filter(([, n]) => n > 0)
                          .map(([reason, n]) => (
                            <li key={reason}>
                              {int.format(n)} {REASONS[reason]}
                            </li>
                          ))}
                      </ul>
                      <p className="muted">
                        Exemplos (linha da planilha): {built.invalidSample.slice(0, 10).map((r) => r.line).join(", ")}
                      </p>
                    </details>
                  )}
                  {built.outsideBrazil > 0 && (
                    <p className="wizard-warn">{int.format(built.outsideBrazil)} pontos ficam fora do Brasil.</p>
                  )}
                  {categories.length > 0 && (
                    <div className="legend">
                      <span className="muted">Cores por {colorBy}:</span>
                      {categories.map(([c, n], i) => (
                        <span key={c} className="legend-item">
                          <i style={{ background: SECTOR_COLORS[i] }} />
                          {c} <span className="muted">({int.format(n)})</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <footer className="wizard-footer">
          <button type="button" className="btn" onClick={step === 0 ? onCancel : () => setStep((s) => (s - 1) as Step)}>
            {step === 0 ? "Cancelar" : "Voltar"}
          </button>
          <button type="button" className="btn btn-primary" disabled={!canContinue} onClick={next}>
            {step === 3 ? (exporting ? "Importando…" : "Importar para o mapa") : "Continuar"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function PreviewTable({ headers, rows }: { headers: string[]; rows: Record<string, string>[] }) {
  return (
    <div className="preview">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {headers.map((h) => (
                <td key={h}>{r[h]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
