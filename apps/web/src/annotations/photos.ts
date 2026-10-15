/**
 * Fotos das anotações (alfinete com foto, imagem sobreposta) guardadas só neste navegador (IndexedDB), como os
 * arquivos importados (ADR 0002). Reduzidas antes de guardar para não pesar; não vão no link compartilhado.
 */

const DB_NAME = "cityview-annotation-photos";
const STORE = "photos";
/** Lado maior da foto guardada (px): nítida no cartão e sobre o mapa, sem pesar. */
const MAX_SIDE = 1600;

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = run(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export interface StoredPhoto {
  id: string;
  width: number;
  height: number;
}

/** Reduz (JPEG) e guarda a imagem; devolve o id e o tamanho final. */
export async function putPhoto(file: Blob): Promise<StoredPhoto> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  // PNG com transparência (plantas, croquis) continua PNG; foto vira JPEG.
  const png = file.type === "image/png";
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("não deu para preparar a imagem"))), png ? "image/png" : "image/jpeg", 0.86),
  );
  const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await tx("readwrite", (s) => s.put(blob, id));
  return { id, width, height };
}

const urls = new Map<string, Promise<string | null>>();

/** Endereço da foto para <img> e para o mapa (null se ela não está neste navegador, ex.: link de outra pessoa). */
export function photoUrl(id: string): Promise<string | null> {
  let pending = urls.get(id);
  if (!pending) {
    pending = tx<Blob | undefined>("readonly", (s) => s.get(id) as IDBRequest<Blob | undefined>)
      .then((blob) => (blob ? URL.createObjectURL(blob) : null))
      .catch(() => null);
    urls.set(id, pending);
  }
  return pending;
}

export async function deletePhoto(id: string): Promise<void> {
  const url = await urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
  await tx("readwrite", (s) => s.delete(id)).catch(() => undefined);
}

/** Miniatura redonda com borda branca e sombra, para o alfinete com foto no mapa. */
export async function photoMarker(id: string, size = 48): Promise<ImageData | null> {
  const url = await photoUrl(id);
  if (!url) return null;
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => undefined);
  if (!img.naturalWidth) return null;
  const ratio = 2;
  const s = size * ratio;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d")!;
  const r = s / 2 - 6 * ratio;
  ctx.shadowColor = "rgba(29,30,36,0.28)";
  ctx.shadowBlur = 6 * ratio;
  ctx.shadowOffsetY = 2 * ratio;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, r + 3 * ratio, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.save();
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, r, 0, Math.PI * 2);
  ctx.clip();
  // Recorta o centro da foto num quadrado.
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, s / 2 - r, s / 2 - r, r * 2, r * 2);
  ctx.restore();
  return ctx.getImageData(0, 0, s, s);
}
