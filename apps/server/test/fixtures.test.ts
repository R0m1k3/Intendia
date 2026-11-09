import { describe, expect, it } from 'vitest';
import { redact } from '../src/cli/fixtures.js';

describe('probe redaction', () => {
  it('redacts credential-looking keys and known secrets anywhere', () => {
    const out = redact({
      api_key: 'sk-123', nested: { dashboardToken: 'abc', is_password: true, note: 'path /home/me/x uses KEY123' },
      list: ['KEY123'], key_env: '',
    }, ['KEY123', '/home/me']) as any;
    expect(out.api_key).toBe('<redacted>');
    expect(out.nested.dashboardToken).toBe('<redacted>');
    expect(out.nested.is_password).toBe(true);
    expect(out.nested.note).toBe('path <redacted>/x uses <redacted>');
    expect(out.list).toEqual(['<redacted>']);
    expect(out.key_env).toBe('');
  });
});
