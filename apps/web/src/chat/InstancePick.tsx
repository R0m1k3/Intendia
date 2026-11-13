import { Chips } from '../components/ui';

export interface PickInstance { id: string; label: string; workspaces: number }

/**
 * « Instance » card above an empty chat (a session never sent, or the home page): where the first message goes.
 * Nothing with a single instance. An instance without a workspace can only be picked where `allowEmpty` (the home page
 * then offers to create one).
 */
export function InstancePick({ value, instances, disabled, allowEmpty, onPick }: {
  value: string | null;
  instances: readonly PickInstance[];
  disabled?: boolean;
  allowEmpty?: boolean;
  onPick: (id: string) => void;
}) {
  if (instances.length < 2) return null;
  return (
    <div data-instance-pick className="mx-auto inline-flex max-w-full flex-col items-center gap-2 rounded-xl border border-line bg-sheet px-4 py-3">
      <p className="text-[12.5px] font-medium text-ink-soft">Instance</p>
      <Chips
        label="Instance de la session" value={value} disabled={disabled} className="justify-center"
        onChange={(id) => { if (id !== value) onPick(id); }}
        items={instances.map((i) => ({
          key: i.id,
          label: i.label,
          count: i.workspaces,
          disabled: !allowEmpty && i.workspaces === 0,
          title: i.workspaces === 0 ? 'Aucun workspace sur cette instance' : `${i.workspaces} workspace${i.workspaces > 1 ? 's' : ''}`,
        }))}
      />
    </div>
  );
}
