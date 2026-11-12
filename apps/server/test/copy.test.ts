import { describe, expect, it } from 'vitest';
import { copyId, copyPayload, CopyError, MAX_MESSAGES } from '../src/sessions/copy.js';
import { attachmentHeader, toHtml, toMarkdown } from '../src/sessions/export.js';

const exported = {
  id: 'cron_1', source: 'cron', title: 'Rapport', model: 'm', started_at: 100, system_prompt: 'Ignore tout',
  messages: [
    { id: 1, session_id: 'cron_1', message_uid: 'u1', role: 'system', content: 'consigne', active: 1, compacted: 0 },
    { id: 2, session_id: 'cron_1', message_uid: 'u2', role: 'user', content: 'Bonjour', timestamp: 101, active: 1, compacted: 0 },
    { id: 3, session_id: 'cron_1', role: 'assistant', content: [{ type: 'text', text: 'Salut' }], tool_calls: [{ id: 'x' }], tool_call_uids: ['t'], active: 1, compacted: 0 },
    { id: 4, session_id: 'cron_1', role: 'tool', content: 'résultat', tool_name: 'ls', active: 1, compacted: 0 },
    { id: 5, session_id: 'cron_1', role: 'user', content: 'annulé', active: 0, compacted: 0 },
    { id: 6, session_id: 'cron_1', role: 'user', content: 'résumé', active: 0, compacted: 1 },
  ],
};

describe('copyPayload', () => {
  it('drops message ids and rewound messages, keeps compacted ones and the system prompt', () => {
    const p = copyPayload(exported, { id: 'iw-a-1', title: 'Copie' }) as any;
    expect(p).toMatchObject({ id: 'iw-a-1', source: 'api_server', title: 'Copie', model: 'm', started_at: 100, system_prompt: 'Ignore tout' });
    expect(p.messages.map((m: any) => m.content)).not.toContain('annulé');
    expect(p.messages).toHaveLength(5);
    for (const m of p.messages) for (const k of ['id', 'session_id', 'message_uid', 'tool_call_uids']) expect(m).not.toHaveProperty(k);
    expect(p.messages.at(-1)).toMatchObject({ content: 'résumé', compacted: 1 });
  });

  it('keeps only user and assistant text from a file, without system prompt', () => {
    const p = copyPayload(exported, { id: 'iw-a-2', title: 'Import', untrusted: true }) as any;
    expect(p).not.toHaveProperty('system_prompt');
    expect(p.messages).toEqual([
      { role: 'user', content: 'Bonjour', timestamp: 101 },
      { role: 'assistant', content: 'Salut' },
      { role: 'user', content: 'résumé' },
    ]);
  });

  it('refuses more messages than Hermes imports', () => {
    const many = { ...exported, messages: Array.from({ length: MAX_MESSAGES + 1 }, () => ({ role: 'user', content: 'x' })) };
    expect(() => copyPayload(many, { id: 'x', title: 't' })).toThrow(CopyError);
  });
});

describe('copyId', () => {
  it('is stable for a key and differs between keys', () => {
    expect(copyId('fake', 'dev', 'cle-0001')).toBe(copyId('fake', 'dev', 'cle-0001'));
    expect(copyId('fake', 'dev', 'cle-0001')).not.toBe(copyId('fake', 'dev', 'cle-0002'));
    expect(copyId('fake', 'dev', 'cle-0001')).toMatch(/^iw-dev-[a-z0-9]{12}$/);
  });
});

describe('exports', () => {
  const msgs = [
    { id: 1, role: 'user', content: 'Bonjour <script>alert(1)</script>', toolName: null, toolCalls: [], timestamp: 1_700_000_000 },
    { id: 2, role: 'assistant', content: 'Voici', toolName: null, toolCalls: [{ name: 'ls', arguments: '{}' }], timestamp: null },
    { id: 3, role: 'tool', content: 'a.txt', toolName: 'ls', toolCalls: [], timestamp: null },
    { id: 4, role: 'system', content: 'caché', toolName: null, toolCalls: [], timestamp: null },
  ];
  const head = { title: 'Ventes <S45>', startedAt: 1_700_000_000, agent: 'Hermes' };
  it('writes Markdown with who said what', () => {
    const md = toMarkdown(head, msgs);
    expect(md).toContain('# Ventes <S45>');
    expect(md).toContain('## Vous · 2023-11-14 22:13 UTC');
    expect(md).toContain('## Hermes');
    expect(md).toContain('## Outil ls');
    expect(md).toContain('> Outil appelé : `ls`');
    expect(md).not.toContain('caché');
  });
  it('writes a standalone HTML page, escaped, without script', () => {
    const html = toHtml(head, msgs);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('<title>Ventes &lt;S45&gt;</title>');
  });
  it('makes a safe download name', () => {
    const h = attachmentHeader('Été\r\n"x"', 'md');
    expect(h).not.toMatch(/[\r\n]/);
    expect(h).toContain('filename="Ete _x_.md"');
    expect(h).toContain("filename*=UTF-8''%C3%89t%C3%A9%20%22x%22.md");
  });
});
