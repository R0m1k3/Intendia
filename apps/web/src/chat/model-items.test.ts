import { describe, expect, it } from 'vitest';
import type { ChatModelList } from '../api';
import { modelItems } from './model-items';

const noop = () => {};
const labels = (l: ChatModelList | undefined, m: string | null = null) => modelItems(l, m, noop).map((i) => i.label);

describe('modelItems', () => {
  it('no list yet: Auto only', () => {
    expect(labels(undefined)).toEqual(['Auto']);
  });
  it('empty managed list: Auto and the manage action', () => {
    expect(labels({ auto: 'anthropic/claude-opus-4.6', models: [], managed: true })).toEqual(['Auto · claude-opus-4.6', 'Gérer les modèles…']);
  });
  it('unavailable models are hidden, order kept', () => {
    const l = { auto: null, models: [{ id: 'b', available: true }, { id: 'x', available: false }, { id: 'a', available: true }], managed: true };
    expect(labels(l)).toEqual(['Auto', 'b', 'a', 'Gérer les modèles…']);
  });
  it('the session model is added once', () => {
    const l = { auto: null, models: [{ id: 'a', available: true }], managed: true };
    expect(labels(l, 'a')).toEqual(['Auto', 'a', 'Gérer les modèles…']);
    expect(labels(l, 'z')).toEqual(['Auto', 'a', 'z', 'Gérer les modèles…']);
    expect(labels({ ...l, models: [{ id: 'z', available: false }] }, 'z')).toEqual(['Auto', 'z', 'Gérer les modèles…']);
  });
  it('the manage action only when the list is managed', () => {
    expect(labels({ auto: null, models: [{ id: 'a', available: true }], managed: false })).toEqual(['Auto', 'a']);
    const action = modelItems({ auto: null, models: [], managed: true }, null, noop).at(-1)!;
    expect('action' in action && action.action).toBe(noop);
  });
});
