import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { ChatNotice } from '../components/ChatNotice';
import { PageHeader } from '../components/Layout';
import { ModelInput } from '../components/NewWorkspace';
import { Button, ErrorText, Field, Panel, timeAgo } from '../components/ui';

export function WorkspacePage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const qc = useQueryClient();
  const navigate = useNavigate();
  const ws = useQuery({ queryKey: ['workspace', slug], queryFn: () => api.workspace(slug) });
  const [archived, setArchived] = useState(false);
  const sessions = useQuery({ queryKey: ['sessions', slug, archived], queryFn: () => api.sessions(slug, archived) });
  const agents = useQuery({ queryKey: ['agents-md', slug], queryFn: () => api.agentsMd(slug) });
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const [text, setText] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const w = ws.data?.workspace;
  const inst = instances.data?.instances.find((i) => i.id === w?.instanceId);

  useEffect(() => { setText(null); setModel(null); }, [slug]);

  const create = useMutation({
    mutationFn: () => api.createSession(slug),
    onSuccess: async ({ session }) => {
      await qc.invalidateQueries({ queryKey: ['sessions'] });
      await navigate({ to: '/w/$slug/s/$sessionId', params: { slug, sessionId: session.id } });
    },
  });
  const saveAgents = useMutation({
    mutationFn: (t: string) => api.saveAgentsMd(slug, t),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents-md', slug] }).then(() => setText(null)),
  });
  const saveModel = useMutation({
    mutationFn: (m: string) => api.updateWorkspace(slug, { model: m.trim() || null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace', slug] }).then(() => { setModel(null); void qc.invalidateQueries({ queryKey: ['workspaces'] }); }),
  });

  if (ws.isError) return <div className="p-8"><ErrorText error={ws.error} /></div>;
  const agentsValue = text ?? agents.data?.text ?? '';
  const modelValue = model ?? w?.model ?? '';

  return (
    <>
      <PageHeader
        title={w?.name ?? ''}
        subtitle={w && <span className="font-mono text-xs">{inst?.mount ?? ''}/{w.slug} · {inst?.label ?? w.instanceId} · {w.profile ?? 'default'}</span>}
        action={<Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending}><Plus className="size-4" strokeWidth={1.75} />Nouvelle session</Button>}
      />
      <div className="grid gap-6 px-5 pb-12 md:px-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <div className="empty:hidden"><ChatNotice instanceId={w?.instanceId} /></div>
          <ErrorText error={create.error} />
          <Panel
            bodyClassName=""
            title={archived ? 'Sessions archivées' : 'Sessions'}
            action={<Button variant="ghost" className="h-8 text-xs" onClick={() => setArchived(!archived)}>{archived ? 'Sessions en cours' : 'Archivées'}</Button>}
          >
            {sessions.isSuccess && sessions.data.sessions.length === 0 && (
              <p className="px-5 py-8 text-sm text-ink-soft">{archived ? 'Aucune session archivée' : 'Aucune session : ouvrez-en une pour écrire à l’agent'}</p>
            )}
            <ul className="divide-y divide-line">
              {sessions.data?.sessions.map((s) => (
                <li key={s.id}>
                  <Link to="/w/$slug/s/$sessionId" params={{ slug, sessionId: s.id }} className="flex h-12 items-center gap-3 px-5 text-sm transition-colors hover:bg-raised/50">
                    <span className="min-w-0 flex-1 truncate">{s.title || <span className="text-ink-faint">Nouvelle session</span>}</span>
                    <span className="shrink-0 text-xs text-ink-faint">{timeAgo(s.lastActiveAt ?? s.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Modèle">
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveModel.mutate(modelValue); }}>
              <Field label="Modèle des prochains messages" hint="Vide : celui de l’agent">
                {w && <ModelInput id="ws-model" inst={w.instanceId} profile={w.profile ?? 'default'} value={modelValue} onChange={setModel} />}
              </Field>
              <ErrorText error={saveModel.error} />
              {model !== null && model !== (w?.model ?? '') && <Button variant="secondary" disabled={saveModel.isPending}>Enregistrer</Button>}
            </form>
          </Panel>
          <Panel title="Consignes" action={<span className="font-mono text-[11px] text-ink-faint">AGENTS.md</span>}>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveAgents.mutate(agentsValue); }}>
              <textarea
                value={agentsValue}
                onChange={(e) => setText(e.target.value)}
                rows={14}
                disabled={!agents.isSuccess}
                aria-label="Consignes du projet"
                className="w-full resize-y rounded-lg border border-line bg-paper p-3 font-mono text-xs leading-relaxed focus:border-accent focus:outline-none"
              />
              <p className="text-xs text-ink-faint">Envoyées à l’agent avec chaque message (4 premiers Kio)</p>
              <ErrorText error={saveAgents.error} />
              {text !== null && text !== agents.data?.text && <Button variant="secondary" disabled={saveAgents.isPending}>Enregistrer</Button>}
            </form>
          </Panel>
        </div>
      </div>
    </>
  );
}
