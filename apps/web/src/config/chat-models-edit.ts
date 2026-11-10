/** Rule of a model name, same as the server's (PatchSession.model): 1-200 characters, no space. */
export function validModelName(name: string): boolean {
  const n = name.trim();
  return n.length > 0 && n.length <= 200 && !/\s/.test(n);
}

/**
 * Choices of the "Ajouter un modèle" field of one provider: its catalogue models matching `typed` (substring, any
 * case) and not declared yet (any case, like Hermes), 20 at most; then the typed name itself when it is valid and
 * neither declared nor in the list (a model Hermes does not list can still be declared).
 */
export function addChoices(catalogue: string[], declared: string[], typed: string, max = 20): { model: string; typed: boolean }[] {
  const q = typed.trim();
  const taken = new Set(declared.map((m) => m.toLowerCase()));
  const found = catalogue.filter((m) => !taken.has(m.toLowerCase()) && (!q || m.toLowerCase().includes(q.toLowerCase()))).slice(0, max);
  const out = found.map((model) => ({ model, typed: false }));
  if (q && validModelName(q) && !taken.has(q.toLowerCase()) && !found.some((m) => m.toLowerCase() === q.toLowerCase())) {
    out.push({ model: q, typed: true });
  }
  return out;
}
