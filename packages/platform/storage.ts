import type { Project } from "../project-schema";
const database = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("supp-edit-local", 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore("media");
    request.result.createObjectStore("state");
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
export async function readLocal<T>(
  store: "media" | "state",
  key: string,
): Promise<T | undefined> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}
export async function writeLocal(
  store: "media" | "state",
  key: string,
  value: unknown,
): Promise<void> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function deleteLocal(
  store: "media" | "state",
  key: string,
): Promise<void> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
export interface Recovery {
  project: Project;
  path: string | null;
  missing: string[];
}
