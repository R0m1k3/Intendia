// The page published for the layout (tab title, « / », palette) with its actions, and the palette's
// « Changer de modèle », which opens the composer's model menu.
import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState, type RefObject } from 'react';
import type { ComposerHandle } from '../../chat/Composer';
import type { CommandName } from '../../chat/commands';
import { EMBEDDED } from '../../chat/embed';
import { chatModelsQuery, modelPickerDisabled } from '../../chat/RunOptions';
import { useActivePage, type ActivePage } from '../../components/activePage';
import type { PaletteItem } from '../../components/palette';
import { t } from '../../i18n';

export function usePalettePage({ inst, agentProfile, found, optionsDisabled, leading, title, running, goalOk, handlers: current, composer }: {
  inst: string | undefined;
  agentProfile: string;
  /** the session was read */
  found: boolean;
  /** the run options cannot change now (`disabled` of RunOptions) */
  optionsDisabled: boolean;
  /** the page is « the session opened last » (not a column in the background of the Chat page) */
  leading: boolean;
  title: string;
  running: boolean;
  goalOk: boolean;
  handlers: {
    stop: () => Promise<void>;
    onCommand: (name: CommandName, arg: string) => Promise<boolean>;
    renameSession: () => Promise<void>;
    copyLink: () => void;
    openFiles: () => void;
  };
  composer: RefObject<ComposerHandle | null>;
}) {
  // the palette's « Changer de modèle »: the same menu as the composer's, under the same conditions
  const [modelOpen, setModelOpen] = useState(false);
  const models = useQuery({ ...chatModelsQuery(inst ?? '', agentProfile), enabled: Boolean(inst && found) });
  const modelOk = Boolean(inst && found) && !modelPickerDisabled({ disabled: optionsDisabled, loading: models.isLoading });
  // the page published for the layout (tab title, « / », palette): its handlers read this, rewritten on each render
  const handlers = useRef(current);
  handlers.current = current;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `composer` (a ref) from the page, stable: same dependencies as when this code was in pages/Session.tsx
  const page = useMemo<ActivePage | null>(() => {
    if (!leading || EMBEDDED) return null;
    const actions: PaletteItem[] = [
      ...(running ? [{ id: 'o:stop', label: t('Arrêter le travail'), run: () => void handlers.current.stop() }] : []),
      ...(goalOk ? [{ id: 'o:goal', label: t('Fixer un objectif'), run: () => void handlers.current.onCommand('goal', '') }] : []),
      ...(modelOk ? [{ id: 'o:model', label: t('Changer de modèle'), run: () => setModelOpen(true) }] : []),
      { id: 'o:files', label: t('Fichiers de la session'), run: () => handlers.current.openFiles() },
      { id: 'o:usage', label: t('Contexte et forfait utilisés'), run: () => void handlers.current.onCommand('usage', '') },
      { id: 'o:title', label: t('Renommer la session'), run: () => void handlers.current.renameSession() },
      { id: 'o:link', label: t('Copier le lien de la session'), run: () => handlers.current.copyLink() },
    ];
    return { title, focusComposer: () => composer.current?.focus(), actions };
  }, [leading, title, running, goalOk, modelOk]);
  useActivePage(page);
  return { modelOpen, setModelOpen };
}
