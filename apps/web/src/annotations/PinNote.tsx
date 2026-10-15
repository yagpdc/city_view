import { useEffect, useState } from "react";
import { AgentFace } from "../components/Agents";
import type { AnnotationFeature } from "./model";
import { photoUrl } from "./photos";

/** Nota do alfinete no cartão do mapa (clique fora do modo de desenho): foto, título, nota e "Editar". */
export function PinNote({ feature, onEdit }: { feature: AnnotationFeature; onEdit: () => void }) {
  const { label, note, photo } = feature.properties;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (photo) void photoUrl(photo).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [photo]);
  return (
    <div className={`pin-note ${url ? "has-photo" : ""}`}>
      {url && <img className="pin-note-photo" src={url} alt="" />}
      <header>
        <AgentFace kind="pino" size={30} />
        <b>{label?.trim() || "Alfinete"}</b>
      </header>
      {note?.trim() ? <p>{note}</p> : <p className="muted">Sem nota.</p>}
      <button type="button" className="btn btn-sm" onClick={onEdit}>
        Editar
      </button>
    </div>
  );
}
