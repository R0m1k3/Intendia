import type { ModelOptions } from '../api';

/** Model names offered by Hermes (providers with a key), whatever the shape of each entry. */
export function modelNames(o: ModelOptions | undefined): string[] {
  const out = new Set<string>();
  if (o?.model) out.add(o.model);
  for (const p of o?.providers ?? []) {
    if (p.authenticated === false) continue;
    for (const m of p.models ?? []) {
      if (typeof m === 'string') out.add(m);
      else if (m && typeof m === 'object') {
        const v = (m as { id?: unknown; name?: unknown; model?: unknown }).id ?? (m as { model?: unknown }).model ?? (m as { name?: unknown }).name;
        if (typeof v === 'string') out.add(v);
      }
    }
  }
  return [...out];
}
