import { AGENTS, AgentFace } from "../components/Agents";
import { Icon } from "../components/Icon";
import { ANNOTATION_COLORS, AREA_SHAPES, LINE_SHAPES, TOOLS, toolGroup, type AnnotationTool } from "./model";

/**
 * Doca de anotações: cada ferramenta é um personagem da turma (Bolha traço, Hexa área, Quadra pinta ruas e prédios,
 * Lume texto, Pino alfinete com foto). O ativo fica feliz e fala a dica num balão. Selecionar e Imagem são
 * utilitários, sem personagem.
 */
export function AnnotationToolbar({
  tool,
  color,
  onTool,
  onImage,
  onColor,
  onUndo,
  onClose,
}: {
  tool: AnnotationTool;
  color: string;
  onTool: (tool: AnnotationTool) => void;
  /** Escolher uma imagem para sobrepor ao mapa. */
  onImage: () => void;
  onColor: (hex: string) => void;
  onUndo: () => void;
  onClose: () => void;
}) {
  const active = toolGroup(tool);
  const shapes = active?.tool === "freehand" ? LINE_SHAPES : active?.tool === "polygon" ? AREA_SHAPES : null;
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
          const on = active?.tool === t.tool;
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
        <button type="button" className="annot-tool annot-select" onClick={onImage} title="Imagem: sobreponha uma planta, croqui ou foto e encaixe pelos cantos">
          <span className="annot-tool-face">
            <Icon name="imagePlus" size={20} />
          </span>
          <span className="annot-tool-label">Imagem</span>
        </button>
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
          {shapes && (
            <span className="segmented segmented-sm" role="radiogroup" aria-label="Formato">
              {shapes.map((s) => (
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
