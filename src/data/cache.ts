/**
 * A tiny time-to-live cache backed by IndexedDB, with a localStorage fallback
 * for small values and an in-memory fallback for private browsing.
 *
 * The reason this exists at all is the Sleeper player file: it is roughly
 * fifteen megabytes and Sleeper asks that it be fetched no more than once per
 * day. It is never fetched on page load, and never twice in a day.
 */

const DB_NAME = 'dynasty-ff';
const STORE = 'cache';
const memory = new Map<string, { expires: number; value: unknown }>();

interface Entry<T> {
  expires: number;
  value: T;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch {
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function idbGet<T>(key: string): Promise<Entry<T> | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => resolve((request.result as Entry<T>) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbSet<T>(key: string, entry: Entry<T>): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const now = Date.now();

  const local = memory.get(key);
  if (local && local.expires > now) return local.value as T;

  const stored = await idbGet<T>(key);
  if (stored && stored.expires > now) {
    memory.set(key, stored);
    return stored.value;
  }

  try {
    const raw = localStorage.getItem(`cache:${key}`);
    if (raw) {
      const parsed = JSON.parse(raw) as Entry<T>;
      if (parsed.expires > now) return parsed.value;
    }
  } catch {
    /* storage unavailable or the value is not ours */
  }
  return null;
}

export async function cacheSet<T>(key: string, value: T, ttlMs: number): Promise<void> {
  const entry: Entry<T> = { expires: Date.now() + ttlMs, value };
  memory.set(key, entry);
  await idbSet(key, entry);
  // Only mirror small values into localStorage; the player file would blow the quota.
  try {
    const serialised = JSON.stringify(entry);
    if (serialised.length < 200_000) localStorage.setItem(`cache:${key}`, serialised);
  } catch {
    /* quota or private mode */
  }
}

/** When the cached value was written, regardless of whether it is still fresh. */
export async function cacheAge(key: string, ttlMs: number): Promise<Date | null> {
  const stored = (await idbGet<unknown>(key)) ?? memory.get(key) ?? null;
  if (!stored) return null;
  return new Date(stored.expires - ttlMs);
}

export async function cacheClear(key: string): Promise<void> {
  memory.delete(key);
  try {
    localStorage.removeItem(`cache:${key}`);
  } catch {
    /* ignore */
  }
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
  } catch {
    /* ignore */
  }
}
