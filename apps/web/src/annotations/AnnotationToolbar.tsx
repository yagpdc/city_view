import { AGENTS, AgentFace } from "../components/Agents";
import { Icon } from "../components/Icon";
import { ANNOTATION_COLORS, AREA_SHAPES, TOOLS, type AnnotationTool } from "./model";

/**
 * Barra de anotações: cada ferramenta é um personagem da turma (Bolha traço livre, Hexa linha, Quadra área,
 * Lume texto, Pino alfinete). O ativo fica feliz e fala a dica num balão embaixo.
 */
export function AnnotationToolbar({
  tool,
  color,
  onTool,
  onColor,
  onUndo,
  onClose,
}: {
  tool: AnnotationTool;
  color: string;
  onTool: (tool: AnnotationTool) => void;
  onColor: (hex: string) => void;
  onUndo: () => void;
  onClose: () => void;
}) {
  const areaTool = tool === "polygon" || tool === "rectangle" || tool === "circle";
  const active = TOOLS.find((t) => t.tool === tool || (t.tool === "polygon" && areaTool));
  return (
    <div className="annot-dock-wrap">
      <div className="annot-dock" role="toolbar" aria-label="Ferramentas de anotação">
        <button
          type="button"
          className={`annot-tool annot-select ${tool === "select" ? "is-on" : ""}`}
          onClick={() => onTool("select")}
          aria-pressed={tool === "select"}
          title="Selecionar e editar"
        >
          <span className="annot-tool-face">
            <Icon name="cursor" size={20} />
          </span>
          <span className="annot-tool-label">Selecionar</span>
        </button>
        <span className="annot-sep" aria-hidden="true" />
        {TOOLS.map((t) => {
          const on = t.tool === tool || (t.tool === "polygon" && areaTool);
          return (
            <button
              key={t.tool}
              type="button"
              className={`annot-tool ${on ? "is-on" : ""}`}
              onClick={() => onTool(t.tool)}
              aria-pressed={on}
              title={`${t.label}: ${AGENTS[t.agent].name} ${t.hint}`}
            >
              <span className="annot-tool-face">
                <AgentFace kind={t.agent} mood={on ? "happy" : "neutral"} size={34} />
              </span>
              <span className="annot-tool-label">{t.label}</span>
            </button>
          );
        })}
        <span className="annot-sep" aria-hidden="true" />
        <span className="annot-colors" role="radiogroup" aria-label="Cor">
          {ANNOTATION_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={color === c.hex}
              aria-label={c.label}
              title={c.label}
              className={`annot-color ${color === c.hex ? "is-on" : ""}`}
              style={{ background: c.hex }}
              onClick={() => onColor(c.hex)}
            />
          ))}
        </span>
        <span className="annot-sep" aria-hidden="true" />
        <button type="button" className="icon-button sm" onClick={onUndo} aria-label="Desfazer" title="Desfazer">
          <Icon name="undo" size={18} />
        </button>
        <button type="button" className="btn btn-primary btn-sm annot-done" onClick={onClose}>
          Concluir
        </button>
      </div>
      {active && (
        <div className="annot-bubble" role="status">
          <b>{AGENTS[active.agent].name}</b>
          <span>{active.hint}</span>
          {areaTool && (
            <span className="segmented segmented-sm" role="radiogroup" aria-label="Formato da área">
              {AREA_SHAPES.map((s) => (
                <button key={s.tool} type="button" role="radio" aria-checked={tool === s.tool} className={tool === s.tool ? "is-active" : ""} onClick={() => onTool(s.tool)}>
                  {s.label}
                </button>
              ))}
            </span>
          )}
        </div>
      )}
      {tool === "select" && (
        <div className="annot-bubble" role="status">
          <span>Escolha alguém da turma para desenhar, ou clique numa anotação para editar, arrastar os pontos ou apagar.</span>
        </div>
      )}
    </div>
  );
}
