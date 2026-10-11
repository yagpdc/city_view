import { useEffect, useRef, useState } from "react";

const ACCEPTED = /\.(csv|tsv|txt)$/i;

/** Arrastar um arquivo em qualquer lugar da janela mostra a área de soltar sobre o mapa. */
export function DropZone({ onFile }: { onFile: (file: File) => void }) {
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const depth = useRef(0);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      if (!ACCEPTED.test(file.name)) {
        setRejected(file.name);
        window.setTimeout(() => setRejected(null), 4000);
        return;
      }
      onFile(file);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [onFile]);

  return (
    <>
      {dragging && (
        <div className="dropzone" aria-hidden="true">
          <div className="dropzone-card">
            <strong>Solte para importar</strong>
            <span>CSV ou TSV com latitude e longitude</span>
          </div>
        </div>
      )}
      {rejected && (
        <div className="toast" role="status">
          “{rejected}” ainda não é suportado. Por enquanto aceitamos CSV/TSV.
        </div>
      )}
    </>
  );
}
