import { describe, expect, it } from 'vitest';
import { Masker, isSecretKey, SecretError } from '../src/hermes-config/mask.js';

const m = new Masker('test-secret-0123456789abcdef');
const ID = /«secret:[0-9a-f]{8}»/;

describe('Masker.config', () => {
  it('masks secret keys, sections and token-shaped values, never numbers or booleans', () => {
    const out = m.config({
      model: { api_key: 'sk-abc-123456789', default: 'anthropic/claude' },
      agent: { max_tokens: 4096, token_budget: 10, debug: true },
      foo: 'sk-live-abcdefghijk',
      bot: '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      ref: '${OPENAI_API_KEY}',
      empty_token: '',
      mcp_servers: { x: { url: 'https://h/mcp', headers: { 'X-Custom': 'abc' }, env: { FOO: 'bar' } } },
      providers: { y: { extra_headers: { 'X-Org': 'org-1' }, name: 'Y' } },
      secrets: { bitwarden: { access_token_env: 'BWS_ACCESS_TOKEN' } },
    });
    expect(out.model.api_key).toMatch(ID);
    expect(out.model.default).toBe('anthropic/claude');
    expect(out.agent).toEqual({ max_tokens: 4096, token_budget: 10, debug: true });
    expect(out.foo).toMatch(ID);
    expect(out.bot).toMatch(ID);
    expect(out.ref).toBe('${OPENAI_API_KEY}');
    expect(out.empty_token).toBe('');
    expect(out.mcp_servers.x.url).toBe('https://h/mcp');
    expect(out.mcp_servers.x.headers['X-Custom']).toMatch(ID);
    expect(out.mcp_servers.x.env.FOO).toMatch(ID);
    expect(out.providers.y.extra_headers['X-Org']).toMatch(ID);
    expect(out.providers.y.name).toBe('Y');
    expect(out.secrets.bitwarden.access_token_env).toBe('BWS_ACCESS_TOKEN');
  });

  it('gives the same id to the same secret and another id to another one', () => {
    const a = m.config({ api_key: 'sk-one-1234567' });
    const b = m.config({ other: { token: 'sk-one-1234567' } });
    const c = m.config({ api_key: 'sk-two-1234567' });
    expect(a.api_key).toBe(b.other.token);
    expect(a.api_key).not.toBe(c.api_key);
  });

  it('masks URL credentials', () => {
    const out = m.config({ a: 'https://u:p@h/p?key=v&a=b', hook: 'https://hooks.slack.com/services/T0/B0/xyz' });
    expect(out.a).toMatch(/^https:\/\/u:«secret:[0-9a-f]{8}»@h\/p\?key=«secret:[0-9a-f]{8}»&a=«secret:[0-9a-f]{8}»$/);
    expect(out.hook).toMatch(/^https:\/\/hooks\.slack\.com\/services\/«secret:[0-9a-f]{8}»$/);
  });

  it('knows which key names are secrets', () => {
    expect(isSecretKey('api_key')).toBe(true);
    expect(isSecretKey('Authorization')).toBe(true);
    expect(isSecretKey('password_store')).toBe(false);
    expect(isSecretKey('threshold_tokens')).toBe(false);
    expect(isSecretKey('access_token_env')).toBe(false);
  });
});

describe('Masker.text', () => {
  it('masks pairs, bearer tokens, prefixes and URLs anywhere in a text', () => {
    const t = m.text('connect failed token=sk-test-err-0005 at https://h/?k=v');
    expect(t).not.toContain('sk-test');
    expect(t).not.toMatch(/k=v\b/);
    expect(m.text('Authorization: Bearer abcdef123456')).not.toContain('abcdef123456');
    expect(m.text('api_key: opaque-value')).not.toContain('opaque-value');
    expect(m.text('bad token 123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).not.toContain('AAAAAAAAAA');
    expect(m.text('max_tokens=4096')).toBe('max_tokens=4096');
    expect(m.text('Gateway restarted')).toBe('Gateway restarted');
  });
});

const YAML_TEXT = `# Hermes config
model:
  # main model
  default: "anthropic/claude"
  api_key: sk-test-model-0001   # in clear
providers:
  custom:
    api_key: \${CUSTOM_KEY}
keys:
  api_keys:
    - sk-test-list-aaaa1
    - sk-test-list-bbbb2
cert:
  private_key: |
    -----BEGIN KEY-----
    abcdef
    -----END KEY-----
display:
  compact: yes
`;

describe('Masker.yaml and restore', () => {
  it('masks in place and keeps comments and order', () => {
    const masked = m.yaml(YAML_TEXT);
    expect(masked).not.toContain('sk-test');
    expect(masked).not.toContain('abcdef');
    expect(masked).toContain('# Hermes config');
    expect(masked).toContain('# in clear');
    expect(masked).toContain('${CUSTOM_KEY}');
    expect(masked).toContain('compact: yes');
    expect(masked.indexOf('model:')).toBeLessThan(masked.indexOf('display:'));
  });

  it('round-trips: restore(mask(t)) gives the same values', async () => {
    const { parse } = await import('../src/hermes-config/mask.js');
    const back = m.restore(m.yaml(YAML_TEXT), YAML_TEXT);
    expect(parse(back).toJS()).toEqual(parse(YAML_TEXT).toJS());
    expect(parse(back).toJS().display.compact).toBe(true);
  });

  it('restores by id: moved lines and swapped list items keep their values', async () => {
    const { parse } = await import('../src/hermes-config/mask.js');
    const masked = m.yaml(YAML_TEXT);
    const lines = masked.split('\n');
    const a = lines.findIndex((l) => l.includes('- "«secret'));
    [lines[a], lines[a + 1]] = [lines[a + 1]!, lines[a]!];
    // move the model key under another secret key elsewhere
    const keyLine = lines.findIndex((l) => l.includes('api_key: "«secret'));
    const moved = lines[keyLine]!.replace('api_key', 'token');
    lines.splice(keyLine, 1);
    lines.push('other:', `  ${moved.trim()}`);
    const out = parse(m.restore(lines.join('\n'), YAML_TEXT)).toJS();
    expect(out.keys.api_keys).toEqual(['sk-test-list-bbbb2', 'sk-test-list-aaaa1']);
    expect(out.other.token).toBe('sk-test-model-0001');
    expect(out.model.api_key).toBeUndefined();
  });

  it('keeps a multi-line secret valid at another indentation', async () => {
    const { parse } = await import('../src/hermes-config/mask.js');
    const masked = m.yaml(YAML_TEXT);
    const id = /private_key: ("«secret:[0-9a-f]{8}»")/.exec(masked)![1];
    const draft = masked.replace(/cert:\n {2}private_key: .*\n/, '') + `deep:\n  er:\n    private_key: ${id}\n`;
    const out = parse(m.restore(draft, YAML_TEXT)).toJS();
    expect(out.deep.er.private_key).toBe('-----BEGIN KEY-----\nabcdef\n-----END KEY-----\n');
  });

  it('refuses an unknown placeholder and a secret moved under a clear key', () => {
    expect(() => m.restore('a:\n  api_key: «secret:deadbeef»\n', YAML_TEXT)).toThrow(SecretError);
    const masked = m.yaml(YAML_TEXT);
    // a token-shaped value (sk-...) stays masked anywhere; the PEM key is only hidden by its key name
    const id = /private_key: ("«secret:[0-9a-f]{8}»")/.exec(masked)![1];
    try {
      m.restore(`${masked}notes:\n  x: ${id}\n`, YAML_TEXT);
      throw new Error('should fail');
    } catch (e) {
      expect((e as SecretError).code).toBe('secret_moved');
      expect((e as SecretError).extra.path).toBe('notes.x');
    }
  });

  it('keeps a new value typed over a placeholder', async () => {
    const { parse } = await import('../src/hermes-config/mask.js');
    const draft = m.yaml(YAML_TEXT).replace(/api_key: "«secret:[0-9a-f]{8}»"/, 'api_key: sk-new-value-99');
    expect(parse(m.restore(draft, YAML_TEXT)).toJS().model.api_key).toBe('sk-new-value-99');
  });

  it('reports the line of a YAML error', () => {
    try {
      m.restore('a: 1\nb: [unclosed\n', YAML_TEXT);
      throw new Error('should fail');
    } catch (e) {
      expect((e as SecretError).code).toBe('invalid_yaml');
      expect((e as SecretError).extra.line).toBeTypeOf('number');
    }
    expect(() => m.restore('- a\n- b\n', YAML_TEXT)).toThrow(/table/);
  });
});
