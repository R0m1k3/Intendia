/**
 * Messages written while a run goes, sent one per run once the run before ends well. Kept in the tab
 * (`sessionStorage`, per instance and session): a reload keeps them, closing the tab loses them (the page warns).
 * `paused`: why the queue waits for « Reprendre » (a run that failed, a reorientation not delivered…), null = flows.
 */
/**
 * `skills`: asked by `/use` with the message, sent with it. `key`: drawn once per message (the `clientKey` of the send,
 * Idempotency-Key at Hermes): a resend of the same item never starts a second run.
 */
export interface QueueItem { id: string; text: string; skills?: string[]; key: string }
export interface Queue { items: QueueItem[]; paused: string | null }

export const EMPTY_QUEUE: Queue = { items: [], paused: null };
const keyOf = (inst: string, sessionId: string) => `intendia-queue:${inst}:${sessionId}`;
let counter = 0;
const newId = () => `q${Date.now().toString(36)}${(counter++).toString(36)}`;
/** A send key (`CLIENT_KEY_RE` of the server: 8-64 letters, digits, dashes). */
export const newSendKey = (): string => crypto.randomUUID();

export function loadQueue(inst: string, sessionId: string, store: Storage = sessionStorage): Queue {
  try {
    const raw = JSON.parse(store.getItem(keyOf(inst, sessionId)) ?? 'null') as Partial<Queue> | null;
    const items = Array.isArray(raw?.items)
      ? raw.items.filter((i): i is QueueItem => typeof i?.id === 'string' && typeof i?.text === 'string' && i.text.trim() !== '')
        .map((i): QueueItem => {
          // a queue saved before the keys existed gets one per item
          const key = typeof i.key === 'string' && i.key ? i.key : newSendKey();
          return Array.isArray(i.skills) && i.skills.every((x) => typeof x === 'string')
            ? { id: i.id, text: i.text, skills: i.skills, key } : { id: i.id, text: i.text, key };
        })
      : [];
    return { items, paused: items.length && typeof raw?.paused === 'string' ? raw.paused : null };
  } catch {
    return EMPTY_QUEUE;
  }
}

export function saveQueue(inst: string, sessionId: string, q: Queue, store: Storage = sessionStorage) {
  try {
    if (q.items.length === 0) store.removeItem(keyOf(inst, sessionId));
    else store.setItem(keyOf(inst, sessionId), JSON.stringify(q));
  } catch {
    // storage full or refused: the queue lives in the page only
  }
}

const item = (text: string, skills?: string[], key?: string): QueueItem => ({ id: newId(), text, ...(skills?.length ? { skills } : {}), key: key ?? newSendKey() });
export const enqueue = (q: Queue, text: string, skills?: string[]): Queue => ({ ...q, items: [...q.items, item(text, skills)] });
/** Back at the head (a send that failed): with its key, so the resend is the same intent. */
export const pushHead = (q: Queue, text: string, skills?: string[], key?: string): Queue => ({ ...q, items: [item(text, skills, key), ...q.items] });
export const dropItem = (q: Queue, id: string): Queue => {
  const items = q.items.filter((i) => i.id !== id);
  return { items, paused: items.length ? q.paused : null };
};
/** Moves a message `delta` places (−1: up), within the queue. */
export function moveItem(q: Queue, id: string, delta: number): Queue {
  const from = q.items.findIndex((i) => i.id === id);
  if (from < 0) return q;
  const to = Math.max(0, Math.min(q.items.length - 1, from + delta));
  if (to === from) return q;
  const items = [...q.items];
  const [it] = items.splice(from, 1);
  items.splice(to, 0, it!);
  return { ...q, items };
}
/** New text for a waiting message: a new intent, so a new send key; an empty text removes it. */
export function editItem(q: Queue, id: string, text: string): Queue {
  if (!text.trim()) return dropItem(q, id);
  return { ...q, items: q.items.map((i) => (i.id === id ? { ...i, text, key: newSendKey() } : i)) };
}
/** The first message and the queue without it (an empty queue is never paused). */
export function takeHead(q: Queue): [QueueItem | null, Queue] {
  const [head, ...items] = q.items;
  return [head ?? null, { items, paused: items.length ? q.paused : null }];
}
/**
 * True the first time for this run, then false: a reorientation Hermes did not deliver is put back in the queue once,
 * whether the page saw the run end or read its status later.
 */
export function firstTime(inst: string, runId: string, store: Storage = sessionStorage): boolean {
  const key = `intendia-steer-back:${inst}:${runId}`;
  try {
    if (store.getItem(key)) return false;
    store.setItem(key, '1');
  } catch {
    // storage refused: may come back twice, never lost
  }
  return true;
}

export const pauseQueue = (q: Queue, reason: string): Queue => (q.items.length ? { ...q, paused: reason } : q);
export const resumeQueue = (q: Queue): Queue => ({ ...q, paused: null });

/**
 * The key of the message being sent, kept in the tab (`sessionStorage`) until the send succeeded: a send cut by a
 * 502 or a reload, sent again with the same text, reuses it (one run at Hermes).
 */
export interface PendingKey { text: string; key: string }
const pendingKeyOf = (inst: string, sessionId: string) => `intendia-pending-key:${inst}:${sessionId}`;

export function loadPendingKey(inst: string, sessionId: string, store: Storage = sessionStorage): PendingKey | null {
  try {
    const raw = JSON.parse(store.getItem(pendingKeyOf(inst, sessionId)) ?? 'null') as Partial<PendingKey> | null;
    return typeof raw?.text === 'string' && typeof raw.key === 'string' ? { text: raw.text, key: raw.key } : null;
  } catch {
    return null;
  }
}

export function savePendingKey(inst: string, sessionId: string, p: PendingKey, store: Storage = sessionStorage) {
  try {
    store.setItem(pendingKeyOf(inst, sessionId), JSON.stringify(p));
  } catch {
    // storage refused: the key lives for this send only
  }
}

export function clearPendingKey(inst: string, sessionId: string, store: Storage = sessionStorage) {
  try {
    store.removeItem(pendingKeyOf(inst, sessionId));
  } catch {
    // nothing kept
  }
}
