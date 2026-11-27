// The agent's card in the session's side panel (OpenBot-like « Agent settings »), in four groups: Brain (model and
// modes), Knows (memory, skills, SOUL.md), Does (crons, kanban, gateway), Rules (« Sans confirmation », guardrails,
// site access). Each group shows the gist and links to the full page of that profile.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, BookOpen, Brain, ShieldCheck, Wrench, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { api } from '../api';
import { shortModel } from '../chat/format';
import { cx, ErrorText } from '../components/ui';
import { locale, plural, t } from '../i18n';
import { AgentAvatar, ColorChoice, useAgentLooks } from './look';

type LinkTo = { to: string; params?: Record<string, string>; search?: Record<string, unknown> };

function Group({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-t border-line/70 px-4 py-3.5">
      <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink">
        <span className="text-ink-faint">{icon}</span>{title}
      </h3>
      <dl className="flex flex-col gap-1.5">{children}</dl>
    </section>
  );
}

function Row({ label, value, link }: { label: string; value: ReactNode; link?: LinkTo }) {
  const body = (
    <>
      <dt className="shrink-0 text-ink-faint">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-right text-ink">{value}</dd>
      {link && <ArrowUpRight className="size-3.5 shrink-0 text-ink-faint group-hover:text-ink" strokeWidth={1.5} aria-hidden />}
    </>
  );
  const cls = 'flex items-center gap-3 rounded-md px-1.5 py-1 text-[13px]';
  return link
    ? <Link {...(link as { to: string })} className={cx(cls, 'group -mx-1.5 hover:bg-paper')}>{body}</Link>
    : <div className={cx(cls, '-mx-1.5')}>{body}</div>;
}

const pct = (u: { bytes: number; limit: number } | null | undefined) => (u && u.limit > 0 ? `${Math.round((u.bytes / u.limit) * 100)} %` : '—');

export function AgentPanel({ inst, profile, autoApprove, onAutoApprove, onClose }: {
  inst: string; profile: string;
  /** « Sans confirmation » of this session */
  autoApprove: boolean; onAutoApprove: (on: boolean) => void;
  onClose: () => void;
}) {
  const looks = useAgentLooks(inst);
  const agents = useQuery({ queryKey: ['agents', inst], queryFn: () => api.agents(inst).then((r) => r.agents), staleTime: 60_000, retry: false });
  const detail = useQuery({ queryKey: ['agent-detail', inst, profile], queryFn: () => api.agent(inst, profile).then((r) => r.agent), staleTime: 60_000, retry: false });
  const modes = useQuery({ queryKey: ['modes', inst, profile], queryFn: () => api.modes(inst, profile).then((r) => r.modes), staleTime: 60_000 });
  const memory = useQuery({ queryKey: ['memory', inst, profile], queryFn: () => api.memory(inst, profile), staleTime: 60_000, retry: false });
  const crons = useQuery({ queryKey: ['crons-overview'], queryFn: () => api.cronsOverview(), staleTime: 60_000 });
  const a = agents.data?.find((x) => x.name === profile) ?? detail.data;
  const search = { profile: profile === 'default' ? undefined : profile };
  const page = (p: string, extra: Record<string, unknown> = {}): LinkTo => ({ to: `/i/$inst/${p}`, params: { inst }, search: { ...search, ...extra } });
  const mine = (crons.data?.crons ?? []).filter((c) => c.instanceId === inst && c.profile === profile);
  const next = mine.map((c) => c.nextRunAt).filter((x): x is string => Boolean(x)).sort()[0];
  const soul = detail.data?.soul?.trim() ?? null;

  return (
    <div data-agent-panel className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-start gap-3 px-4 pb-3.5 pt-4">
        <AgentAvatar name={profile} color={looks.color(profile)} size={44} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[17px] font-semibold leading-6">{profile}</h2>
          <p className="line-clamp-2 text-[12.5px] text-ink-soft">{a?.description || (a?.isDefault ? t('L’agent principal de l’instance') : t('Sans description'))}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t('Fermer le panneau')} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-raised hover:text-ink">
          <X className="size-4" strokeWidth={1.5} />
        </button>
      </div>
      <div className="px-4 pb-3.5">
        <ColorChoice value={looks.index(profile)} onPick={(i) => void looks.set(profile, i)} />
      </div>
      <ErrorText error={agents.error && detail.error} />

      <Group icon={<Brain className="size-4" strokeWidth={1.5} />} title={t('Cerveau')}>
        <Row label={t('Modèle par défaut')} value={<span className="font-mono text-[12px]">{a?.model ? shortModel(a.model) : t('Celui d’Hermes')}</span>} link={page('config', { tab: 'modeles' })} />
        <Row label={t('Modes')} value={modes.data?.length ? modes.data.map((m) => m.name).join(', ') : t('Aucun')} link={page('config', { tab: 'modeles' })} />
      </Group>

      <Group icon={<BookOpen className="size-4" strokeWidth={1.5} />} title={t('Sait')}>
        <Row label={t('Mémoire')} value={memory.data ? t('{pct} remplie', { pct: pct(memory.data.usage.memory) }) : '—'} link={page('memoire')} />
        <Row label={t('Skills')} value={a?.skillCount ?? memory.data?.stats.skills ?? '—'} link={page('skills')} />
        <Row label="SOUL.md" value={soul ? soul.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '') ?? '' : t('Celui d’Hermes')} link={{ to: '/i/$inst/agents/$name', params: { inst, name: profile } }} />
      </Group>

      <Group icon={<Wrench className="size-4" strokeWidth={1.5} />} title={t('Fait')}>
        <Row label={t('Planning')} value={mine.length
          ? (next ? t('{count}, prochain {when}', { count: plural(mine.length, '{n} planification', '{n} planifications'), when: new Date(next).toLocaleString(locale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' }) }) : plural(mine.length, '{n} planification', '{n} planifications'))
          : t('Aucune planification')} link={page('crons')} />
        <Row label={t('Tâches')} value={a?.workers == null ? '—' : plural(a.workers, '{n} en cours', '{n} en cours')} link={page('kanban')} />
        <Row label={t('Messageries')} value={a?.gatewayRunning == null ? '—' : a.gatewayRunning ? t('Passerelle active') : t('Passerelle arrêtée')} link={{ to: '/i/$inst/agents/$name', params: { inst, name: profile } }} />
        <Row label="MCP" value={t('Serveurs et outils')} link={page('config', { tab: 'mcp' })} />
      </Group>

      <Group icon={<ShieldCheck className="size-4" strokeWidth={1.5} />} title={t('Règles')}>
        <div className="-mx-1.5 flex items-center gap-3 rounded-md px-1.5 py-1 text-[13px]">
          <span className="flex-1 text-ink-faint">{t('Sans confirmation (cette session)')}</span>
          <button type="button" role="switch" aria-checked={autoApprove} onClick={() => onAutoApprove(!autoApprove)}
            aria-label={t('Sans confirmation (cette session)')}
            className={cx('relative h-5 w-9 shrink-0 rounded-full transition-colors', autoApprove ? 'bg-accent' : 'bg-line')}>
            <span className={cx('absolute top-0.5 size-4 rounded-full bg-sheet shadow transition-all', autoApprove ? 'left-[18px]' : 'left-0.5')} />
          </button>
        </div>
        <Row label={t('Garde-fous')} value={t('Commandes, fichiers, réseau')} link={page('config', { tab: 'garde-fous' })} />
        <Row label={t('Accès aux sites')} value={t('Identifiants et cartes')} link={page('acces')} />
      </Group>
    </div>
  );
}
