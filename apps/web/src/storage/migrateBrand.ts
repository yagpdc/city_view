/**
 * Troca de nome City View → Pinny (2026-10-15): o que o navegador guardava com o nome antigo passa para o novo uma
 * vez, sem perder nada. As chaves e bancos antigos ficam como cópia de segurança (não são apagados).
 *
 * Importado antes de tudo em `main.tsx`: o App lê o localStorage já ao carregar o módulo.
 */

const OLD_PREFIX = "cityview.";
const NEW_PREFIX = "pinny.";

/** localStorage: `cityview.x` → `pinny.x` (só quando o novo ainda não existe). */
function migrateLocalStorage(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(OLD_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      const next = NEW_PREFIX + key.slice(OLD_PREFIX.length);
      const value = localStorage.getItem(key);
      if (value !== null && localStorage.getItem(next) === null) localStorage.setItem(next, value);
    }
  } catch {
    // Modo privado ou armazenamento bloqueado: nada a migrar.
  }
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * IndexedDB: copia um banco inteiro (todos os stores, mesma versão e mesmas chaves) para o nome novo, se o antigo
 * existe e o novo ainda não. Sem `indexedDB.databases()` (navegador antigo), não migra.
 */
async function migrateDatabase(oldName: string, newName: string): Promise<void> {
  if (!indexedDB.databases) return;
  const names = new Set((await indexedDB.databases()).map((d) => d.name));
  if (!names.has(oldName) || names.has(newName)) return;

  const old = await request(indexedDB.open(oldName));
  try {
    const stores = [...old.objectStoreNames].map((name) => {
      const store = old.transaction(name, "readonly").objectStore(name);
      return { name, keyPath: store.keyPath, autoIncrement: store.autoIncrement };
    });
    const data = await Promise.all(
      stores.map(async (s) => {
        const store = old.transaction(s.name, "readonly").objectStore(s.name);
        const [values, keys] = await Promise.all([request(store.getAll()), request(store.getAllKeys())]);
        return { ...s, values, keys };
      }),
    );
    const openNew = indexedDB.open(newName, old.version);
    openNew.onupgradeneeded = () => {
      for (const s of stores) openNew.result.createObjectStore(s.name, { keyPath: s.keyPath ?? undefined, autoIncrement: s.autoIncrement });
    };
    const db = await request(openNew);
    try {
      for (const s of data) {
        if (s.values.length === 0) continue;
        const tx = db.transaction(s.name, "readwrite");
        const store = tx.objectStore(s.name);
        s.values.forEach((value, i) => (s.keyPath ? store.put(value) : store.put(value, s.keys[i])));
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      }
    } finally {
      db.close();
    }
  } finally {
    old.close();
  }
}

migrateLocalStorage();

/** Os bancos (planilhas importadas, fotos das anotações) já com o nome novo; quem abre um banco espera por isto. */
export const storageMigrated: Promise<void> = Promise.all([
  migrateDatabase("cityview", "pinny"),
  migrateDatabase("cityview-annotation-photos", "pinny-annotation-photos"),
])
  .then(() => undefined)
  .catch((e: unknown) => console.warn("[pinny] não deu para migrar os dados salvos do City View:", e));
