/** Selection of a list + detail page: the item named in the address, else the first one (null for an empty list). */
export function pickSelected<T>(items: readonly T[], key: string | undefined, keyOf: (t: T) => string): T | null {
  if (items.length === 0) return null;
  if (key !== undefined) {
    const hit = items.find((t) => keyOf(t) === key);
    if (hit) return hit;
  }
  return items[0]!;
}

/** A cron id is unique per profile only: the address names `<profile>/<id>`. */
export function cronKey(c: { profile: string; id: string }): string {
  return `${c.profile}/${c.id}`;
}

export function parseCronKey(k: string | undefined): { profile: string; id: string } | null {
  if (!k) return null;
  const i = k.indexOf('/');
  if (i <= 0 || i === k.length - 1) return null;
  return { profile: k.slice(0, i), id: k.slice(i + 1) };
}
