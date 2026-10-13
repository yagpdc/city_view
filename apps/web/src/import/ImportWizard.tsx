import type { DatapackManifest } from "@cityview/engine";
import { CATEGORY_COLORS } from "@cityview/engine";
import {
  applyCoordinateFix,
  BRAZIL_UTM_ZONES,
  inBrazil,
  readCoordinates,
  suggestCoordinateFix,
  type ColumnInfo,
  type CoordinateFix,
  type ImportMapping,
  type ImportSummary,
  type RecipeStep,
} from "@cityview/importer";
import { useEffect, useMemo, useRef, useState } from "react";
import { BuilderStep, type ColumnChoice } from "./BuilderStep";
import type { ImportSpec } from "../server/api";
import { LARGE_FILE_BYTES, SAMPLE_ROWS, SERVER_FORMATS, fileFormat, type BuildSummary, type Delimiter, type Encoding, type OpenedFile } from "./protocol";
import { useImportWorker } from "./useImportWorker";
import { Icon } from "../components/Icon";

export interface ImportedDataset {
  manifest: DatapackManifest;
  /** PMTiles (motor em WASM) ou, se ele falhar, GeoJSON — gerados no worker, sem sair do computador. */
  data: Blob;
  format: "geojson" | "pmtiles";
  count: number;
  bounds: [number, number, number, number];
  fileName: string;
}

interface ImportWizardProps {
  file: File;
  /** Servidor local disponível (processa arquivos de qualquer tamanho). */
  serverAvailable: boolean;
  onCancel: () => void;
  onImport: (dataset: ImportedDataset) => void;
  onSendToServer: (file: File, spec: ImportSpec) => void;
}

type Step = 0 | 1 | 2 | 3;
const STEPS = ["Arquivo", "Localização", "Dados", "Revisão"];
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
const MAX_COLOR_CATEGORIES = CATEGORY_COLORS.length;

const int = new Intl.NumberFormat("pt-BR");
const formatBytes = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.ceil(b / 1e3)} KB`);

export function ImportWizard({ file, serverAvailable, onCancel, onImport, onSendToServer }: ImportWizardProps) {
  const worker = useImportWorker();
  // Arquivo grande + servidor de pé: o navegador só lê uma amostra; o motor em Rust faz o resto.
  // O motor em Rust lê CSV e Parquet; Excel e GeoJSON ficam no navegador.
  const serverFormat = SERVER_FORMATS.includes(fileFormat(file.name) ?? "csv");
  // Arquivo grande (CSV/Parquet): o assistente lê só uma amostra; na importação o arquivo é relido inteiro
  // em colunas — no navegador (motor em WASM) ou, se você escolher, no servidor local.
  const [sampleOnly] = useState(() => serverFormat && file.size > LARGE_FILE_BYTES);
  // Seus arquivos ficam no seu computador (docs/adr/0002): servidor só se você marcar.
  const [useServer, setUseServer] = useState(false);
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
  /** Ajustes do builder (receita); o arquivo original não muda. */
  const [recipe, setRecipe] = useState<RecipeStep[]>([]);
  const [sheet, setSheet] = useState<string | undefined>();
  /** Localização em duas colunas (lat/lon) ou numa só ("-23.5, -46.6"). */
  const [locMode, setLocMode] = useState<"pair" | "single">("pair");
  const [latlon, setLatlon] = useState("");
  const [fix, setFix] = useState<CoordinateFix | undefined>();
  const [utmZone, setUtmZone] = useState(23);
  const [failed, setFailed] = useState<{ url: string; count: number } | null>(null);
  const appliedRecipe = useRef<RecipeStep[]>([]);

  // Abre (ou reabre, ao trocar separador/codificação) o arquivo no worker.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setOpened(null);
    worker
      .open(file, { delimiter, encoding, sheet, previewRows: sampleOnly ? SAMPLE_ROWS : undefined })
      .then((o) => {
        if (cancelled) return;
        setOpened(o);
        setRecipe([]);
        appliedRecipe.current = [];
        setFix(undefined);
        setLat(o.location?.lat ?? "");
        setLon(o.location?.lon ?? "");
        setLatlon(o.location?.latlon ?? "");
        setLocMode(o.location?.latlon ? "single" : "pair");
        setChoices(o.columns.map((c) => ({ name: c.name, include: true, type: c.type })));
        setTitle(o.style.title ?? "");
        setColorBy(o.style.colorBy ?? "");
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [file, delimiter, encoding, sheet, worker.open, sampleOnly]);

  // Receita mudou: o worker aplica na amostra e devolve colunas, prévia e tipos novos.
  useEffect(() => {
    if (!opened || recipe === appliedRecipe.current) return;
    appliedRecipe.current = recipe;
    let cancelled = false;
    worker
      .setRecipe(recipe)
      .then((o) => {
        if (cancelled) return;
        setOpened(o);
        // Mantém o que a pessoa já escolheu; colunas novas entram incluídas com o tipo detectado.
        setChoices((prev) => o.columns.map((c) => { const x = prev.find((p) => p.name === c.name); return x ? { ...x, type: x.locked ? x.type : c.type } : { name: c.name, include: true, type: c.type }; }));
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const columnInfo = (n: string): ColumnInfo | undefined => opened?.columns.find((c) => c.name === n);

  const locationColumns = locMode === "single" ? [latlon] : [lat, lon];
  const mapping = useMemo<ImportMapping | null>(() => {
    if (!opened) return null;
    if (locMode === "single" ? !latlon : !lat || !lon) return null;
    return {
      lat: locMode === "single" ? "" : lat,
      lon: locMode === "single" ? "" : lon,
      ...(locMode === "single" ? { latlon } : {}),
      ...(fix ? { fix } : {}),
      latLocale: columnInfo(lat)?.locale,
      lonLocale: columnInfo(lon)?.locale,
      columns: choices
        .filter((c) => c.include && !locationColumns.includes(c.name))
        .map((c) => ({ name: c.name, type: c.type, locale: columnInfo(c.name)?.locale })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, lat, lon, latlon, locMode, fix, choices]);

  // Validação rápida na amostra (com a correção escolhida) e a correção sugerida, se houver.
  const sampleCheck = useMemo(() => {
    if (!opened || !mapping) return null;
    let valid = 0;
    let brazil = 0;
    const pairs: [number, number][] = [];
    for (const row of opened.preview) {
      const c = readCoordinates(row, { ...mapping, fix: undefined });
      if (c === null || c === "empty") continue;
      pairs.push(c);
      const [y, x] = fix ? applyCoordinateFix(fix, c[0], c[1]) : c;
      if (Math.abs(y) > 90 || Math.abs(x) > 180) continue;
      valid++;
      if (inBrazil(y, x)) brazil++;
    }
    return { valid, brazil, total: opened.preview.length, suggestion: fix ? null : suggestCoordinateFix(pairs) };
  }, [opened, mapping, fix]);

  const goToReview = async (): Promise<ImportSummary | null> => {
    if (!mapping) return null;
    setStep(3);
    setBuilding(true);
    setBuilt(null);
    setFailed(null);
    try {
      const summary = await worker.build(mapping, colorBy || undefined);
      setBuilt(summary);
      return summary;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBuilding(false);
    }
  };

  /** Aceita o que detectamos e importa sem passar pelos ajustes. */
  const uploadDirect = async () => {
    const summary = await goToReview();
    if (summary && summary.count > 0) void finish(summary);
  };

  const downloadFailed = async () => {
    try {
      const { blob, count } = await worker.failedRows();
      setFailed({ url: URL.createObjectURL(blob), count });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const categories = useMemo(
    () => (built && colorBy ? built.categories.slice(0, MAX_COLOR_CATEGORIES) : []),
    [built, colorBy],
  );

  const sendToServer = () => {
    if (!mapping || !opened) return;
    const spec: ImportSpec = {
      name: name.trim() || file.name,
      lat: mapping.lat,
      lon: mapping.lon,
      latLocale: mapping.latLocale,
      lonLocale: mapping.lonLocale,
      columns: mapping.columns,
      colorBy: colorBy || undefined,
      title: title || undefined,
      delimiter: delimiter ?? opened.delimiter,
      encoding: encoding ?? opened.encoding,
    };
    onSendToServer(file, spec);
  };

  const finish = async (summary: ImportSummary | null = built) => {
    if (useServer) return sendToServer();
    if (!summary?.bounds || !mapping) return;
    setExporting(true);
    let blob: Blob;
    let format: ImportedDataset["format"] = "pmtiles";
    try {
      // Motor de tiles no navegador: hexágonos agregados + pontos, como os datasets do servidor.
      blob = (
        await worker.tiles({
          name: name.trim() || file.name,
          colorBy: colorBy || undefined,
          title: title || undefined,
          ...(sampleOnly && opened ? { file: { file, delimiter: delimiter ?? opened.delimiter, encoding: encoding ?? opened.encoding } } : {}),
        })
      ).blob;
    } catch (tilesError) {
      console.warn("[import] motor de tiles indisponível; usando GeoJSON", tilesError);
      format = "geojson";
      try {
        blob = await worker.exportBlob();
      } catch (e) {
        setError((e as Error).message);
        setExporting(false);
        return;
      }
    }
    const included = mapping.columns;
    const ordered = [...included].sort((a, b) => (a.name === title ? -1 : b.name === title ? 1 : 0));
    const cats = colorBy ? summary.categories.slice(0, MAX_COLOR_CATEGORIES) : [];
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
        color: "#6b7485", // --cv-data-other
        ...(colorBy && cats.length
          ? {
              colorBy: {
                property: colorBy,
                categories: cats.map(([c]) => c),
                colors: cats.map((_, i) => CATEGORY_COLORS[i]!),
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
      data: blob,
      format,
      count: summary.count,
      bounds: summary.bounds,
      fileName: file.name,
    });
  };

  const canContinue =
    (step === 0 && opened !== null) ||
    (step === 1 && mapping !== null && (locMode === "single" || lat !== lon)) ||
    (step === 2 && mapping !== null) ||
    (step === 3 && Boolean(built && built.count > 0) && !exporting);

  const next = () => {
    if (step === 2) void goToReview();
    else if (step === 3) void finish();
    else setStep((s) => (s + 1) as Step);
  };

  const columnNames = opened?.headers ?? [];

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
            <Icon name="close" />
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
                <b>{file.name}</b> · {formatBytes(file.size)} ·{" "}
                {opened.sampled ? (
                  <>amostra de {int.format(opened.rowCount)} linhas</>
                ) : (
                  <>
                    <b>{int.format(opened.rowCount)}</b> linhas
                  </>
                )}{" "}
                · {opened.headers.length} colunas
              </p>
              {opened.sampled && (
                <p className="wizard-ok">
                  Arquivo grande: lemos uma amostra para você configurar; ao importar, o arquivo inteiro é processado
                  aqui no seu computador.
                </p>
              )}
              {opened.note && <p className="wizard-warn">{opened.note}</p>}
              {opened.sheets && (
                <div className="wizard-row">
                  <label>
                    Aba da planilha
                    <select value={opened.sheet} onChange={(e) => setSheet(e.target.value)}>
                      {opened.sheets.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {opened.headerRow > 0 && (
                <p className="wizard-ok">
                  Os nomes das colunas estão na linha {opened.headerRow + 1}; as linhas acima (títulos, datas) ficaram de fora.
                </p>
              )}
              {opened.junk.length > 0 && (
                <div className="wizard-warn wizard-junk">
                  <b>Linhas que não parecem registros</b>
                  <ul>
                    {opened.junk.map((j) => {
                      const applied = recipe.some((s) => JSON.stringify(s) === JSON.stringify(j.step));
                      return (
                        <li key={j.kind + j.rows[0]}>
                          <span>
                            {j.message} <span className="muted">(linha{j.rows.length > 1 ? "s" : ""} {j.rows.slice(0, 5).join(", ")}{j.rows.length > 5 ? "…" : ""})</span>
                          </span>
                          {applied ? (
                            <span className="wizard-junk-done">Removida{j.rows.length > 1 ? "s" : ""}</span>
                          ) : (
                            <button type="button" className="btn btn-sm" onClick={() => setRecipe((r) => [...r, j.step])}>
                              Remover
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {opened.location ? (
                <p className="wizard-ok">
                  Localização encontrada:{" "}
                  <b>{opened.location.latlon ? `"${opened.location.latlon}"` : `"${opened.location.lat}" e "${opened.location.lon}"`}</b>. Dá para{" "}
                  <b>subir direto</b> ou ajustar os dados antes.
                </p>
              ) : (
                <div className="wizard-warn">
                  <b>Não achamos a localização das linhas.</b> Para aparecer no mapa, cada linha precisa de latitude e longitude
                  (em duas colunas ou numa só, como "-23,55, -46,63"). No próximo passo você pode escolher as colunas certas.
                  Endereço, CEP e cidade chegam em breve.
                </div>
              )}
              {opened.format === "csv" && (
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
                    <option value="utf-16le">UTF-16 (Excel "Texto Unicode")</option>
                  </select>
                </label>
              </div>
              )}
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
                <label className={`option ${locMode === "pair" ? "is-selected" : ""}`}>
                  <input type="radio" checked={locMode === "pair"} onChange={() => setLocMode("pair")} />
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
                <label className={`option ${locMode === "single" ? "is-selected" : ""}`}>
                  <input type="radio" checked={locMode === "single"} onChange={() => setLocMode("single")} />
                  <div>
                    <b>As duas numa coluna só</b>
                    <span>Ex.: "-23,55; -46,63", "(-23.55, -46.63)" ou "POINT(-46.63 -23.55)".</span>
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
              {locMode === "single" ? (
                <div className="wizard-row">
                  <label>
                    Coluna com latitude e longitude
                    <select value={latlon} onChange={(e) => setLatlon(e.target.value)}>
                      <option value="">Escolha…</option>
                      {columnNames.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : (
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
              )}
              {sampleCheck && (
                <p className={sampleCheck.brazil >= sampleCheck.total * 0.8 ? "wizard-ok" : "wizard-warn"}>
                  Na amostra, {sampleCheck.valid} de {sampleCheck.total} linhas têm coordenadas válidas e{" "}
                  {sampleCheck.brazil} caem no Brasil.
                </p>
              )}
              {sampleCheck?.suggestion && sampleCheck.suggestion.kind !== "none" && (
                <div className="wizard-warn wizard-fix">
                  <span>
                    {sampleCheck.suggestion.kind === "swap"
                      ? "Parece que latitude e longitude estão trocadas."
                      : sampleCheck.suggestion.kind === "utm"
                        ? "As coordenadas parecem estar em metros (UTM, SIRGAS 2000). Escolha o fuso e converta:"
                        : `Parece que falta o ponto decimal nas coordenadas (ex.: -2355052 → -23,55052).`}
                    {sampleCheck.suggestion.kind === "utm" && (
                      <select
                        className="wizard-zone"
                        value={utmZone}
                        onChange={(e) => setUtmZone(Number(e.target.value))}
                        aria-label="Fuso UTM"
                      >
                        {BRAZIL_UTM_ZONES.map((z) => (
                          <option key={z} value={z}>
                            Fuso {z} S{z === 23 ? " (SP, RJ, MG…)" : z === 22 ? " (PR, SC, GO…)" : z === 24 ? " (BA, ES…)" : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setFix(sampleCheck.suggestion!.kind === "utm" ? { ...sampleCheck.suggestion!, zone: utmZone } : sampleCheck.suggestion!)}
                  >
                    {sampleCheck.suggestion.kind === "utm" ? "Converter" : "Corrigir"}
                  </button>
                </div>
              )}
              {fix && (
                <div className="wizard-ok wizard-fix">
                  <span>
                    {fix.kind === "swap"
                      ? "Corrigido: latitude e longitude invertidas."
                      : fix.kind === "utm"
                        ? `Convertido de UTM (fuso ${fix.zone} S).`
                        : "Corrigido: ponto decimal colocado."}
                  </span>
                  <button type="button" className="btn btn-sm" onClick={() => setFix(undefined)}>
                    Desfazer
                  </button>
                </div>
              )}
            </>
          )}

          {opened && step === 2 && (
            <BuilderStep
              opened={opened}
              choices={choices}
              onChoices={setChoices}
              recipe={recipe}
              onRecipe={setRecipe}
              locationColumns={locationColumns}
              profile={worker.profile}
              title={title}
              onTitle={setTitle}
              colorBy={colorBy}
              onColorBy={setColorBy}
            />
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
                  {serverAvailable && serverFormat && recipe.length === 0 && (
                    <label className="server-toggle">
                      <input type="checkbox" checked={useServer} onChange={(e) => setUseServer(e.target.checked)} />
                      <span>
                        <b>Processar no servidor local</b> — fica disponível em qualquer navegador e aguenta arquivos de
                        qualquer tamanho
                      </span>
                    </label>
                  )}
                  <p className="wizard-ok">
                    {opened.sampled ? (
                      <>
                        Na amostra, <b>{int.format(built.count)}</b> de {int.format(opened.rowCount)} linhas viram ponto.
                        O total sai depois do processamento.
                      </>
                    ) : (
                      <>
                        <b>{int.format(built.count)}</b> pontos prontos para o mapa.
                      </>
                    )}
                  </p>
                  {built.invalidCount > 0 && (
                    <details className="wizard-warn">
                      <summary>
                        <b>{int.format(built.invalidCount)}</b> {built.invalidCount === 1 ? "linha será ignorada" : "linhas serão ignoradas"}
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
                      {failed ? (
                        <a className="btn btn-sm" href={failed.url} download={`${name || "planilha"}-linhas-com-problema.csv`}>
                          {failed.count === 1 ? "Baixar a linha com problema" : `Baixar as ${int.format(failed.count)} linhas com problema`}
                        </a>
                      ) : (
                        <button type="button" className="btn btn-sm" onClick={() => void downloadFailed()}>
                          Preparar planilha com as linhas que ficaram de fora
                        </button>
                      )}
                    </details>
                  )}
                  <p className="wizard-note">
                    <Icon name="info" size={16} /> Seus dados ficam só <b>neste navegador</b>: não vão para nenhum servidor. Se você limpar os
                    dados do navegador ou trocar de computador, precisa importar de novo.
                  </p>
                  {built.farPoints > 0 && (
                    <p className="wizard-warn">
                      {built.farPoints === 1 ? "1 ponto está" : `~${int.format(built.farPoints)} pontos estão`} muito longe dos demais (provável erro de digitação). O
                      mapa vai enquadrar só a região principal.
                    </p>
                  )}
                  {built.outsideBrazil > 0 && (
                    <p className="wizard-warn">{int.format(built.outsideBrazil)} pontos ficam fora do Brasil.</p>
                  )}
                  {categories.length > 0 && (
                    <div className="legend">
                      <span className="muted">Cores por {colorBy}:</span>
                      {categories.map(([c, n], i) => (
                        <span key={c} className="legend-item">
                          <i style={{ background: CATEGORY_COLORS[i] }} />
                          {c} <span className="muted">({int.format(n)})</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {exporting && <TilingProgress tiling={worker.tiling} />}
        </div>

        <footer className="wizard-footer">
          <button type="button" className="btn" onClick={step === 0 ? onCancel : () => setStep((s) => (s - 1) as Step)}>
            {step === 0 ? "Cancelar" : "Voltar"}
          </button>
          {step === 0 && opened?.location && (
            <button type="button" className="btn" onClick={() => void uploadDirect()} disabled={exporting || building}>
              Subir direto
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={!canContinue} onClick={next}>
            {step === 0
              ? "Ajustar os dados"
              : step === 3
              ? useServer
                ? "Enviar ao servidor"
                : exporting
                  ? "Importando…"
                  : "Importar para o mapa"
              : "Continuar"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Andamento do motor de tiles (WASM): etapa em palavras e barra geral. */
function TilingProgress({ tiling }: { tiling: { stage: string; fraction: number } | null }) {
  const [label, overall] = !tiling
    ? ["Preparando os pontos…", 0.02]
    : tiling.stage === "reading"
      ? ["Lendo o arquivo inteiro…", Math.min(1, tiling.fraction) * 0.4]
      : tiling.stage === "tiling"
        ? ["Gerando os tiles do mapa…", 0.5 + Math.min(1, tiling.fraction) * 0.45]
        : tiling.stage === "writing"
          ? ["Guardando neste navegador…", 0.95 + tiling.fraction * 0.05]
          : ["Agregando em hexágonos…", 0.45];
  return (
    <div className="wizard-loading tiling-progress" aria-live="polite">
      <p>
        {label} <span className="muted num">{Math.round(overall * 100)}%</span>
      </p>
      <div className="progress">
        <div style={{ width: `${Math.round(overall * 100)}%` }} />
      </div>
      <p className="muted">Tudo acontece no seu computador: o arquivo não é enviado a lugar nenhum.</p>
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
