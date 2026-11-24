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
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    // A successful request can still be followed by a failed commit (e.g. quota).
    // Imported audio is only saved once the transaction completes.
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? req.error); };
  }));
}

export const putBlob = (key: string, blob: Blob) => run('readwrite', s => s.put(blob, key));
export const getBlob = (key: string) => run<Blob | undefined>('readonly', s => s.get(key));
// Plain data that outgrows localStorage (text channel messages)
export const putData = (key: string, value: unknown) => run('readwrite', s => s.put(value, key));
export const getData = <T>(key: string) => run<T | undefined>('readonly', s => s.get(key));
export const dataKeys = () => run<IDBValidKey[]>('readonly', s => s.getAllKeys());
// Keep read/modify/write operations in one transaction so expiry cannot erase a
// concurrently saved message. Returning undefined leaves the existing value alone.
export function updateData<T>(key: string, update: (value: T | undefined) => T | undefined): Promise<void> {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE);
    const request = store.get(key);
    request.onsuccess = () => {
      try {
        const next = update(request.result);
        if (next !== undefined) store.put(next, key);
      } catch { tx.abort(); }
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Could not update stored data')); };
  }));
}
export const deleteBlob =(key: string) => run('readwrite', s => s.delete(key));
