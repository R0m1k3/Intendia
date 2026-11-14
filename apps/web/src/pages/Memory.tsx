import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Brain, Sparkles } from 'lucide-react';
import { api } from '../api';
import { ModuleNotice, useModuleAvailability, type OpRef, type OptionalOp } from '../components/ModuleNotice';
import { Empty, ListPane, SplitView } from '../components/Panes';
import { ProfileSelect } from '../components/ProfileSelect';
import { Chips, ErrorText } from '../components/ui';
import { EntryDetail, EntryList } from '../memory/Entries';
import { LearnedDetail, LearnedList } from '../memory/Learned';
import { t } from '../i18n';
import { T } from '../i18n/T';

export const MEMORY_TABS = ['memoire', 'appris'] as const;
export type MemoryTab = (typeof MEMORY_TABS)[number];
export interface MemorySearch { profile?: string; tab?: MemoryTab; entry?: string; skill?: string }

const REQUIRED: OpRef[] = [['memory', 'graph']];
const OPTIONAL: OptionalOp[] = [
  ['memory', 'status', t('Taille des fichiers')], ['memory', 'node', t('Lire une entrée')], ['memory', 'putNode', t('Modifier une entrée')],
  ['memory', 'deleteNode', t('Supprimer une entrée')],
];
/** The graph is read on every visit; a few seconds of cache spare the switches between the two tabs. */
const STALE_MS = 15_000;

export function MemoryPage() {
  const { inst } = useParams({ strict: false }) as { inst: string };
  const search = useSearch({ strict: false }) as MemorySearch;
  const profile = search.profile ?? 'default';
  return <MemoryView key={`${inst}:${profile}`} inst={inst} profile={profile} search={search} />;
}

function MemoryView({ inst, profile, search }: { inst: string; profile: string; search: MemorySearch }) {
  const navigate = useNavigate();
  const a = useModuleAvailability(inst, 'memory', REQUIRED, OPTIONAL);
  const can = (op: string) => a.has('memory', op);
  const q = useQuery({ queryKey: ['memory', inst, profile], queryFn: () => api.memory(inst, profile), enabled: a.available, staleTime: STALE_MS });
  const tab: MemoryTab = search.tab ?? 'memoire';
  const p = profile === 'default' ? undefined : profile;
  const to = (s: Omit<MemorySearch, 'profile'>) => ({ to: '/i/$inst/memoire' as const, params: { inst }, search: { profile: p, ...s } });
  const go = (s: Omit<MemorySearch, 'profile'>, replace = false) => void navigate({ ...to(s), replace });
  const entryLink = (id: string) => to({ entry: id });
  const skillLink = (name: string) => to({ tab: 'appris', skill: name });
  const data = q.data;
  const entry = tab === 'memoire' && search.entry ? data?.entries.find((e) => e.id === search.entry) ?? null : null;
  const skill = tab === 'appris' && search.skill ? data?.skills.find((k) => k.name === search.skill) ?? null : null;

  const list = (
    <ListPane
      title={t('Mémoire')}
      action={<ProfileSelect inst={inst} value={profile} onChange={(x) => void navigate({ to: '/i/$inst/memoire', params: { inst }, search: { profile: x === 'default' ? undefined : x, tab: search.tab } })} />}
      head={a.available ? (
        <Chips role="tab" label={t('Sections')} value={tab} onChange={(k) => go({ tab: k === 'memoire' ? undefined : k })}
          items={[
            { key: 'memoire' as const, label: t('Mémoire'), count: data?.entries.length },
            { key: 'appris' as const, label: t('Appris'), count: data?.skills.length },
          ]} />
      ) : undefined}
      footer={a.available && tab === 'memoire' ? (
        <p className="sticky bottom-0 border-t border-line/70 bg-sheet px-4 py-3 text-xs text-ink-faint">
          {t('Pour ajouter un souvenir, dites-le à l’agent dans un chat (« retiens que… »).')}
        </p>
      ) : undefined}
    >
      <ErrorText error={q.error} />
      {a.available && q.isPending && <p className="px-3.5 py-6 text-sm text-ink-faint">{t('Chargement…')}</p>}
      {data?.active && (
        <p className="mx-1 mt-3 rounded-[10px] bg-paper px-3.5 py-2.5 text-[13px] text-ink-soft" data-provider>
          <T k="Mémoire externe active : {name}. Ses souvenirs restent chez ce fournisseur ; seuls les fichiers intégrés sont listés ici." vars={{ name: <span className="font-mono">{data.active}</span> }} />
        </p>
      )}
      {data && (tab === 'memoire'
        ? <EntryList overview={data} selected={search.entry} link={entryLink} />
        : <LearnedList overview={data} selected={search.skill} link={skillLink} />)}
    </ListPane>
  );

  const back = to(tab === 'memoire' ? {} : { tab: 'appris' });
  const detail = !data ? null : tab === 'memoire' ? (
    entry ? (
      <EntryDetail key={entry.id} inst={inst} profile={profile} entry={entry} canEdit={can('node') && can('putNode')} canDelete={can('deleteNode')} back={back}
        onSaved={(id) => go(id ? { entry: id } : {}, true)} onDeleted={() => go({}, true)} onSkill={(name) => go({ tab: 'appris', skill: name })} />
    ) : search.entry ? (
      <Empty icon={<Brain strokeWidth={1.5} />} title={t('Entrée introuvable')}>{t('Elle a changé ou a été supprimée depuis : choisissez-la de nouveau dans la liste.')}</Empty>
    ) : (
      <Empty icon={<Brain strokeWidth={1.5} />} title={t('La mémoire de l’agent')}>
        {t('Ce que l’agent retient d’une session à l’autre : ses notes (MEMORY.md) et ce qu’il sait de vous (USER.md). Hermes les met au début de chaque conversation, dans la limite de chaque fichier.')}
      </Empty>
    )
  ) : skill ? (
    <LearnedDetail key={skill.name} inst={inst} profile={profile} skill={skill} overview={data} skillLink={skillLink} entryLink={entryLink} back={back} />
  ) : (
    <Empty icon={<Sparkles strokeWidth={1.5} />} title={t('Ce que l’agent a appris')}>
      {t('Les skills qu’il a écrits ou dont il s’est servi, les liens entre eux et les souvenirs qui en sont proches.')}
    </Empty>
  );

  return (
    <SplitView label={t('Mémoire')} list={list} selected={Boolean(search.entry || search.skill)}>
      <div className="px-4 pt-5 empty:hidden md:px-6">
        <ModuleNotice instanceId={inst} module="memory" title={t('La mémoire')} required={REQUIRED} optional={OPTIONAL} explainMissing />
      </div>
      {a.available && detail}
    </SplitView>
  );
}
