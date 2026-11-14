import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { KeyRound, Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { api, type VaultItem, type VaultKind } from '../api';
import { AccessForm } from '../access/AccessForm';
import { KIND_GROUP, KIND_LABEL } from '../access/fields';
import { compatPoll } from '../components/availability';
import { ask } from '../components/Dialog';
import { DetailBody, DetailHeader, Empty, Facts, ListItemBody, ListLabel, ListLink, ListPane, SplitView } from '../components/Panes';
import { ProfileSelect } from '../components/ProfileSelect';
import { Button, ErrorText, host, Tag } from '../components/ui';
import { locale, plural, t } from '../i18n';

export const ACCESS_KINDS = ['login', 'payment', 'address'] as const;
/** The address never holds a secret: only the item shown, or a form to open with a site. */
export interface AccessSearch { profile?: string; item?: string; add?: VaultKind; origin?: string; proposed?: '1'; replace?: '1' }

const ID_TYPE: Record<string, string> = { email: t('E-mail'), username: t('Nom d’utilisateur'), phone: t('Téléphone') };

export function AccessPage() {
  const { inst } = useParams({ strict: false }) as { inst: string };
  const search = useSearch({ strict: false }) as AccessSearch;
  const profile = search.profile ?? 'default';
  return <AccessView key={`${inst}:${profile}`} inst={inst} profile={profile} search={search} />;
}

/** `socket.vault` of the instance's compatibility report: true, false, or undefined (not checked yet). */
export function useVaultAvailable(inst: string): boolean | undefined {
  const compat = useQuery({
    queryKey: ['compat'], queryFn: api.compat,
    refetchInterval: (q) => compatPoll(q.state.data?.reports.find((r) => r.instanceId === inst)),
  });
  const report = compat.data?.reports.find((r) => r.instanceId === inst);
  return report?.socket?.vault;
}

function AccessView({ inst, profile, search }: { inst: string; profile: string; search: AccessSearch }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const available = useVaultAvailable(inst);
  const q = useQuery({ queryKey: ['vault', inst, profile], queryFn: () => api.vault(inst, profile), enabled: available === true, retry: false });
  const [notice, setNotice] = useState<{ text: string; oldId?: string } | null>(null);
  const p = profile === 'default' ? undefined : profile;
  const to = (s: Omit<AccessSearch, 'profile'>) => ({ to: '/i/$inst/acces' as const, params: { inst }, search: { profile: p, ...s } });
  const go = (s: Omit<AccessSearch, 'profile'>, replace = false) => void navigate({ ...to(s), replace });
  const items = q.data?.items ?? [];
  const item = search.item ? items.find((i) => i.id === search.item) ?? null : null;
  // in the address, so the back link (and the browser's) leaves the form
  const replacing = search.replace === '1' ? item : null;
  const adding = Boolean(search.add) && !replacing;

  const remove = async (it: VaultItem) => {
    const where = it.origin ? host(it.origin) : t('ce site');
    if (!(await ask({ title: t('Supprimer l’accès {label} ?', { label: it.label }), message: t('L’agent ne pourra plus l’utiliser sur {where}.', { where }), confirmLabel: t('Supprimer'), danger: true }))) return;
    try {
      await api.vaultRemove(inst, profile, it.id);
      setNotice(null);
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : t('Suppression impossible') });
    }
    void qc.invalidateQueries({ queryKey: ['vault', inst, profile] });
    go({}, true);
  };

  const list = (
    <ListPane
      title={t('Accès')}
      action={
        <>
          <ProfileSelect inst={inst} value={profile} onChange={(x) => void navigate({ to: '/i/$inst/acces', params: { inst }, search: { profile: x === 'default' ? undefined : x } })} />
          {available === true && (
            <Button variant="secondary" className="px-2.5" aria-label={t('Ajouter un accès')} title={t('Ajouter un accès')} onClick={() => go({ add: 'login' })}>
              <Plus className="size-4" strokeWidth={1.75} />
            </Button>
          )}
        </>
      }
      footer={available === true ? (
        <p className="sticky bottom-0 border-t border-line/70 bg-sheet px-4 py-3 text-xs text-ink-faint">
          {t('Chaque profil a son propre coffre : l’agent d’un autre profil ne voit pas ces accès.')}
        </p>
      ) : undefined}
    >
      {available === true && q.isPending && <p className="px-3.5 py-6 text-sm text-ink-faint">{t('Chargement…')}</p>}
      {q.error && (
        <div className="mx-1 mt-3 flex flex-col items-start gap-2 rounded-[10px] bg-bad-soft px-3.5 py-3 text-[13px] text-bad" data-list-error>
          <ErrorText error={q.error} />
          <Button variant="secondary" onClick={() => void q.refetch()}>{t('Réessayer')}</Button>
        </div>
      )}
      {q.data && items.length === 0 && <p className="px-3.5 py-6 text-sm text-ink-faint">{t('Aucun accès enregistré pour ce profil.')}</p>}
      {ACCESS_KINDS.map((k) => {
        const group = items.filter((i) => i.kind === k);
        if (!group.length) return null;
        return (
          <div key={k} className="flex flex-col gap-0.5" data-group={k}>
            <ListLabel>{KIND_GROUP[k]}</ListLabel>
            {group.map((i) => (
              <ListLink key={i.id} link={to({ item: i.id })} selected={search.item === i.id}>
                <ListItemBody
                  title={i.label}
                  meta={i.origin ? host(i.origin) : undefined}
                  sub={i.identifier ?? KIND_LABEL[i.kind]}
                  tag={i.hasOtp ? <Tag title={t('Codes 2FA saisis par l’agent')}>2FA</Tag> : undefined}
                />
              </ListLink>
            ))}
          </div>
        );
      })}
      {q.data && q.data.external > 0 && (
        <p className="mx-1 mt-3 rounded-[10px] bg-paper px-3.5 py-2.5 text-[13px] text-ink-soft" data-external>
          {plural(q.data.external, '{n} accès vient d’un gestionnaire externe (1Password / Bitwarden), non géré ici.', '{n} accès viennent d’un gestionnaire externe (1Password / Bitwarden), non gérés ici.')}
        </p>
      )}
    </ListPane>
  );

  const banner = notice && (
    <div className="mx-4 mt-5 flex flex-wrap items-center gap-3 rounded-[10px] bg-warn-soft px-3.5 py-3 text-[13.5px] text-warn md:mx-6" role="status" data-notice>
      <span className="flex-1">{notice.text}</span>
      {notice.oldId && (
        <Button variant="danger" onClick={() => {
          const old = items.find((i) => i.id === notice.oldId);
          if (old) void remove(old); else setNotice(null);
        }}>{t('Supprimer l’ancien')}</Button>
      )}
    </div>
  );

  let detail;
  if (available === false) {
    detail = <Empty icon={<KeyRound strokeWidth={1.5} />} title={t('Coffre indisponible')}>{t('Cette version d’Hermes ne permet pas de gérer le coffre.')}</Empty>;
  } else if (available === undefined) {
    detail = (
      <div className="px-4 pt-5 md:px-6">
        <div className="rounded-[10px] bg-raised px-3.5 py-3 text-[13.5px] text-ink-soft" data-compat-pending>
          {t('Vérification de cette instance en cours')} <Link to="/etat" className="font-medium text-accent-ink hover:text-ink">{t('Page État')}</Link>
        </div>
      </div>
    );
  } else if (replacing || adding) {
    detail = (
      <>
        <DetailHeader title={replacing ? t('Remplacer {label}', { label: replacing.label }) : t('Ajouter un accès')} back={to({})} />
        <DetailBody>
          <AccessForm
            key={replacing?.id ?? `add:${search.add}:${search.origin ?? ''}`}
            inst={inst} profile={profile} replacing={replacing ?? undefined}
            initial={{ kind: search.add, origin: search.origin }} proposed={!replacing && search.proposed === '1'}
            onDone={(res) => {
              setNotice(res.oldKept ? { text: t('Nouvel accès enregistré ; l’ancien n’a pas pu être supprimé.'), oldId: replacing?.id } : null);
              go({ item: res.id }, true);
            }}
            onCancel={() => go(item ? { item: item.id } : {}, true)}
          />
        </DetailBody>
      </>
    );
  } else if (item) {
    detail = (
      <>
        <DetailHeader
          title={item.label} meta={item.origin ? host(item.origin) : undefined} back={to({})}
          actions={
            <>
              <Button variant="secondary" onClick={() => go({ item: item.id, replace: '1' })}>{t('Remplacer')}</Button>
              <Button variant="danger" onClick={() => void remove(item)}>{t('Supprimer')}</Button>
            </>
          }
        />
        <DetailBody>
          <Facts items={[
            { label: t('Type'), value: KIND_LABEL[item.kind] },
            { label: t('Site'), value: item.origin ?? '—', mono: true },
            ...(item.kind === 'login' ? [
              { label: ID_TYPE[item.identifierType ?? ''] ?? t('Identifiant|coffre'), value: item.identifier ?? '—', mono: true },
              { label: t('Double authentification'), value: item.hasOtp ? t('Codes saisis par l’agent') : t('Non enregistrée') },
            ] : []),
            { label: t('Ajouté'), value: item.createdAt ? new Date(item.createdAt).toLocaleString(locale()) : '—' },
          ]} />
          <p className="text-[13px] text-ink-faint">
            {item.kind === 'login'
              ? t('Le mot de passe est chiffré dans le coffre d’Hermes ; personne ne peut le relire, l’agent le remplit sans le voir. Pour le changer, utilisez Remplacer.')
              : t('Les valeurs sont chiffrées dans le coffre d’Hermes et ne sont remplies que sur ce site. Pour les changer, utilisez Remplacer.')}
          </p>
        </DetailBody>
      </>
    );
  } else if (search.item && q.data) {
    detail = <Empty icon={<KeyRound strokeWidth={1.5} />} title={t('Accès introuvable')}>{t('Il a été supprimé ou remplacé depuis : choisissez-le de nouveau dans la liste.')}</Empty>;
  } else {
    detail = (
      <Empty
        icon={<ShieldCheck strokeWidth={1.5} />} title={t('Les accès de l’agent')}
        actions={<Button variant="primary" onClick={() => go({ add: 'login' })}><Plus className="size-4" strokeWidth={1.75} />{t('Ajouter un accès')}</Button>}
      >
        {t('Identifiants, cartes et adresses que l’agent peut remplir sur les sites, sans jamais voir les mots de passe ni les numéros. Ils sont chiffrés dans le coffre d’Hermes.')}
      </Empty>
    );
  }

  return (
    <SplitView label={t('Accès')} list={list} selected={Boolean(search.item || search.add)}>
      {banner}
      {detail}
    </SplitView>
  );
}
