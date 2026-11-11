/**
 * Messages written while a run goes, sent one per run once the run before ends well. Kept in the tab
 * (`sessionStorage`, per instance and session): a reload keeps them, closing the tab loses them (the page warns).
 * `paused`: why the queue waits for « Reprendre » (a run that failed, a reorientation not delivered…), null = flows.
 */
export interface QueueItem { id: string; text: string }
export interface Queue { items: QueueItem[]; paused: string | null }

export const EMPTY_QUEUE: Queue = { items: [], paused: null };
const keyOf = (inst: string, sessionId: string) => `intendia-queue:${inst}:${sessionId}`;
let counter = 0;
const newId = () => `q${Date.now().toString(36)}${(counter++).toString(36)}`;

export function loadQueue(inst: string, sessionId: string, store: Storage = sessionStorage): Queue {
  try {
    const raw = JSON.parse(store.getItem(keyOf(inst, sessionId)) ?? 'null') as Partial<Queue> | null;
    const items = Array.isArray(raw?.items)
      ? raw.items.filter((i): i is QueueItem => typeof i?.id === 'string' && typeof i?.text === 'string' && i.text.trim() !== '')
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

export const enqueue = (q: Queue, text: string): Queue => ({ ...q, items: [...q.items, { id: newId(), text }] });
export const pushHead = (q: Queue, text: string): Queue => ({ ...q, items: [{ id: newId(), text }, ...q.items] });
export const dropItem = (q: Queue, id: string): Queue => {
  const items = q.items.filter((i) => i.id !== id);
  return { items, paused: items.length ? q.paused : null };
};
/** The first message and the queue without it (an empty queue is never paused). */
export function takeHead(q: Queue): [QueueItem | null, Queue] {
  const [head, ...items] = q.items;
  return [head ?? null, { items, paused: items.length ? q.paused : null }];
}
export const pauseQueue = (q: Queue, reason: string): Queue => (q.items.length ? { ...q, paused: reason } : q);
export const resumeQueue = (q: Queue): Queue => ({ ...q, paused: null });
