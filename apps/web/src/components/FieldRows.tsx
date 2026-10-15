import type { DatapackField } from "@pinny/engine";
import { Fragment } from "react";
import { Icon, type IconName } from "./Icon";
import { formatField, linkLabel } from "./PickDetails";

/**
 * Campos de um registro como componentes, não texto solto: cada valor ganha ícone, rótulo e formato pelo que ele é
 * (site, telefone, e-mail, rede social, data, nota de confiança, número), reconhecido pelo nome da coluna e pelo
 * valor. Vale para qualquer planilha; os Estabelecimentos só têm rótulos melhores.
 */

type Kind = "link" | "social" | "phone" | "email" | "date" | "score" | "number" | "code" | "place" | "text";
type Group = "contact" | "details" | "source";

export interface FieldEntry {
  key: string;
  label: string;
  value: string | number;
}

const SOCIAL = /facebook\.com|instagram\.com|(twitter|x)\.com|linkedin\.com|tiktok\.com|youtube\.com|youtu\.be/i;
const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s);

function kindOf(key: string, value: string | number): Kind {
  const k = key.toLowerCase();
  if (typeof value === "number") {
    // Nota entre 0 e 1 com nome de confiança/qualidade: medidor.
    if (value >= 0 && value <= 1 && /confian|score|qualid|prob/.test(k)) return "score";
    return "number";
  }
  const text = value.trim();
  const urls = text.split(/\s+/);
  if (urls.every(isUrl)) return urls.every((u) => SOCIAL.test(u)) || /rede|social/.test(k) ? "social" : "link";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return "email";
  if (/^\+?[\d\s().-]+$/.test(text) && text.replace(/\D/g, "").length >= 10 && !/cep|cpf|cnpj|codigo|código|id$/.test(k)) return "phone";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return "date";
  if (/cep|zip|cnpj|cpf|codigo|código/.test(k)) return "code";
  if (/ender|address|logradouro|bairro|cidade|munic|^uf$|estado|city|state/.test(k)) return "place";
  return "text";
}

function groupOf(key: string, kind: Kind): Group {
  if (kind === "link" || kind === "social" || kind === "phone" || kind === "email") return "contact";
  if (kind === "date" || kind === "score" || /origem|fonte|source|atualiz/.test(key.toLowerCase())) return "source";
  return "details";
}

const ICON: Record<Kind, IconName> = {
  link: "globe",
  social: "at",
  phone: "phone",
  email: "mail",
  date: "calendar",
  score: "shield",
  number: "chart",
  code: "tag",
  place: "pin",
  text: "tag",
};

const GROUP_TITLE: Record<Group, string> = { contact: "Contato", details: "Detalhes", source: "Sobre o dado" };

const dec = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const day = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "+551132664043" → "+55 11 3266-4043"; números de outro formato ficam como vieram. */
export function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  const br = d.startsWith("55") && (d.length === 12 || d.length === 13) ? d.slice(2) : d.length === 10 || d.length === 11 ? d : null;
  if (!br) return raw.trim();
  const ddd = br.slice(0, 2);
  const rest = br.slice(2);
  const cut = rest.length - 4;
  return `${d.startsWith("55") && br !== d ? "+55 " : ""}${ddd} ${rest.slice(0, cut)}-${rest.slice(cut)}`;
}

/** Códigos técnicos de categoria ("professional_service") viram texto ("Professional service"). */
export function humanize(text: string): string {
  if (!/^[a-z0-9]+(_[a-z0-9]+)+$/.test(text)) return text;
  const s = text.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function scoreLabel(v: number): { label: string; tone: "high" | "mid" | "low" } {
  if (v >= 0.7) return { label: "Alta", tone: "high" };
  if (v >= 0.4) return { label: "Média", tone: "mid" };
  return { label: "Baixa", tone: "low" };
}

function Value({ kind, value }: { kind: Kind; value: string | number }) {
  if (typeof value === "number") {
    if (kind === "score") {
      const s = scoreLabel(value);
      return (
        <span className={`field-score is-${s.tone}`}>
          <span className="field-score-track" aria-hidden="true">
            <span style={{ width: `${Math.round(value * 100)}%` }} />
          </span>
          <span>
            {s.label} <span className="muted num">{dec.format(value)}</span>
          </span>
        </span>
      );
    }
    return <span className="num">{Number.isInteger(value) && Math.abs(value) < 10000 ? String(value) : dec.format(value)}</span>;
  }
  const text = value.trim();
  switch (kind) {
    case "link":
    case "social":
      return (
        <span className="field-links">
          {text.split(/\s+/).map((u, i) => (
            <Fragment key={u}>
              {i > 0 && <span className="muted"> · </span>}
              <a href={u} target="_blank" rel="noreferrer">
                {linkLabel(u)}
              </a>
            </Fragment>
          ))}
        </span>
      );
    case "email":
      return <a href={`mailto:${text}`}>{text}</a>;
    case "phone":
      return <a href={`tel:${text.replace(/[^\d+]/g, "")}`}>{formatPhone(text)}</a>;
    case "date": {
      const d = new Date(text.slice(0, 10));
      return <>{Number.isNaN(d.getTime()) ? text : day.format(d)}</>;
    }
    case "code":
      return <span className="num">{text}</span>;
    default:
      return <>{humanize(text)}</>;
  }
}

/** Campos agrupados (Contato · Detalhes · Sobre o dado), cada um com ícone, rótulo e valor formatado. */
export function FieldRows({ fields, compact }: { fields: FieldEntry[]; compact?: boolean }) {
  const rows = fields
    .filter((f) => String(f.value).trim() !== "")
    .map((f) => {
      const kind = kindOf(f.key, f.value);
      return { ...f, kind, group: groupOf(f.key, kind) };
    });
  const groups = (["contact", "details", "source"] as Group[]).map((g) => ({ g, rows: rows.filter((r) => r.group === g) })).filter((x) => x.rows.length > 0);
  return (
    <div className={`field-groups ${compact ? "is-compact" : ""}`}>
      {groups.map(({ g, rows }) => (
        <section key={g} className="field-group">
          {groups.length > 1 && <h5>{GROUP_TITLE[g]}</h5>}
          <ul>
            {rows.map((r) => (
              <li key={r.key} className="field-row">
                <span className="field-icon" aria-hidden="true">
                  <Icon name={ICON[r.kind]} size={16} />
                </span>
                <span className="field-text">
                  <span className="field-label">{r.label}</span>
                  <span className="field-value">
                    <Value kind={r.kind} value={r.value} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Unidade curta para ficar ao lado do número: "Proporção (%)" → "%", "Mil Reais" → "mil reais". */
function shortUnit(unit: string | undefined): string {
  if (!unit) return "";
  const inner = /\(([^)]+)\)\s*$/.exec(unit);
  return inner ? inner[1]! : unit.toLowerCase();
}

/** Um indicador: rótulo em cima (inteiro, sem cortar), número grande e a unidade menor ao lado. */
export function Metric({ field, value, label }: { field: DatapackField; value: unknown; label?: string }) {
  const number = formatField({ ...field, unit: undefined }, value);
  const unit = value === undefined || value === null ? "" : shortUnit(field.unit);
  return (
    <div className="metric">
      <span className="metric-label">{label ?? field.label}</span>
      <span className="metric-value">
        <b className="num">{number}</b>
        {unit && <span className="metric-unit">{unit}</span>}
      </span>
    </div>
  );
}
