import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useCurrentInstance } from '../instance/current';
import { NewWorkspace } from '../components/NewWorkspace';
import { DetailBody, DetailHeader, ListItemBody, ListLink, ListPane, SplitView, listItemClass } from '../components/Panes';
import { pickSelected } from '../components/selection';
import { Button, ErrorText, Tag, SkeletonList } from '../components/ui';
import { WorkspaceDetail } from '../workspaces/WorkspaceDetail';
import { t } from '../i18n';

/**
 * /w and /w/$slug: the workspaces of the current instance (a folder shared with the agent, its instructions and its
 * sessions) in a list, the one in the address (else the first) beside it. No workspace yet: the creation form.
 */
export function WorkspacesPage() {
  const { slug } = useParams({ strict: false }) as { slug?: string };
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces });
  const { id: inst, instance, instances } = useCurrentInstance();
  const [adding, setAdding] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies(slug): the trigger, not read by the effect: it runs again when this changes
  useEffect(() => setAdding(false), [slug]);
  const list = (workspaces.data?.workspaces ?? []).filter((w) => w.instanceId === inst);
  const empty = workspaces.isSuccess && inst !== null && list.length === 0;
  // a workspace of another instance named in the address is still shown (its own link), not replaced by the first
  const shown = slug ?? pickSelected(list, undefined, (w) => w.slug)?.slug ?? null;
  const creating = adding || empty;
  const root = instance?.files?.workspaceRoot;

  const pane = (
    <ListPane
      title={t('Dossiers')}
      action={!empty && (
        <Button className="w-[34px] px-0" aria-label={t('Nouveau dossier')} title={t('Nouveau dossier')} onClick={() => setAdding(true)}>
          <Plus className="size-4" strokeWidth={1.5} />
        </Button>
      )}
    >
      <ErrorText error={workspaces.error} onRetry={() => void workspaces.refetch()} />
      {creating && (
        <button type="button" className={listItemClass(true)} onClick={() => setAdding(true)}>
          <ListItemBody title={t('Nouveau dossier')} sub={t('Un dossier partagé avec l’agent')} />
        </button>
      )}
      <ul className="flex flex-col gap-0.5" aria-label={t('Dossiers')}>
        {list.map((w) => {
          const on = !creating && w.slug === shown;
          return (
            <li key={w.slug} data-workspace={w.slug}>
              <ListLink link={{ to: '/w/$slug', params: { slug: w.slug } }} selected={on}>
                <ListItemBody
                  title={w.name}
                  meta={w.sessionCount !== undefined ? <span title={t('Sessions en cours')}>{w.sessionCount}</span> : undefined}
                  sub={<span title={root ? `${root}/${w.slug}` : undefined}>{instance ? t('Agent {profile} · {instance}', { profile: w.profile ?? 'default', instance: instance.label }) : t('Agent {profile}', { profile: w.profile ?? 'default' })}</span>}
                  tag={<Tag className={on ? 'bg-sheet' : undefined}>{w.slug}</Tag>}
                />
              </ListLink>
            </li>
          );
        })}
      </ul>
      {workspaces.isPending && <SkeletonList rows={6} />}
    </ListPane>
  );

  return (
    <SplitView label={t('Dossiers')} selected={Boolean(slug) || adding} list={pane}>
      {creating ? (
        <>
          <DetailHeader
            title={t('Nouveau dossier')}
            sub={instance && instances.length > 1 ? t('Un dossier partagé avec l’agent, ses consignes et ses sessions, sur {label}', { label: instance.label }) : t('Un dossier partagé avec l’agent, ses consignes et ses sessions')}
            back={adding ? { to: '/w' } : undefined}
          />
          <DetailBody>
            <NewWorkspace onCancel={empty ? undefined : () => setAdding(false)} />
          </DetailBody>
        </>
      ) : shown ? (
        <WorkspaceDetail key={shown} slug={shown} instance={instance ?? undefined} back={Boolean(slug)} />
      ) : null}
    </SplitView>
  );
}
