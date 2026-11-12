import { ArrowUp, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { api, type GitStatus } from '../api';
import { Button, ErrorText } from '../components/ui';

/**
 * Commit message (typed, or proposed by Hermes' auxiliary model), « Valider » with « puis pousser », « Pousser ».
 * Committing needs staged files: Intendia never lets Hermes stage everything by itself.
 */
export function CommitBox({ slug, repo, status, canCommit, canPush, canMessage, onDone }: {
  slug: string; repo: string; status: GitStatus; canCommit: boolean; canPush: boolean; canMessage: boolean;
  /** After an action: refresh, and a note to show (or null). */
  onDone: (note: string | null) => void;
}) {
  const [message, setMessage] = useState('');
  const [push, setPush] = useState(false);
  const [busy, setBusy] = useState<'message' | 'commit' | 'push' | null>(null);
  const [proposed, setProposed] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const staged = status.files.some((f) => f.staged) || status.counts.staged > 0;

  const run = async (what: 'message' | 'commit' | 'push', fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const propose = () => run('message', async () => {
    const { message: m } = await api.gitMessage(slug, repo, proposed ?? undefined);
    setMessage(m);
    setProposed(m);
  });
  const commit = () => run('commit', async () => {
    const res = await api.gitCommit(slug, repo, message, push);
    setMessage('');
    setProposed(null);
    onDone(res.pushError ? `Commit fait, mais l’envoi a échoué : ${res.pushError}` : push ? 'Commit fait et envoyé' : 'Commit fait');
  });
  const doPush = () => run('push', async () => {
    await api.gitPush(slug, repo);
    onDone('Branche envoyée');
  });

  return (
    <div data-commit-box className="space-y-2.5 border-t border-line/70 px-4 py-3">
      {canCommit && (
        <>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={5000} aria-label="Message de commit"
            placeholder={staged ? 'Message de commit' : 'Indexez des fichiers pour valider'} disabled={!staged || busy !== null}
            className="w-full resize-y rounded-[10px] border border-line bg-sheet px-3 py-2.5 font-mono text-[13px] transition-colors hover:border-ink-faint/60 focus:border-ink focus:outline-none disabled:opacity-60" />
          <div className="flex flex-wrap items-center gap-2">
            {canMessage && (
              <Button onClick={() => void propose()} disabled={!staged || busy !== null} title="Message proposé par le modèle auxiliaire d’Hermes, d’après le diff indexé">
                <Sparkles className="size-4" strokeWidth={1.5} />{busy === 'message' ? 'Rédaction…' : proposed ? 'Autre proposition' : 'Proposer un message'}
              </Button>
            )}
            <span className="flex-1" />
            {canPush && (
              <label className="flex items-center gap-1.5 text-[13px] text-ink-soft">
                <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} className="size-3.5 accent-[var(--color-ink)]" />puis pousser
              </label>
            )}
            <Button variant="primary" onClick={() => void commit()} disabled={!staged || !message.trim() || busy !== null}>
              {busy === 'commit' ? 'Validation…' : 'Valider'}
            </Button>
          </div>
        </>
      )}
      {canPush && !status.detached && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12.5px] text-ink-faint">
            {status.ahead > 0 ? `${status.ahead} commit${status.ahead > 1 ? 's' : ''} à envoyer` : 'Envoyer la branche vers le dépôt distant'}
          </span>
          <Button onClick={() => void doPush()} disabled={busy !== null}>
            <ArrowUp className="size-4" strokeWidth={1.5} />{busy === 'push' ? 'Envoi…' : status.ahead > 0 ? `Pousser (${status.ahead})` : 'Pousser'}
          </Button>
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}
