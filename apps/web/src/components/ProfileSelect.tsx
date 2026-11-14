import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { cx } from './ui';
import { t } from '../i18n';

export const PROFILE_SELECT = 'h-[34px] rounded-lg border border-line bg-sheet px-2.5 font-mono text-sm text-ink transition-colors hover:border-ink-faint/60 focus:border-ink focus:outline-none';

/** Agent (Hermes profile) picker of the per-profile pages: the instance's profiles, plus the current one if unknown. */
export function ProfileSelect({ inst, value, onChange, className }: { inst: string; value: string; onChange: (p: string) => void; className?: string }) {
  const profiles = useQuery({ queryKey: ['profiles', inst], queryFn: () => api.profiles(inst).then((r) => r.profiles) });
  const names = profiles.data ?? ['default'];
  const options = names.includes(value) ? names : [...names, value];
  return (
    <label className="flex items-center gap-2 text-[13px] text-ink-faint">
      {t('Profil')}
      <select className={cx(PROFILE_SELECT, className)} value={value} aria-label={t('Profil')} onChange={(e) => onChange(e.target.value)}>
        {options.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
    </label>
  );
}
