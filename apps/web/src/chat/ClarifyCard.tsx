import { useState, type ReactNode } from 'react';
import { Button, Input, Mark } from '../components/ui';
import type { Clarify } from './events';
import { AGENT_INDENT } from './Thread';

/**
 * A question of the agent (clarify tool). One button per choice (sends its label); with several choices allowed,
 * boxes then « Répondre » (sends a JSON array of the labels, as Hermes' own clients do). A free answer always.
 * `inline`: without the thread's indent (notifications); `footer`: under the answers.
 */
export function ClarifyCard({ clarify, onAnswer, busy, inline, footer, disabled }: {
  clarify: Clarify; onAnswer: (answer: string) => void; busy: boolean; inline?: boolean; footer?: ReactNode;
  /** no answer possible from here (shows the question only) */
  disabled?: boolean;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState('');
  const free = text.trim();
  return (
    <div className={inline ? undefined : AGENT_INDENT}>
      <div className="rounded-xl border border-accent/30 bg-accent-soft/40 p-4" data-clarify={clarify.requestId ?? ''}>
        <div className="flex items-center gap-2 text-sm font-medium">
          <Mark state="readonly" />
          Hermes vous pose une question
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm">{clarify.question}</p>
        {!disabled && clarify.choices.length > 0 && !clarify.multiSelect && (
          <div className="mt-4 flex flex-wrap gap-2">
            {clarify.choices.map((c) => (
              <Button key={c} disabled={busy} onClick={() => onAnswer(c)}>{c}</Button>
            ))}
          </div>
        )}
        {!disabled && clarify.choices.length > 0 && clarify.multiSelect && (
          <div className="mt-3 flex flex-col gap-1.5">
            {clarify.choices.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={picked.includes(c)} disabled={busy}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c] : p.filter((x) => x !== c)))} />
                {c}
              </label>
            ))}
            <div>
              <Button variant="primary" className="mt-2" disabled={busy || picked.length === 0}
                onClick={() => onAnswer(JSON.stringify(clarify.choices.filter((c) => picked.includes(c))))}>
                Répondre
              </Button>
            </div>
          </div>
        )}
        {!disabled && (
          <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (free) onAnswer(free); }}>
            <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={16384} disabled={busy}
              placeholder={clarify.choices.length ? 'Ou répondre autrement…' : 'Votre réponse…'} aria-label="Votre réponse" />
            <Button type="submit" variant={clarify.choices.length ? 'secondary' : 'primary'} disabled={busy || !free}>Répondre</Button>
          </form>
        )}
        {footer}
      </div>
    </div>
  );
}
