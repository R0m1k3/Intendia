/** Fixture naming and secret redaction, shared by probe and the fake Hermes server. */

const SECRET_KEY = /(api[_-]?key|token|secret|password|passwd|credential|authorization|cookie|private[_-]?key)$/i;
const REDACTED = '<redacted>';

export function redact(value: unknown, extra: string[]): unknown {
  const scrub = (s: string) => extra.reduce((acc, e) => (e ? acc.split(e).join(REDACTED) : acc), s);
  if (typeof value === 'string') return scrub(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, extra));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[scrub(k)] = typeof v === 'string' && v !== '' && SECRET_KEY.test(k) ? REDACTED : redact(v, extra);
    }
    return out;
  }
  return value;
}

export function fixtureName(method: string, path: string): string {
  return `${method.toUpperCase()}${path.replace(/[^A-Za-z0-9]+/g, '_')}.json`;
}

