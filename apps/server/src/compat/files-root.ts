/**
 * Root of the workspaces of an instance = the dashboard's managed files root (`locked_root`), read during the
 * compatibility check. Accepted only when it isolates the workspaces: a locked root that is neither `/` nor
 * Hermes' home (or one of its ancestors), and an agent whose terminal runs in the Hermes container (`local`),
 * so that it sees the same paths as the dashboard.
 */
import { callOp } from '../connectors/runtime.js';
import type { CompatReport } from '../connectors/types.js';
import type { HermesFilesList } from '../connectors/files/index.js';
import type { HermesHttp } from '../hermes/http.js';
import { msg } from '../i18n/index.js';

export const FILES_ROOT_LINE = 'HERMES_DASHBOARD_FILES_ROOT=/opt/data/workspace';

const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/** True when `a` is `b` or one of its ancestors. */
function containsOrEquals(a: string, b: string): boolean {
  return a === '/' || b === a || b.startsWith(`${a}/`);
}

export async function readFilesRoot(http: HermesHttp, report: CompatReport): Promise<{ workspaceRoot: string | null; reason: string | null }> {
  const no = (reason: string) => ({ workspaceRoot: null, reason });
  if (!http.hasDashboard()) return no(msg('Fichiers des workspaces indisponibles : dashboard non configuré pour cette instance.'));
  try {
    const list = await callOp<HermesFilesList>(http, report, 'files', 'list');
    if (!list.locked_root) {
      return no(msg("Hermes n'a pas de racine de fichiers verrouillée : ajoutez {line} à l'environnement du conteneur Hermes, puis redémarrez Hermes et cliquez « Revérifier ».", { line: FILES_ROOT_LINE }));
    }
    const root = trim(list.locked_root);
    const status = await callOp<{ hermes_home?: string | null }>(http, report, 'health', 'dashboardStatus').catch(() => null);
    const home = status?.hermes_home ? trim(status.hermes_home) : null;
    if (root === '/' || (home && containsOrEquals(root, home))) {
      return no(msg("La racine de fichiers d'Hermes ({root}) contient sa configuration : ajoutez {line} à l'environnement du conteneur Hermes, puis redémarrez Hermes et cliquez « Revérifier ».", { root, line: FILES_ROOT_LINE }));
    }
    const config = await callOp<{ terminal?: { backend?: unknown } }>(http, report, 'config', 'get');
    const backend = typeof config?.terminal?.backend === 'string' ? config.terminal.backend : 'local';
    if (backend !== 'local') {
      return no(msg("Le terminal de l'agent est « {backend} » : il ne voit pas les fichiers du dashboard. Intendia exige terminal.backend: local.", { backend }));
    }
    return { workspaceRoot: root, reason: null };
  } catch (err) {
    return no(msg('Racine des fichiers illisible : {error}', { error: (err as Error).message }));
  }
}

/** Adds `files` to a report; without a workspace root the Files module becomes unavailable, with the reason first. */
export async function withFilesRoot(http: HermesHttp, report: CompatReport): Promise<CompatReport> {
  report.files = await readFilesRoot(http, report);
  if (!report.files.workspaceRoot) {
    const mod = report.modules.find((m) => m.id === 'files');
    if (mod) {
      mod.state = 'unavailable';
      mod.reasons = [report.files.reason!, ...mod.reasons];
    }
  }
  return report;
}
