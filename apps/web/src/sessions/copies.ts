import { useModuleAvailability } from '../components/ModuleNotice';

/** Key of one copy action (duplicate, continue, import): a retry with the same key gives the same copy. */
export function newKey(): string {
  return crypto.randomUUID();
}

/** Copies and the JSON export go through Hermes' dashboard: hidden when its routes are missing. */
export function useCopyOps(instanceId: string | undefined): { canCopy: boolean; canExportJson: boolean } {
  const { has } = useModuleAvailability(instanceId, 'sessions', [], []);
  return { canCopy: has('sessions', 'export') && has('sessions', 'import'), canExportJson: has('sessions', 'export') };
}

/** Downloads an export (the server sends it as an attachment). */
export function download(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
