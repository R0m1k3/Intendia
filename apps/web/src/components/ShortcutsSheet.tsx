import { X } from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { shortcutLabel } from './CommandPalette';
import { t } from '../i18n';

const KBD = 'inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-line bg-paper px-1.5 font-mono text-[11.5px] text-ink-soft';

/** Keys of a row: each group is one combination (« Ctrl K »), groups are alternatives (« Entrée » / « Maj Entrée »). */
type Row = { label: string; keys: string[][] };

function sections(): { title: string; rows: Row[] }[] {
  const mod = shortcutLabel().replace(' K', '');
  return [
    {
      title: t('Partout'),
      rows: [
        { label: t('Rechercher'), keys: [[mod, 'K']] },
        { label: t('Ouvrir un fichier'), keys: [[mod, 'P']] },
        { label: t('Chat latéral'), keys: [[mod, 'J']] },
        { label: t('Nouvelle session'), keys: [['n']] },
        { label: t('Ouvrir cette aide'), keys: [['?']] },
        { label: t('Fermer la fenêtre ou la feuille'), keys: [[t('Échap')]] },
      ],
    },
    {
      title: t('Dans une session'),
      rows: [
        { label: t('Aller au champ de message'), keys: [['/']] },
        { label: t('Envoyer / aller à la ligne'), keys: [[t('Entrée|touche')], [t('Maj|touche'), t('Entrée|touche')]] },
        { label: t('Question précédente ou suivante'), keys: [['Alt', '↑'], ['Alt', '↓']] },
      ],
    },
  ];
}

/** « ? » or the sidebar's link: the keyboard shortcuts, in a window built like the palette. Escape, the backdrop or X closes it. */
export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // the window itself takes the focus (Tab then reaches X), no ring drawn on the button
  useLayoutEffect(() => { box.current?.focus(); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // a sheet below must not close with it
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: a click on the backdrop closes the dialog; the keyboard has Escape
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: a click on the backdrop closes the dialog; the keyboard has Escape
    <div data-overlay className="fixed inset-0 z-[60] flex items-start justify-center bg-ink/25 px-3 pt-[12vh]" onMouseDown={onClose}>
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: the mousedown only stops the backdrop's close; the dialog is a native-focus container, not a control */}
      <div
        ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" onMouseDown={(e) => e.stopPropagation()}
        className="enter flex outline-none max-h-[76vh] w-full max-w-[480px] flex-col overflow-hidden rounded-xl border border-line bg-sheet shadow-[var(--shadow-card)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-line py-2.5 pl-5 pr-2.5">
          <h2 id="shortcuts-title" className="text-[15px] font-semibold">{t('Raccourcis clavier')}</h2>
          <button type="button" onClick={onClose} aria-label={t('Fermer')}
            className="flex size-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-ink">
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto px-5 pb-4">
          {sections().map((s) => (
            <section key={s.title} aria-label={s.title}>
              <h3 className="pb-1.5 pt-4 text-xs font-medium text-ink-faint">{s.title}</h3>
              <dl className="divide-y divide-line/70">
                {s.rows.map((r) => (
                  <div key={r.label} className="flex items-center justify-between gap-4 py-2">
                    <dt className="min-w-0 text-sm text-ink">{r.label}</dt>
                    <dd className="flex shrink-0 items-center gap-1.5 text-xs text-ink-faint">
                      {r.keys.map((combo, i) => (
                        <Fragment key={i}>
                          {i > 0 && <span aria-hidden>/</span>}
                          <span className="flex items-center gap-1">{combo.map((k) => <kbd key={k} className={KBD}>{k}</kbd>)}</span>
                        </Fragment>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
