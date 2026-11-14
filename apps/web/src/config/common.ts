import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api';
import { t } from '../i18n';

/** Shared by the tabs of the Configuration page. */

export interface TabProps {
  inst: string;
  profile: string;
  /** Has the config module this operation (route found by the compatibility test)? */
  can: (op: string) => boolean;
  /** A config write went through: offer the gateway restart. */
  onSaved: (restart: boolean) => void;
}

export const SELECT = 'h-9 rounded-lg border border-line bg-sheet px-2.5 text-sm transition-colors hover:border-ink-faint/60 focus:border-ink focus:outline-none';
export const ICON = 'size-4';

export const configKey = (inst: string, profile: string, what: string) => ['config', inst, profile, what] as const;

/** After a write: every read of this (instance, profile) is stale (the file version changed). */
export function useInvalidateConfig(inst: string, profile: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['config', inst, profile] });
}

export function errorCode(err: unknown): string | undefined {
  return err instanceof ApiError && err.data && typeof err.data === 'object' && 'code' in err.data ? String((err.data as { code: unknown }).code) : undefined;
}

export function errorData(err: unknown): Record<string, unknown> {
  return err instanceof ApiError && err.data && typeof err.data === 'object' ? (err.data as Record<string, unknown>) : {};
}

export const CHANGED_TEXT = t("La configuration a changé dans Hermes depuis l'affichage.");
