import { Fragment, type ReactNode } from 'react';
import { t } from './index';

/**
 * Sentence with React nodes inside: `<T k="Ouvrir {lien} dans Hermes" vars={{ lien: <a …>…</a> }} />`.
 * `k` is a French key like for `t()`; each `{name}` of the translated sentence becomes `vars.name`.
 */
export function T({ k, vars }: { k: string; vars: Record<string, ReactNode> }) {
  const parts = t(k).split(/\{(\w+)\}/g);
  return <>{parts.map((p, i) => (i % 2 === 0 ? p : <Fragment key={i}>{p in vars ? vars[p] : `{${p}}`}</Fragment>))}</>;
}
