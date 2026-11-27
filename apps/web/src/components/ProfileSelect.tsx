import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Picker } from './Menu';
import { cx } from './ui';
import { t } from '../i18n';

const TRIGGER = 'flex h-[34px] min-w-0 max-w-[14rem] items-center gap-1.5 rounded-lg border border-line bg-sheet px-2.5 font-mono text-sm text-ink transition-colors hover:border-ink-faint/60 aria-expanded:border-ink';

/** Agent (Hermes profile) picker of the per-agent pages: the instance's agents, plus the current one if unknown. */
export function ProfileSelect({ inst, value, onChange, className }: { inst: string; value: string; onChange: (p: string) => void; className?: string }) {
  const profiles = useQuery({ queryKey: ['profiles', inst], queryFn: () => api.profiles(inst).then((r) => r.profiles) });
  const names = profiles.data ?? ['default'];
  const options = names.includes(value) ? names : [...names, value];
  return (
    <div className="flex items-center gap-2 text-[13px] text-ink-faint" data-profile-select>
      <span aria-hidden>{t('Agent')}</span>
      <Picker
        title={t('Agent')} label={value} value={value} placement="below" triggerClass={cx(TRIGGER, className)}
        items={options.map((p) => ({ value: p, label: p, mono: true }))}
        onPick={(v) => { if (v && v !== value) onChange(v); }}
      />
    </div>
  );
}
