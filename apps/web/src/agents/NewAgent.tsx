import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Agent } from '../api';
import { confirmClose, useDirtyGuard } from '../components/dirty';
import { Button, ErrorText, Field, Input } from '../components/ui';
import { t } from '../i18n';
import { Sheet } from '../kanban/Sheet';
import { AGENT_COLORS } from '../sessions/agentTree';
import { AgentModelPicker } from './AgentModel';
import { AgentAvatar, ColorChoice, useAgentLooks } from './look';

const SELECT = 'h-9 w-full rounded-lg border border-line bg-sheet px-2.5 text-sm transition-colors hover:border-ink-faint/60 focus:border-ink focus:outline-none';
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** The « Nouvel agent » sheet: opened from the Agents page, the sessions pane and the first launch. */
export function NewAgent({ inst, agents, onClose, onCreated }: {
  inst: string; agents: Agent[]; onClose: () => void; onCreated: (name: string, source: 'env' | 'db', modelError: string | null, connectError: string | null) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cloneFrom, setCloneFrom] = useState('');
  const [cloneAll, setCloneAll] = useState(false);
  const [noSkills, setNoSkills] = useState(false);
  const [soul, setSoul] = useState('');
  const [model, setModel] = useState<{ model: string; provider: string } | null>(null);
  const [color, setColor] = useState<number | null>(null);
  const looks = useAgentLooks(inst);
  const create = useMutation({
    mutationFn: () => api.createAgent(inst, {
      name: name.trim(), description: description.trim() || undefined, cloneFrom: cloneFrom || undefined,
      ...(cloneFrom && cloneAll ? { cloneAll: true } : {}), ...(noSkills && !cloneFrom ? { noSkills: true } : {}),
      ...(soul.trim() ? { soul } : {}), ...(model ?? {}),
    }),
    onSuccess: async (r) => {
      guard.release();
      // the face is Intendia's: a failure there never hides the agent's creation
      if (color !== null) await looks.set(r.name, color).catch(() => {});
      await qc.invalidateQueries({ queryKey: ['agents', inst] });
      await qc.invalidateQueries({ queryKey: ['profiles', inst] });
      onCreated(r.name, r.keySource, r.modelError, r.connectError ?? null);
    },
  });
  const guard = useDirtyGuard(Boolean(name || description || soul));
  const nameOk = NAME_RE.test(name.trim());
  return (
    <Sheet
      title={t('Nouvel agent')} width="md:w-[480px]" onClose={onClose} onSubmit={() => { if (nameOk) create.mutate(); }}
      footer={<>
        <Button type="button" onClick={() => void confirmClose(onClose)}>{t('Annuler')}</Button>
        <Button type="submit" variant="primary" disabled={!nameOk || create.isPending}>{create.isPending ? t('Création…') : t('Créer l’agent')}</Button>
      </>}
    >
          <Field label={t('Nom')} hint={t('Minuscules, chiffres, - et _ ; c’est le nom du profil Hermes')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={64} placeholder={t('recherche')} autoFocus
              aria-invalid={name !== '' && !nameOk} />
          </Field>
          <Field label={t('Couleur')} hint={t('Celle de son avatar dans Intendia')}>
            <div className="flex items-center gap-3">
              <AgentAvatar name={name.trim() || '?'} color={color !== null ? AGENT_COLORS[color] : undefined} size={32} />
              <ColorChoice value={color} onPick={setColor} />
            </div>
          </Field>
          <Field label={t('Description')} hint={t('Ce que fait cet agent ; la page Tâches s’en sert pour lui confier du travail')}>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={4}
              className="w-full rounded-lg border border-line bg-sheet px-3 py-2 text-sm transition-colors placeholder:text-ink-faint hover:border-ink-faint/60 focus:border-ink focus:outline-none"
              placeholder={t('Cherche et résume les sources sur un sujet.')} />
          </Field>
          <Field label={t('Partir de')} hint={t('Copie la configuration, les skills et le SOUL.md d’un agent existant')}>
            <select value={cloneFrom} onChange={(e) => setCloneFrom(e.target.value)} className={SELECT}>
              <option value="">{t('Aucun (agent vierge)')}</option>
              {agents.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
            {cloneFrom && (
              <label className="mt-2 flex items-start gap-2 text-sm">
                <input type="checkbox" checked={cloneAll} onChange={(e) => setCloneAll(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-ink)]" />
                <span>{t('Copie complète')}<span className="block text-xs text-ink-faint">{t('Aussi la mémoire et les sessions de {name}. Les comptes des messageries (bots) ne sont jamais copiés.', { name: cloneFrom })}</span></span>
              </label>
            )}
          </Field>
          {!cloneFrom && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={noSkills} onChange={(e) => setNoSkills(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-ink)]" />
              <span>{t('Sans les skills fournis')}<span className="block text-xs text-ink-faint">{t('L’agent démarre sans les skills livrés avec Hermes')}</span></span>
            </label>
          )}
          <Field label={t('Modèle')} hint={t('Celui de l’agent par défaut ; changeable ensuite')}>
            <AgentModelPicker inst={inst} profile={cloneFrom || 'default'} model={model?.model ?? null} provider={model?.provider ?? null}
              noneLabel={t('Celui d’Hermes')} title={t('Modèle du nouvel agent')} onPick={setModel} />
          </Field>
          <Field label="SOUL.md" hint={cloneFrom ? t('Laissé vide : celui de {name}', { name: cloneFrom }) : t('Personnalité de l’agent ; laissé vide : celui d’Hermes')}>
            <textarea value={soul} onChange={(e) => setSoul(e.target.value)} maxLength={65536} rows={5}
              className="w-full rounded-lg border border-line bg-sheet px-3 py-2 font-mono text-[13px] transition-colors placeholder:text-ink-faint hover:border-ink-faint/60 focus:border-ink focus:outline-none"
              placeholder={t('Tu es un assistant de recherche. Réponds brièvement, avec tes sources.')} />
          </Field>
          <ErrorText error={create.error} />
    </Sheet>
  );
}
