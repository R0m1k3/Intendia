// The face of an agent (OpenBot-like): its initials on its colour. The colour is chosen by the user (kept by
// Intendia per instance, GET/PUT /x/i/:inst/agent-looks), else picked from the name, so it is the same everywhere.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useCallback } from 'react';
import { api } from '../api';
import { cx } from '../components/ui';
import { t } from '../i18n';
import { AGENT_COLORS, agentColor, agentInitials } from '../sessions/agentTree';

const COLOR_NAMES = [t('Orange'), t('Bleu'), t('Vert'), t('Violet'), t('Framboise'), t('Turquoise'), t('Ocre'), t('Ardoise')];

/** The colour of each agent of an instance, and a way to change one. */
export function useAgentLooks(inst: string | null): { color: (name: string) => string; index: (name: string) => number | null; set: (name: string, index: number) => Promise<void> } {
  const qc = useQueryClient();
  const looks = useQuery({ queryKey: ['agent-looks', inst], queryFn: () => api.agentLooks(inst!).then((r) => r.looks), enabled: Boolean(inst), staleTime: 60_000, retry: false });
  const save = useMutation({
    meta: { fail: true },
    mutationFn: (next: Record<string, number>) => api.setAgentLooks(inst!, next),
    onSuccess: (r) => qc.setQueryData(['agent-looks', inst], r.looks),
  });
  const data = looks.data;
  const index = useCallback((name: string) => data?.[name] ?? null, [data]);
  const color = useCallback((name: string) => {
    const i = data?.[name];
    return i !== undefined ? AGENT_COLORS[i] ?? agentColor(name) : agentColor(name);
  }, [data]);
  const set = useCallback(async (name: string, i: number) => {
    // read again: another tab may have changed another agent's colour
    const current = await qc.fetchQuery({ queryKey: ['agent-looks', inst], queryFn: () => api.agentLooks(inst!).then((r) => r.looks), staleTime: 0 });
    await save.mutateAsync({ ...current, [name]: i });
  }, [qc, inst, save]);
  return { color, index, set };
}

/** The agent's face: its initials on its colour. */
export function AgentAvatar({ name, color, size = 28 }: { name: string; color?: string; size?: number }) {
  return (
    <span aria-hidden className="flex shrink-0 items-center justify-center font-semibold text-white"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.32), background: color ?? agentColor(name), fontSize: size <= 22 ? 10 : size >= 40 ? 16 : 12 }}>
      {agentInitials(name)}
    </span>
  );
}

/** Eight swatches; the chosen one checked. */
export function ColorChoice({ value, onPick, disabled }: { value: number | null; onPick: (index: number) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={t('Couleur de l’agent')} className="flex flex-wrap gap-1.5">
      {AGENT_COLORS.map((c, i) => (
        <button key={c} type="button" role="radio" aria-checked={value === i} aria-label={COLOR_NAMES[i]} title={COLOR_NAMES[i]} disabled={disabled}
          onClick={() => onPick(i)}
          className={cx('flex size-6 items-center justify-center rounded-full transition-transform hover:scale-110 disabled:opacity-50', value === i && 'ring-2 ring-ink ring-offset-2 ring-offset-sheet')}
          style={{ background: c }}>
          {value === i && <Check className="size-3.5 text-white" strokeWidth={2.5} />}
        </button>
      ))}
    </div>
  );
}
