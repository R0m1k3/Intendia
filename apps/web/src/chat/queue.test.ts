import { describe, expect, it } from 'vitest';
import {
  clearPendingKey, dropItem, EMPTY_QUEUE, enqueue, firstTime, loadPendingKey, loadQueue, pauseQueue, pushHead, resumeQueue, saveQueue,
  savePendingKey, takeHead, moveItem, editItem,
} from './queue';

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
    expect(loadQueue('a', 's3', store)).toEqual({ items: [{ id: 'y', text: 'ok', key: expect.any(String) }], paused: null });
  });

  it('keeps the skills asked with a message (/use), drops unreadable ones', () => {
    const store = memory();
    const q = enqueue(EMPTY_QUEUE, 'avec skill', ['codex']);
    expect(q.items[0]).toMatchObject({ text: 'avec skill', skills: ['codex'] });
    expect(enqueue(EMPTY_QUEUE, 'sans', []).items[0]!.skills).toBeUndefined();
    expect(pushHead(q, 'devant', ['a']).items[0]!.skills).toEqual(['a']);
    saveQueue('a', 's', q, store);
    expect(loadQueue('a', 's', store).items[0]!.skills).toEqual(['codex']);
    store.setItem('intendia-queue:a:t', JSON.stringify({ items: [{ id: 'x', text: 'ok', skills: [1] }] }));
    expect(loadQueue('a', 't', store).items[0]).toEqual({ id: 'x', text: 'ok', key: expect.any(String) });
  });

  it('gives each message a key, kept when put back in front and when stored', () => {
    const store = memory();
    const q = enqueue(enqueue(EMPTY_QUEUE, 'un'), 'deux', ['codex']);
    const keys = q.items.map((i) => i.key);
    expect(keys.every((k) => /^[A-Za-z0-9-]{8,64}$/.test(k))).toBe(true);
    expect(new Set(keys).size).toBe(2);
    expect(pushHead(EMPTY_QUEUE, 'encore', undefined, 'cle-gardee-1').items[0]!.key).toBe('cle-gardee-1');
    expect(pushHead(EMPTY_QUEUE, 'encore').items[0]!.key).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    saveQueue('a', 's', q, store);
    expect(loadQueue('a', 's', store).items.map((i) => i.key)).toEqual(keys);
    // a queue saved without keys gets one per item
    store.setItem('intendia-queue:a:old', JSON.stringify({ items: [{ id: 'x', text: 'ok' }, { id: 'y', text: 'ok', skills: ['s'] }] }));
    const old = loadQueue('a', 'old', store).items;
    expect(old.every((i) => typeof i.key === 'string' && i.key.length >= 8)).toBe(true);
    expect(old[1]!.skills).toEqual(['s']);
  });

  it('keeps the key of the message being sent per session', () => {
    const store = memory();
    savePendingKey('a', 's1', { text: 'Bonjour', key: 'cle-envoi-1' }, store);
    expect(loadPendingKey('a', 's1', store)).toEqual({ text: 'Bonjour', key: 'cle-envoi-1' });
    expect(loadPendingKey('a', 's2', store)).toBeNull();
    clearPendingKey('a', 's1', store);
    expect(loadPendingKey('a', 's1', store)).toBeNull();
    store.setItem('intendia-pending-key:a:s3', '{x');
    expect(loadPendingKey('a', 's3', store)).toBeNull();
  });
});

describe('reorder and edit', () => {
  const q3 = () => ['a', 'b', 'c'].reduce((q, t) => enqueue(q, t), EMPTY_QUEUE);
  it('moves a message up or down, bounded', () => {
    const q = q3();
    expect(moveItem(q, q.items[2]!.id, -1).items.map((i) => i.text)).toEqual(['a', 'c', 'b']);
    expect(moveItem(q, q.items[1]!.id, -5).items.map((i) => i.text)).toEqual(['b', 'a', 'c']);
    expect(moveItem(q, q.items[2]!.id, 1)).toBe(q);
  });
  it('edits with a new key, removes when emptied', () => {
    const q = q3();
    const e = editItem(q, q.items[0]!.id, 'z');
    expect(e.items[0]!.text).toBe('z');
    expect(e.items[0]!.key).not.toBe(q.items[0]!.key);
    expect(editItem(q, q.items[0]!.id, '  ').items).toHaveLength(2);
  });
});
