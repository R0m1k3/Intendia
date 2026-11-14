import { ModuleNotice, useModuleAvailability, type OpRef, type OptionalOp } from './ModuleNotice';
import { t } from '../i18n';

const REQUIRED: OpRef[] = [['chat', 'createRun'], ['chat', 'runStatus'], ['chat', 'runEvents'], ['sessions', 'messages']];
const OPTIONAL: OptionalOp[] = [['chat', 'stopRun', t('Arrêter un run')], ['chat', 'approval', t('Répondre aux approbations')]];

/** Chat availability from the operations phase 2 uses: a missing `steer` must not warn, a missing `createRun` must block. */
export function useChatAvailability(instanceId: string | undefined) {
  const { available, missing, reasons, link, has } = useModuleAvailability(instanceId, 'chat', REQUIRED, OPTIONAL);
  return { available, missing, reasons, link, has };
}

export function ChatNotice({ instanceId }: { instanceId: string | undefined }) {
  return <ModuleNotice instanceId={instanceId} module="chat" title={t('Le chat')} required={REQUIRED} optional={OPTIONAL} />;
}
