import { Injectable } from "@angular/core";

export interface IndexedDbConfig {
  dbName: string;
  version: number;
}

type Upgrade = (db: IDBDatabase) => void;

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(
        req.error instanceof Error ? req.error : new Error("IDB request error"),
      );
  });
}

function openDb(
  config: IndexedDbConfig,
  onUpgrade: Upgrade,
): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(config.dbName, config.version);
    req.onupgradeneeded = () => onUpgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(
        req.error instanceof Error ? req.error : new Error("IDB open error"),
      );
  });
}

@Injectable({ providedIn: "root" })
export class IndexedDbService {
  async get<T>(
    config: IndexedDbConfig,
    storeName: string,
    key: IDBValidKey,
    ensureSchema: Upgrade,
  ): Promise<T | null> {
    const db = await openDb(config, ensureSchema);
    try {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const value = await requestToPromise<unknown>(store.get(key));
      return value == null ? null : (value as T);
    } finally {
      db.close();
    }
  }

  async put<T>(
    config: IndexedDbConfig,
    storeName: string,
    key: IDBValidKey,
    value: T,
    ensureSchema: Upgrade,
  ): Promise<void> {
    const db = await openDb(config, ensureSchema);
    try {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      await requestToPromise(store.put(value as unknown as object, key));
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () =>
          reject(
            tx.error instanceof Error
              ? tx.error
              : new Error("IDB transaction error"),
          );
        tx.onabort = () =>
          reject(
            tx.error instanceof Error
              ? tx.error
              : new Error("IDB transaction aborted"),
          );
      });
    } finally {
      db.close();
    }
  }

  async delete(
    config: IndexedDbConfig,
    storeName: string,
    key: IDBValidKey,
    ensureSchema: Upgrade,
  ): Promise<void> {
    const db = await openDb(config, ensureSchema);
    try {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      await requestToPromise(store.delete(key));
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () =>
          reject(
            tx.error instanceof Error
              ? tx.error
              : new Error("IDB transaction error"),
          );
        tx.onabort = () =>
          reject(
            tx.error instanceof Error
              ? tx.error
              : new Error("IDB transaction aborted"),
          );
      });
    } finally {
      db.close();
    }
  }
}
