import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useModuleAvailability } from '../components/ModuleNotice';

/** Key of one copy action (duplicate, continue, import): a retry with the same key gives the same copy. */
export function newKey(): string {
  return crypto.randomUUID();
}

/** Copies and the JSON export go through Hermes' dashboard: hidden when its routes are missing. */
export function useCopyOps(instanceId: string | undefined): { canCopy: boolean; canExportJson: boolean; canTitleAi: boolean } {
  const { has } = useModuleAvailability(instanceId, 'sessions', [], []);
  // the title by AI needs `llm.oneshot` of the dashboard WebSocket: only shown once the check found it
  const compat = useQuery({ queryKey: ['compat'], queryFn: api.compat });
  const socket = compat.data?.reports.find((r) => r.instanceId === instanceId)?.socket;
  return { canCopy: has('sessions', 'export') && has('sessions', 'import'), canExportJson: has('sessions', 'export'), canTitleAi: socket?.oneshot === true };
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
