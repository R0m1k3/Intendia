import { Link, useNavigate } from '@tanstack/react-router';
import { Layers } from 'lucide-react';
import type { LearnedSkill, MemoryOverview } from '../api';
import { DetailBody, DetailHeader, Facts, ListItemBody, ListLink } from '../components/Panes';
import { Button, Tag } from '../components/ui';
import type { EntryLink } from './Entries';
import { plural, t } from '../i18n';

const ICON = 'size-4';
type SkillLink = (name: string) => { to: '/i/$inst/memoire'; params: { inst: string }; search: Record<string, string | undefined> };

const BY: Record<string, string> = { agent: t('l’agent'), learn: t('apprentissage'), bundled: t('fourni'), hub: t('hub'), user: t('vous') };

/** The learned skills of the graph (written by the agent, or used), most used first. */
export function LearnedList({ overview, selected, link }: { overview: MemoryOverview; selected: string | undefined; link: SkillLink }) {
  const list = [...overview.skills].sort((a, b) => b.useCount - a.useCount || a.name.localeCompare(b.name));
  const s = overview.stats;
  return (
    <>
      <p className="px-3.5 pb-1.5 pt-4 text-xs text-ink-faint" data-learned-stats>
        {plural(s.skills, '{n} skill appris', '{n} skills appris')} · {plural(s.links, '{n} lien entre eux', '{n} liens entre eux')}
        {s.isolatedPct !== null && s.skills > 0 ? ` · ${t('{n} % isolés', { n: s.isolatedPct })}` : ''}
      </p>
      {list.length === 0 && <p className="px-3.5 py-3 text-sm text-ink-faint">{t('Rien d’appris pour l’instant : un skill apparaît ici quand l’agent l’écrit ou s’en sert.')}</p>}
      <ul className="flex flex-col gap-0.5" aria-label={t('Skills appris')}>
        {list.map((k) => (
          <li key={k.name} data-learned={k.name}>
            <ListLink link={link(k.name)} selected={selected === k.name}>
              <ListItemBody
                mono title={k.name}
                meta={<Tag>{plural(k.useCount, '{n} usage', '{n} usages')}</Tag>}
                sub={[k.category, k.pinned ? t('épinglé') : null, k.related.length || k.memories.length ? plural(k.related.length + k.memories.length, '{n} lien', '{n} liens') : null].filter(Boolean).join(' · ') || undefined}
              />
            </ListLink>
          </li>
        ))}
      </ul>
    </>
  );
}

/** A learned skill: its facts, the skills it links to and the memories close to it; opens in the Skills page. */
export function LearnedDetail({ inst, profile, skill, overview, skillLink, entryLink, back }: {
  inst: string; profile: string; skill: LearnedSkill; overview: MemoryOverview; skillLink: SkillLink; entryLink: EntryLink;
  back: { to: '/i/$inst/memoire'; params: { inst: string }; search: Record<string, string | undefined> };
}) {
  const navigate = useNavigate();
  const near = skill.memories.map((id) => overview.entries.find((e) => e.id === id)).filter((e) => e !== undefined);
  const linkClass = 'rounded-md transition-opacity hover:opacity-70';
  return (
    <article aria-label={skill.name} data-learned-detail={skill.name}>
      <DetailHeader
        mono title={skill.name} sub={skill.category ?? undefined} back={back}
        actions={(
          <Button onClick={() => void navigate({ to: '/i/$inst/skills', params: { inst }, search: { profile: profile === 'default' ? undefined : profile, skill: skill.name } })}>
            <Layers className={ICON} strokeWidth={1.5} />{t('Ouvrir dans Skills')}
          </Button>
        )}
      />
      <DetailBody className="gap-4">
        <Facts items={[
          { label: t('Utilisations'), value: String(skill.useCount) },
          ...(skill.state ? [{ label: t('État'), value: skill.state === 'active' ? t('actif') : skill.state }] : []),
          ...(skill.createdBy ? [{ label: t('Origine'), value: BY[skill.createdBy] ?? skill.createdBy }] : []),
          ...(skill.pinned ? [{ label: t('Épinglé'), value: t('oui : le curateur ne l’archive pas') }] : []),
        ]} />
        <section aria-label={t('Lié à')}>
          <h3 className="text-[15px] font-semibold">{t('Lié à')}</h3>
          {skill.related.length ? (
            <p className="mt-2 flex flex-wrap gap-1.5">
              {skill.related.map((r) => <Link key={r} {...skillLink(r)} className={linkClass}><Tag className="font-mono">{r}</Tag></Link>)}
            </p>
          ) : <p className="mt-1 text-sm text-ink-faint">{t('Aucun autre skill appris')}</p>}
        </section>
        <section aria-label={t('Souvenirs proches')}>
          <h3 className="text-[15px] font-semibold">{t('Souvenirs proches')}</h3>
          {near.length ? (
            <ul className="mt-2 space-y-1.5">
              {near.map((e) => (
                <li key={e.id}>
                  <Link {...entryLink(e.id)} className="block rounded-[10px] bg-paper px-3.5 py-2.5 text-sm transition-colors hover:bg-raised">{e.title || t('(sans titre)')}</Link>
                </li>
              ))}
            </ul>
          ) : <p className="mt-1 text-sm text-ink-faint">{t('Aucune entrée de mémoire proche')}</p>}
        </section>
      </DetailBody>
    </article>
  );
}
