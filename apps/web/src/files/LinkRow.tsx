import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Copy, Globe, Lock, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, type ShareLink } from '../api';
import { ask } from '../components/Dialog';
import { Button, copyText, cx, ErrorText, Mark, timeAgo } from '../components/ui';
import { absoluteUrl } from './Preview';

/** One share link with its actions (copy, public until a date, private, revoke): tab « Liens partagés ». */
const DAY = 86_400_000;

function state(l: ShareLink): { label: string; mark: 'full' | 'unavailable' | null; note?: string } {
  if (l.revoked) return { label: 'Révoqué', mark: 'unavailable' };
  if (l.publicUntil === null) return { label: 'Privé', mark: null };
  if (l.publicUntil <= Date.now()) return { label: 'Expiré', mark: null, note: 'public jusqu’au ' + fmt(l.publicUntil) };
  return { label: 'Public', mark: 'full', note: 'jusqu’au ' + fmt(l.publicUntil) };
}

const fmt = (ms: number) => new Date(ms).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

function PublicChoice({ onPick, busy }: { onPick: (until: number) => void; busy: boolean }) {
  const [date, setDate] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {[1, 7, 30].map((d) => (
        <Button key={d} variant="secondary" className="h-8 px-2.5 text-[13px]" disabled={busy} onClick={() => onPick(Date.now() + d * DAY)}>
          {d === 1 ? '1 jour' : `${d} jours`}
        </Button>
      ))}
      <input
        type="date"
        value={date}
        min={new Date(Date.now() + DAY).toISOString().slice(0, 10)}
        max={new Date(Date.now() + 365 * DAY).toISOString().slice(0, 10)}
        onChange={(e) => setDate(e.target.value)}
        className="h-8 rounded-lg border border-line bg-sheet px-2 text-[13px]"
        aria-label="Public jusqu’à cette date"
      />
      <Button variant="secondary" className="h-8 px-2.5 text-[13px]" disabled={busy || !date} onClick={() => onPick(new Date(`${date}T23:59:00`).getTime())}>
        OK
      </Button>
    </div>
  );
}

export function LinkRow({ l }: { l: ShareLink }) {
  const qc = useQueryClient();
  const [choosing, setChoosing] = useState(false);
  const [copied, setCopied] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['links'] });
  const setPublic = useMutation({ mutationFn: (until: number | null) => api.setLinkPublic(l.token, until), onSuccess: () => { setChoosing(false); return refresh(); } });
  const revoke = useMutation({ mutationFn: () => api.revokeLink(l.token), onSuccess: refresh });
  const s = state(l);
  const name = l.path.slice(l.path.lastIndexOf('/') + 1);
  const inWs = l.workspace ? l.path.slice(l.workspace.length + 1) : null;
  const copy = async () => {
    await copyText(absoluteUrl(l.url), 'Lien');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <li className={cx('px-5 py-3.5', (!l.exists || l.revoked) && 'text-ink-faint')}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <Mark state={s.mark} className={l.revoked ? 'opacity-70' : undefined} />
            {l.workspace && inWs && l.exists ? (
              <Link to="/w/$slug/fichiers" params={{ slug: l.workspace }} search={{ path: inWs.includes('/') ? inWs.slice(0, inWs.lastIndexOf('/')) : '', f: inWs }}
                className="truncate text-sm font-medium hover:underline">{name}</Link>
            ) : (
              <span className="truncate text-sm font-medium">{name}</span>
            )}
            {!l.exists && <span className="shrink-0 rounded-md bg-raised px-1.5 py-0.5 text-[11px]">introuvable</span>}
          </div>
          <p className="mt-0.5 truncate pl-5 font-mono text-[11px] text-ink-faint" title={l.agentPath}>
            {l.workspace ?? 'hors workspace'} · {inWs ?? l.path} · créé {timeAgo(l.createdAt)}
          </p>
        </div>
        <div className="w-40 shrink-0 text-[13px]">
          <span className={cx(s.mark === 'full' && 'text-ok')}>{s.label}</span>
          {s.note && <span className="block text-[11px] text-ink-faint">{s.note}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!l.revoked && (
            <>
              <Button variant="ghost" className="h-8 px-2.5" onClick={() => void copy()} title={absoluteUrl(l.url)}>
                <Copy className="size-4" strokeWidth={1.5} /><span className="text-[13px]">{copied ? 'Copié' : 'Copier'}</span>
              </Button>
              {l.publicUntil !== null && l.publicUntil > Date.now() ? (
                <Button variant="ghost" className="h-8 px-2.5" onClick={() => setPublic.mutate(null)} disabled={setPublic.isPending}>
                  <Lock className="size-4" strokeWidth={1.5} /><span className="text-[13px]">Rendre privé</span>
                </Button>
              ) : (
                <Button variant="ghost" className="h-8 px-2.5" onClick={() => setChoosing(!choosing)} aria-expanded={choosing}>
                  <Globe className="size-4" strokeWidth={1.5} /><span className="text-[13px]">Rendre public</span>
                </Button>
              )}
              <Button variant="ghost" className="size-8 px-0 hover:text-bad" title="Révoquer" aria-label="Révoquer"
                onClick={async () => { if (await ask({ title: `Révoquer le lien vers ${name} ?`, message: 'Il ne s’ouvrira plus, pour personne.', confirmLabel: 'Révoquer', danger: true })) revoke.mutate(); }}>
                <Trash2 className="size-4" strokeWidth={1.5} />
              </Button>
            </>
          )}
        </div>
      </div>
      {choosing && (
        <div className="mt-3 pl-5">
          <p className="mb-2 text-xs text-ink-soft">Public : toute personne qui a le lien peut ouvrir le fichier, sans se connecter, jusqu’à :</p>
          <PublicChoice onPick={(u) => setPublic.mutate(u)} busy={setPublic.isPending} />
        </div>
      )}
      <div className="pl-5 empty:hidden"><ErrorText error={setPublic.error ?? revoke.error} /></div>
    </li>
  );
}
