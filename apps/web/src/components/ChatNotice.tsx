import { ModuleNotice, useModuleAvailability, type OpRef, type OptionalOp } from './ModuleNotice';

const REQUIRED: OpRef[] = [['chat', 'createRun'], ['chat', 'runStatus'], ['chat', 'runEvents'], ['sessions', 'messages']];
const OPTIONAL: OptionalOp[] = [['chat', 'stopRun', 'Arrêter un run'], ['chat', 'approval', 'Répondre aux approbations']];

/** Chat availability from the operations phase 2 uses: a missing `steer` must not warn, a missing `createRun` must block. */
export function useChatAvailability(instanceId: string | undefined) {
  const { available, missing, reasons, link } = useModuleAvailability(instanceId, 'chat', REQUIRED, OPTIONAL);
  return { available, missing, reasons, link };
}

export function ChatNotice({ instanceId }: { instanceId: string | undefined }) {
  return <ModuleNotice instanceId={instanceId} module="chat" title="Le chat" required={REQUIRED} optional={OPTIONAL} />;
}
