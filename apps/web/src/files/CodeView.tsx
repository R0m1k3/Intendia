/** CodeMirror 6, loaded on demand (React.lazy): read-only view with highlighting, or editor. */
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, syntaxHighlighting, type LanguageSupport } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { useEffect, useRef } from 'react';

function language(name: string): LanguageSupport | null {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'js': case 'mjs': case 'cjs': case 'jsx': return javascript({ jsx: true });
    case 'ts': case 'tsx': return javascript({ typescript: true, jsx: ext === 'tsx' });
    case 'py': return python();
    case 'json': case 'jsonl': return json();
    case 'md': case 'markdown': return markdown();
    case 'html': case 'htm': case 'svg': case 'xml': return html();
    case 'css': return css();
    case 'yaml': case 'yml': return yaml();
    default: return null;
  }
}

// Colours from the design tokens: ink for text, accent for keywords, muted for comments.
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: 'var(--color-accent-ink)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--color-warn)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--color-bad)' },
  { tag: [t.comment, t.meta], color: 'var(--color-ink-faint)', fontStyle: 'italic' },
  { tag: [t.heading], fontWeight: '600' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--color-ink-soft)' },
  { tag: [t.link, t.url], color: 'var(--color-accent-ink)', textDecoration: 'underline' },
]);

const theme = EditorView.theme({
  '&': { fontSize: '12.5px', backgroundColor: 'transparent', color: 'var(--color-ink)', height: '100%' },
  '.cm-scroller': { fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace", lineHeight: '1.6' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--color-ink-faint)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--color-ink)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--color-accent-soft) !important' },
});

export default function CodeView({ name, value, editable, onChange }: {
  name: string; value: string; editable: boolean; onChange?: (v: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const editableConf = useRef(new Compartment());
  const changed = useRef(onChange);
  changed.current = onChange;

  useEffect(() => {
    const lang = language(name);
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), history(), keymap.of([...defaultKeymap, ...historyKeymap]), EditorView.lineWrapping,
          syntaxHighlighting(highlight), theme, ...(lang ? [lang] : []),
          editableConf.current.of([EditorView.editable.of(editable), EditorState.readOnly.of(!editable)]),
          EditorView.updateListener.of((u) => { if (u.docChanged) changed.current?.(u.state.doc.toString()); }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // the document is set once per file; edits stay in the editor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, value]);

  useEffect(() => {
    view.current?.dispatch({ effects: editableConf.current.reconfigure([EditorView.editable.of(editable), EditorState.readOnly.of(!editable)]) });
    if (editable) view.current?.focus();
  }, [editable]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}
