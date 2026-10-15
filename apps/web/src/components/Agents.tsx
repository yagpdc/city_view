/**
 * A turma: os personagens-agente da marca (docs/DESIGN.md · Personagens). Formas que lembram o mapa (alfinete,
 * hexágono, bolha, quadra, sol), em pastel, com olhinhos. Rosto só em agentes, vazios, carregamentos e na marca;
 * dado, número e mapa nunca ganham carinha.
 */

export type AgentKind = "pino" | "hexa" | "bolha" | "quadra" | "lume";
export type AgentMood = "neutral" | "thinking" | "happy" | "alert";

export const AGENTS: Record<AgentKind, { name: string; role: string; fill: string }> = {
  pino: { name: "Pino", role: "Explorador: acha lugares e registros", fill: "var(--cv-lilac-fill)" },
  hexa: { name: "Hexa", role: "Analista: conta, compara e ranqueia", fill: "var(--cv-mint-fill)" },
  bolha: { name: "Bolha", role: "Arrumadeira: limpa e junta planilhas", fill: "var(--cv-peach-fill)" },
  quadra: { name: "Quadra", role: "Cartógrafa: monta o mapa e o estilo", fill: "var(--cv-sky-fill)" },
  lume: { name: "Lume", role: "Vigia: avisa quando algo muda", fill: "var(--cv-lemon-fill)" },
};

const INK = "#1d1e24";

/** Olhos conforme o humor; `dx`/`dy` deslocam o par (cada corpo tem o rosto num lugar). */
function Eyes({ mood, cx = 48, cy = 44 }: { mood: AgentMood; cx?: number; cy?: number }) {
  const l = cx - 10;
  const r = cx + 10;
  if (mood === "happy")
    return (
      <>
        <path d={`M${l - 6} ${cy + 2}Q${l} ${cy - 8} ${l + 6} ${cy + 2}`} fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
        <path d={`M${r - 6} ${cy + 2}Q${r} ${cy - 8} ${r + 6} ${cy + 2}`} fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
      </>
    );
  if (mood === "alert")
    return (
      <>
        <circle cx={l} cy={cy} r="7" fill={INK} />
        <circle cx={r} cy={cy} r="7" fill={INK} />
        <circle cx={l + 2} cy={cy - 2} r="2" fill="#fff" />
        <circle cx={r + 2} cy={cy - 2} r="2" fill="#fff" />
      </>
    );
  // Pensando: olhar para cima e para o lado.
  const o = mood === "thinking" ? { x: 6, y: -6 } : { x: 0, y: 0 };
  return (
    <>
      <ellipse cx={l + o.x} cy={cy + o.y} rx="4.5" ry="7.5" fill={INK} />
      <ellipse cx={r + o.x} cy={cy + o.y} rx="4.5" ry="7.5" fill={INK} />
    </>
  );
}

/** Um agente desenhado (SVG). Decorativo por padrão; com `label`, vira imagem com nome. */
export function AgentFace({ kind, mood = "neutral", size = 48, label }: { kind: AgentKind; mood?: AgentMood; size?: number; label?: string }) {
  const fill = AGENTS[kind].fill;
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" className={`agent-face agent-${kind}`} {...a11y}>
      {kind === "pino" && (
        <>
          <path d="M48 8C70 8 84 24 84 44C84 66 60 84 48 92C36 84 12 66 12 44C12 24 26 8 48 8Z" fill={fill} />
          <circle cx="30" cy="26" r="5" fill="#fff" opacity="0.5" />
          <Eyes mood={mood} cy={42} />
        </>
      )}
      {kind === "hexa" && (
        <>
          <polygon points="48,14 80,32 80,66 48,84 16,66 16,32" fill={fill} stroke={fill} strokeWidth="12" strokeLinejoin="round" />
          <Eyes mood={mood} cy={48} />
        </>
      )}
      {kind === "bolha" && (
        <>
          <path d="M50 12C70 12 86 26 84 48C82 70 66 86 46 84C26 82 10 68 12 46C14 26 30 12 50 12Z" fill={fill} />
          <ellipse cx="30" cy="58" rx="6" ry="3.5" fill="#ff9aa8" opacity="0.7" />
          <ellipse cx="68" cy="58" rx="6" ry="3.5" fill="#ff9aa8" opacity="0.7" />
          <Eyes mood={mood} cx={49} cy={44} />
        </>
      )}
      {kind === "quadra" && (
        <>
          <line x1="64" y1="24" x2="64" y2="6" stroke="var(--cv-sky-ink)" strokeWidth="3" strokeLinecap="round" />
          <path d="M64 6L78 11L64 16Z" fill="var(--cv-pink-fill)" stroke="var(--cv-pink-fill)" strokeWidth="3" strokeLinejoin="round" />
          <rect x="14" y="22" width="68" height="64" rx="22" fill={fill} />
          <Eyes mood={mood} cy={52} />
        </>
      )}
      {kind === "lume" && (
        <>
          <g stroke={fill} strokeWidth="7" strokeLinecap="round">
            <line x1="48" y1="6" x2="48" y2="14" />
            <line x1="48" y1="82" x2="48" y2="90" />
            <line x1="6" y1="48" x2="14" y2="48" />
            <line x1="82" y1="48" x2="90" y2="48" />
            <line x1="18" y1="18" x2="24" y2="24" />
            <line x1="72" y1="72" x2="78" y2="78" />
            <line x1="78" y1="18" x2="72" y2="24" />
            <line x1="24" y1="72" x2="18" y2="78" />
          </g>
          <circle cx="48" cy="48" r="28" fill={fill} />
          <Eyes mood={mood} cy={47} />
        </>
      )}
    </svg>
  );
}
