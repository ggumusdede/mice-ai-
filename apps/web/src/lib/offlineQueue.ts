// §18.16 Saha çevrimdışı çalışma: field-panel writes are queued in IndexedDB when offline and
// replayed in order when the connection returns. The queue logic is storage-agnostic (pure) so it
// can be unit-tested with MemoryQueueStore; the browser uses IdbQueueStore.

export interface QueuedRequest {
  id: string;
  method: 'POST' | 'PATCH' | 'PUT';
  path: string; // API path without /api prefix, e.g. /projects/123/field-extras
  body: unknown;
  /** human readable, shown in the queue indicator */
  label: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

export interface QueueStore {
  all(): Promise<QueuedRequest[]>;
  put(item: QueuedRequest): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Result of trying to send a single queued request. */
export type SendOutcome = 'ok' | 'retry' | 'drop';
export type Sender = (req: QueuedRequest) => Promise<{ outcome: SendOutcome; error?: string }>;

export interface FlushResult {
  sent: number;
  dropped: QueuedRequest[];
  remaining: number;
  stoppedOnRetry: boolean;
}

export class MemoryQueueStore implements QueueStore {
  private items = new Map<string, QueuedRequest>();
  async all() {
    return [...this.items.values()].map((i) => ({ ...i }));
  }
  async put(item: QueuedRequest) {
    this.items.set(item.id, { ...item });
  }
  async remove(id: string) {
    this.items.delete(id);
  }
}

export function sortQueue(items: QueuedRequest[]): QueuedRequest[] {
  return [...items].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

let seq = 0;
export function newQueueId(now = Date.now()): string {
  seq = (seq + 1) % 1_000_000;
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${now.toString(36)}-${seq.toString(36)}-${rnd}`;
}

export function makeQueued(input: Pick<QueuedRequest, 'method' | 'path' | 'body' | 'label'>, now = Date.now()): QueuedRequest {
  return { ...input, id: newQueueId(now), createdAt: now, attempts: 0 };
}

/**
 * Replays queued requests oldest-first.
 * - 'ok'    → removed
 * - 'drop'  → removed and reported (permanent failure, e.g. 4xx validation) so the UI can tell the user
 * - 'retry' → attempts++ and flushing STOPS to preserve order (we are probably offline again)
 * Items exceeding maxAttempts are dropped.
 */
export async function flushQueue(store: QueueStore, send: Sender, opts: { maxAttempts?: number } = {}): Promise<FlushResult> {
  const maxAttempts = opts.maxAttempts ?? 20;
  const items = sortQueue(await store.all());
  let sent = 0;
  const dropped: QueuedRequest[] = [];
  let stoppedOnRetry = false;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let res: { outcome: SendOutcome; error?: string };
    try {
      res = await send(item);
    } catch (e) {
      res = { outcome: 'retry', error: e instanceof Error ? e.message : String(e) };
    }
    if (res.outcome === 'ok') {
      await store.remove(item.id);
      sent++;
    } else if (res.outcome === 'drop') {
      await store.remove(item.id);
      dropped.push({ ...item, lastError: res.error });
    } else {
      const updated = { ...item, attempts: item.attempts + 1, lastError: res.error };
      if (updated.attempts >= maxAttempts) {
        await store.remove(item.id);
        dropped.push(updated);
        continue;
      }
      await store.put(updated);
      stoppedOnRetry = true;
      break;
    }
  }
  const remaining = (await store.all()).length;
  return { sent, dropped, remaining, stoppedOnRetry };
}

/** Classify an HTTP status for queue replay. */
export function outcomeForStatus(status: number): SendOutcome {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 408 || status === 429 || status >= 500) return 'retry';
  if (status === 401 || status === 403) return 'retry'; // token expired — user re-logs in, then we retry
  return 'drop';
}

// ---------------- IndexedDB store ----------------
const DB_NAME = 'mice-offline';
const STORE = 'queue';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          resolve(r ? r.result : undefined);
        };
        t.onerror = () => {
          db.close();
          reject(t.error);
        };
      }),
  );
}

export class IdbQueueStore implements QueueStore {
  async all() {
    return ((await tx<QueuedRequest[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedRequest[]>)) ?? []) as QueuedRequest[];
  }
  async put(item: QueuedRequest) {
    await tx('readwrite', (s) => s.put(item));
  }
  async remove(id: string) {
    await tx('readwrite', (s) => s.delete(id));
  }
}

/** IndexedDB if available (it isn't in some private modes); otherwise in-memory. */
export function defaultQueueStore(): QueueStore {
  try {
    if (typeof indexedDB !== 'undefined') return new IdbQueueStore();
  } catch {
    /* fall through */
  }
  return new MemoryQueueStore();
}
