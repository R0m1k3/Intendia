import { Check, ChevronDown, ChevronRight, Circle, CircleDot } from 'lucide-react';
import { useStoredFlag } from '../components/useStoredFlag';
import { cx } from '../components/ui';
import { t } from '../i18n';
import { todoSummary, todoTree, type Todo } from './todos';

function Mark({ status }: { status: string }) {
  if (status === 'completed') return <Check className="size-3.5 text-ok" strokeWidth={2} aria-label={t('faite')} />;
  if (status === 'in_progress') return <CircleDot className="size-3.5 text-accent-ink" strokeWidth={2} aria-label={t('en cours')} />;
  return <Circle className="size-3.5 text-ink-faint" strokeWidth={1.5} aria-label={status === 'cancelled' ? t('annulée') : t('à faire')} />;
}

/** The agent's task list (todo_list), above the composer: one line folded, the list unfolded. */
export function Todos({ todos }: { todos: Todo[] }) {
  const [open, setOpen] = useStoredFlag('intendia-todos-open');
  const { done, total, current } = todoSummary(todos);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section aria-label={t('Tâches de l’agent')} className="mb-2 rounded-xl border border-line bg-sheet shadow-[var(--shadow-card)]" data-todos>
      <button
        type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
      >
        <Chevron className="size-4 shrink-0 text-ink-faint" strokeWidth={1.5} />
        <span className="shrink-0 font-medium">{t('Tâches de l’agent')}</span>
        <span className="shrink-0 font-mono text-xs text-ink-soft" data-todos-count>{done}/{total}</span>
        {current && <span className="min-w-0 flex-1 truncate text-ink-soft">· {current.content}</span>}
      </button>
      {open && (
        <ul className="max-h-[50vh] overflow-y-auto border-t border-line px-3 py-2">
          {todoTree(todos).map(({ todo, level }) => (
            <li key={`${todo.id}:${todo.content}`} className="flex items-start gap-2 py-0.5 text-sm" style={{ paddingLeft: level * 18 }} data-todo-status={todo.status}>
              <span className="mt-[3px] shrink-0"><Mark status={todo.status} /></span>
              <span className={cx('min-w-0', todo.status === 'cancelled' && 'text-ink-faint line-through', todo.status === 'completed' && 'text-ink-soft')}>
                {todo.content}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
