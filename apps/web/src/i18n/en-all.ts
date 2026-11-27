// The whole English dictionary: every zone file merged. Loaded on demand by main.tsx (English interface) and
// directly by the tests.
const en: Record<string, string> = Object.assign(
  {},
  ...Object.values(import.meta.glob<{ default: Record<string, string> }>('./en/*.ts', { eager: true })).map((m) => m.default),
);

export default en;
