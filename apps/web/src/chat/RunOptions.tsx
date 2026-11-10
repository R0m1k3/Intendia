import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api, type Effort } from '../api';
import { cx } from '../components/ui';
import { EFFORTS, effortLabel, shortModel } from './format';
import { modelNames } from './models';

interface Item { value: string | null; label: string; hint?: string; mono?: boolean }

/**
 * A text button opening a list above it. The list is portalled to <body>: inside the page, `position: fixed`
 * would be relative to the animated `.enter` container (it has a transform), not to the screen.
 */
function Picker({ label, title, items, value, disabled, onPick }: {
  label: ReactNode; title: string; items: Item[]; value: string | null; disabled?: boolean; onPick: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number; maxH: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 16);
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), bottom: window.innerHeight - r.top + 6, maxH: Math.max(160, r.top - 16) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    list.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
    };
  }, [open, pos]);

  return (
    <>
      <button
        ref={btn} type="button" disabled={disabled} title={title} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-7 max-w-[14rem] min-w-0 items-center gap-1 rounded-md px-2 text-xs text-ink-soft transition-colors hover:bg-raised hover:text-ink disabled:opacity-50 aria-expanded:bg-raised"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3 shrink-0" strokeWidth={1.75} />
      </button>
      {open && pos && createPortal(
        <div
          ref={list} role="menu" aria-label={title}
          style={{ left: pos.left, bottom: pos.bottom, maxHeight: pos.maxH }}
          className="fixed z-50 w-[min(20rem,calc(100vw-1rem))] overflow-y-auto rounded-xl border border-line bg-sheet p-1 shadow-[var(--shadow-card)]"
        >
          {items.map((it) => (
            <button
              key={it.value ?? 'auto'} type="button" role="menuitemradio" aria-checked={it.value === value}
              onClick={() => { setOpen(false); if (it.value !== value) onPick(it.value); }}
              className="flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-raised focus:bg-raised focus:outline-none"
            >
              <Check className={cx('mt-0.5 size-3.5 shrink-0 text-accent', it.value !== value && 'invisible')} strokeWidth={2} />
              <span className="min-w-0">
                <span className={cx('block truncate', it.mono && 'font-mono text-[13px]')}>{it.label}</span>
                {it.hint && <span className="block text-xs text-ink-faint">{it.hint}</span>}
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * Model and reasoning effort of the session's next messages. "Auto" = what the Hermes agent is set to.
 * Changing the model of a session that already ran asks first: the new model reads the whole
 * conversation again without cache, once.
 */
export function RunOptions({ inst, profile, model, effort, hasRuns, disabled, onChange }: {
  inst: string; profile: string; model: string | null; effort: Effort | null; hasRuns: boolean; disabled?: boolean;
  onChange: (patch: { model?: string | null; effort?: Effort | null }) => void;
}) {
  const options = useQuery({ queryKey: ['models', inst, profile], queryFn: () => api.models(inst, profile), enabled: Boolean(inst), retry: false, staleTime: 60_000 });
  const fallback = options.data?.model ?? null;
  const names = modelNames(options.data);
  if (model && !names.includes(model)) names.unshift(model);
  const modelItems: Item[] = [
    { value: null, label: fallback ? `Auto · ${shortModel(fallback)}` : 'Auto', hint: 'Le modèle réglé pour l’agent Hermes' },
    ...names.map((n) => ({ value: n, label: n, mono: true })),
  ];
  const effortItems: Item[] = [
    { value: null, label: 'Auto', hint: 'Le réglage de l’agent Hermes' },
    ...EFFORTS.map((e) => ({ value: e.value, label: e.label, hint: e.hint })),
  ];
  const pickModel = (v: string | null) => {
    if (hasRuns && !confirm('Changer le modèle de cette session ? Le nouveau modèle relira toute la conversation sans cache au prochain message, une fois : ce message coûtera plus cher.')) return;
    onChange({ model: v });
  };
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <Picker
        title="Modèle des prochains messages" items={modelItems} value={model} disabled={disabled} onPick={pickModel}
        label={model ? <span className="font-mono">{shortModel(model)}</span> : modelItems[0]!.label}
      />
      <Picker
        title="Effort de raisonnement" items={effortItems} value={effort} disabled={disabled}
        onPick={(v) => onChange({ effort: v as Effort | null })}
        label={<><span className="hidden sm:inline">Effort : </span><span className="sm:hidden">Effort </span>{effortLabel(effort)}</>}
      />
    </div>
  );
}
