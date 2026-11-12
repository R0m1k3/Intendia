import type { ChatMessage } from '../chat/history.js';

// Markdown and HTML exports of a session, made by Intendia from the messages the session page shows (Hermes only
// exports JSON). Pure functions.

/** Name shown above the agent's answers: the profile when it is not "default", else the instance's label. */
export function agentName(profile: string, instanceLabel: string): string {
  return profile !== 'default' ? profile : instanceLabel.trim() || 'Hermes';
}

function who(m: ChatMessage, agent: string): string | null {
  if (m.role === 'user') return 'Vous';
  if (m.role === 'assistant') return agent;
  if (m.role === 'delegation') return 'Sous-agents (résultat)';
  if (m.role === 'tool') return `Outil ${m.toolName ?? ''}`.trim();
  return null; // system and the like are not part of the conversation
}

const date = (sec: number | null): string => (sec ? new Date(sec * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '');

export interface ExportHead { title: string; startedAt: number | null; agent: string }

export function toMarkdown(head: ExportHead, messages: ChatMessage[]): string {
  const out = [`# ${head.title}`, ''];
  if (head.startedAt) out.push(`_${date(head.startedAt)}_`, '');
  for (const m of messages) {
    const name = who(m, head.agent);
    if (!name) continue;
    const at = date(m.timestamp);
    out.push(`## ${name}${at ? ` · ${at}` : ''}${m.steer ? ' (réorientation)' : ''}`, '');
    if (m.content.trim()) out.push(m.content.trim(), '');
    for (const t of m.toolCalls) out.push(`> Outil appelé : \`${t.name}\``, '');
  }
  return out.join('\n');
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** A standalone page: text escaped, no script, no outside resource. */
export function toHtml(head: ExportHead, messages: ChatMessage[]): string {
  const items: string[] = [];
  for (const m of messages) {
    const name = who(m, head.agent);
    if (!name) continue;
    const at = date(m.timestamp);
    const tools = m.toolCalls.map((t) => `<p class="tool">Outil appelé : <code>${esc(t.name)}</code></p>`).join('');
    items.push(`<section class="${esc(m.role)}"><h2>${esc(name)}${at ? ` <small>${esc(at)}</small>` : ''}</h2>${m.content.trim() ? `<div class="text">${esc(m.content.trim())}</div>` : ''}${tools}</section>`);
  }
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(head.title)}</title>
<style>body{font:15px/1.55 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#16181b}h1{font-size:1.4rem}h2{font-size:.85rem;margin:0 0 .3rem;color:#555}small{font-weight:400;color:#888}section{border-top:1px solid #e5e5e5;padding:.9rem 0}.text{white-space:pre-wrap}.tool{color:#666;font-size:.85rem;margin:.3rem 0 0}.user .text{background:#f5f5f6;padding:.5rem .7rem;border-radius:8px}</style>
</head><body><h1>${esc(head.title)}</h1>${head.startedAt ? `<p><small>${esc(date(head.startedAt))}</small></p>` : ''}
${items.join('\n')}
</body></html>
`;
}

/** Content-Disposition of a download: an ASCII name (no quote, no line break) plus the exact one (RFC 5987). */
export function attachmentHeader(title: string, ext: string): string {
  const base = (title.replace(/[\r\n\t]+/g, ' ').trim() || 'session').slice(0, 80);
  const ascii = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 ._-]+/g, '_').trim() || 'session';
  return `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${encodeURIComponent(`${base}.${ext}`)}`;
}
