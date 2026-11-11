import { describe, expect, it } from 'vitest';
import { displayName, visibleAccounts } from './provider-names';

describe('subscription cards', () => {
  it('brand first, Hermes name below only when it differs', () => {
    expect(displayName('openai-codex', 'ChatGPT or Codex Subscription')).toEqual({ name: 'OpenAI — ChatGPT / Codex', hermes: 'ChatGPT or Codex Subscription' });
    expect(displayName('nous', 'Nous Portal')).toEqual({ name: 'Nous Portal', hermes: null });
    expect(displayName('new-one', 'New One')).toEqual({ name: 'New One', hermes: null });
  });

  it('browser logins first, then Anthropic, then terminal ones; claude-code hidden unless connected', () => {
    const c = (id: string, flow: string, connected = false) => ({ id, flow, connected });
    const list = [c('nous', 'device_code'), c('qwen-oauth', 'external'), c('openai-codex', 'device_code'), c('anthropic', 'external'), c('claude-code', 'external')];
    expect(visibleAccounts(list).map((a) => a.id)).toEqual(['nous', 'openai-codex', 'anthropic', 'qwen-oauth']);
    expect(visibleAccounts([...list.slice(0, 4), c('claude-code', 'external', true)]).map((a) => a.id)).toContain('claude-code');
  });
});
