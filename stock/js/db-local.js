const DB_NAME = 'agrosalado_stock';
const DB_VERSION = 1;
const STORE_OUTBOX = 'outbox';
const STORE_STOCK_CACHE = 'stock_cache';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_STOCK_CACHE)) {
        db.createObjectStore(STORE_STOCK_CACHE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDB();
  const tx = db.transaction(storeName, mode);
  const store = tx.objectStore(storeName);
  const result = await fn(store);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return result;
}

// ─── outbox ───────────────────────────────────────────────────────────

export async function outboxAdd(row) {
  return withStore(STORE_OUTBOX, 'readwrite', (store) => wrap(store.put(row)));
}

export async function outboxGetAll() {
  return withStore(STORE_OUTBOX, 'readonly', (store) => wrap(store.getAll()));
}

export async function outboxUpdate(id, cambios) {
  return withStore(STORE_OUTBOX, 'readwrite', async (store) => {
    const actual = await wrap(store.get(id));
    if (!actual) return null;
    const actualizado = { ...actual, ...cambios };
    await wrap(store.put(actualizado));
    return actualizado;
  });
}

export async function outboxDelete(id) {
  return withStore(STORE_OUTBOX, 'readwrite', (store) => wrap(store.delete(id)));
}

export async function outboxCount() {
  const todos = await outboxGetAll();
  return todos.length;
}

// ─── stock_cache ──────────────────────────────────────────────────────

export async function stockCacheSet(rows) {
  return withStore(STORE_STOCK_CACHE, 'readwrite', (store) =>
    wrap(store.put({ key: 'stock_actual', rows, fetched_at: new Date().toISOString() }))
  );
}

export async function stockCacheGet() {
  return withStore(STORE_STOCK_CACHE, 'readonly', (store) => wrap(store.get('stock_actual')));
}
