// Small IndexedDB store for user files (custom sounds): localStorage is too small for audio.
const DB = 'mumh5';
const STORE = 'files';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(db => new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

export const putBlob = (key: string, blob: Blob) => run('readwrite', s => s.put(blob, key));
export const getBlob = (key: string) => run<Blob | undefined>('readonly', s => s.get(key));
export const deleteBlob = (key: string) => run('readwrite', s => s.delete(key));
