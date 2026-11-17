import { t } from '../i18n';

/** Managed installation (Nix, `.managed` marker): Hermes ignores the config writes of its dashboard. */
export function ManagedNotice({ managed }: { managed: boolean | null | undefined }) {
  if (managed !== true) return null;
  return (
    <p className="rounded-[10px] bg-warn-soft px-3.5 py-2.5 text-[13.5px] text-warn" data-managed>
      {t('Installation gérée par un gestionnaire de paquets : Hermes ignore les changements faits ici. Modifiez sa configuration là où il est déclaré.')}
    </p>
  );
}
