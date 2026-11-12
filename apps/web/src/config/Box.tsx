import type { ReactNode } from 'react';

/** A configuration block (the mockup's `.box`): title and explanation at the top, then the content. */
export function ConfigBox({ title, description, action, children, id }: {
  title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; id?: string;
}) {
  return (
    <section className="card" aria-labelledby={id}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pb-1 pt-3.5">
        <div className="min-w-0 flex-1">
          <h2 id={id} className="text-[15px] font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-ink-faint">{description}</p>}
        </div>
        {action}
      </div>
      <div className="p-4 pt-3">{children}</div>
    </section>
  );
}
