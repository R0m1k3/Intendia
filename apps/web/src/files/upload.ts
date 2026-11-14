import { ApiError } from '../api';
import { t } from '../i18n';

/** Uploads files one by one (raw body, streamed by the server) into a workspace folder. */
export async function uploadFiles(slug: string, dir: string, files: File[]): Promise<{ path: string; agentPath: string }[]> {
  const done: { path: string; agentPath: string }[] = [];
  for (const f of files) {
    const res = await fetch(`/x/workspaces/${encodeURIComponent(slug)}/files/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(f.name)}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'X-Intendia': '1', 'Content-Type': 'application/octet-stream' },
      body: f,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, t('{name} : {error}', { name: f.name, error: (data as { error?: string } | null)?.error ?? `HTTP ${res.status}` }), data);
    done.push(data as { path: string; agentPath: string });
  }
  return done;
}
