import { describe, expect, it } from 'vitest';
import { dropItem, EMPTY_QUEUE, enqueue, firstTime, loadQueue, pauseQueue, pushHead, resumeQueue, saveQueue, takeHead } from './queue';

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k),
  };
}

describe('queue', () => {
  it('keeps the order, takes the head, puts a text back in front', () => {
    let q = enqueue(enqueue(EMPTY_QUEUE, 'un'), 'deux');
    const [head, rest] = takeHead(q);
    expect(head?.text).toBe('un');
    q = pushHead(rest, 'zéro');
    expect(q.items.map((i) => i.text)).toEqual(['zéro', 'deux']);
    expect(new Set(q.items.map((i) => i.id)).size).toBe(2);
    expect(takeHead(EMPTY_QUEUE)).toEqual([null, EMPTY_QUEUE]);
  });

  it('pauses only a queue with messages, and an emptied queue is no longer paused', () => {
    expect(pauseQueue(EMPTY_QUEUE, 'Le run précédent n’a pas abouti').paused).toBeNull();
    let q = pauseQueue(enqueue(EMPTY_QUEUE, 'un'), 'Réorientation non livrée');
    expect(q.paused).toBe('Réorientation non livrée');
    expect(resumeQueue(q).paused).toBeNull();
    q = dropItem(q, q.items[0]!.id);
    expect(q).toEqual(EMPTY_QUEUE);
    expect(takeHead(pauseQueue(enqueue(EMPTY_QUEUE, 'seul'), 'x'))[1].paused).toBeNull();
  });

  it('puts a reorientation back once per run', () => {
    const store = memory();
    expect(firstTime('a', 'run_1', store)).toBe(true);
    expect(firstTime('a', 'run_1', store)).toBe(false);
    expect(firstTime('a', 'run_2', store)).toBe(true);
  });

  it('is stored per instance and session; an empty queue removes the key; bad data reads as empty', () => {
    const store = memory();
    const q = pauseQueue(enqueue(EMPTY_QUEUE, 'un'), 'pause');
    saveQueue('a', 's1', q, store);
    expect(loadQueue('a', 's1', store)).toEqual(q);
    expect(loadQueue('b', 's1', store)).toEqual(EMPTY_QUEUE);
    saveQueue('a', 's1', EMPTY_QUEUE, store);
    expect(store.length).toBe(0);
    store.setItem('intendia-queue:a:s2', '{pas du json');
    expect(loadQueue('a', 's2', store)).toEqual(EMPTY_QUEUE);
    store.setItem('intendia-queue:a:s3', JSON.stringify({ items: [{ id: 'x', text: ' ' }, { id: 1 }, { id: 'y', text: 'ok' }], paused: 3 }));
    expect(loadQueue('a', 's3', store)).toEqual({ items: [{ id: 'y', text: 'ok' }], paused: null });
  });
});
