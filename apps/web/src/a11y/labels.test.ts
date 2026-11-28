// Every button and link has a name a screen reader can say: a text, or an `aria-label` when it only draws an icon.
// Read from the sources (every .tsx, not only the screens a test visits): an element whose content is nothing but
// icons and that carries no `aria-label` / `aria-labelledby` / `title` is reported with its file and line.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseSync } from 'vite';
import { expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..');
const CONTROLS = new Set(['button', 'a', 'Button', 'Link', 'summary']);
const NAMES = new Set(['aria-label', 'aria-labelledby', 'title']);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return files(path);
    return e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx') ? [path] : [];
  });
}

/**
 * A node of the syntax tree (ESTree with JSX) from the parser Vite ships. TypeScript 7 no longer has a compiler API to
 * import, so the tree is read by `type` and field name through `one` / `many`.
 */
interface Node { type: string; start: number; [key: string]: unknown }

const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null && typeof (v as Node).type === 'string';
const one = (n: Node | null, key: string): Node | null => { const v = n?.[key]; return isNode(v) ? v : null; };
const many = (n: Node | null, key: string): Node[] => { const v = n?.[key]; return Array.isArray(v) ? v.filter(isNode) : []; };

function walk(node: Node, visit: (n: Node) => void): void {
  visit(node);
  for (const v of Object.values(node)) {
    if (isNode(v)) walk(v, visit);
    else if (Array.isArray(v)) for (const c of v) if (isNode(c)) walk(c, visit);
  }
}

/** The name as written: `button`, `n.icon`, `aria-label`, `xlink:href`. */
function tag(name: Node | null): string {
  if (!name) return '';
  if (name.type === 'JSXMemberExpression') return `${tag(one(name, 'object'))}.${tag(one(name, 'property'))}`;
  if (name.type === 'JSXNamespacedName') return `${tag(one(name, 'namespace'))}:${tag(one(name, 'name'))}`;
  return String(name.name);
}

/** Names imported from lucide-react in this file, and local names that look like an icon (`<n.icon />`, `<Icon />`). */
function iconNames(program: Node): Set<string> {
  const icons = new Set<string>(['svg']);
  for (const st of many(program, 'body')) {
    if (st.type !== 'ImportDeclaration' || one(st, 'source')?.value !== 'lucide-react') continue;
    for (const el of many(st, 'specifiers')) if (el.type === 'ImportSpecifier') icons.add(tag(one(el, 'local')));
  }
  return icons;
}

const isIcon = (name: string, icons: Set<string>) => icons.has(name) || /(^|\.)(icon|Icon)$/.test(name) || /Icon$/.test(name);

/** `opening`: a JSXOpeningElement. Props passed through (`{...p}`) count: the caller names it. */
const hasName = (opening: Node | null): boolean =>
  many(opening, 'attributes').some((p) => p.type === 'JSXSpreadAttribute' || NAMES.has(tag(one(p, 'name'))));

/** true: this child can give the control a name; false: it only draws (an icon, white space, a comment). */
function names(child: Node, icons: Set<string>): boolean {
  if (child.type === 'JSXText') return String(child.value).trim() !== '';
  if (child.type === 'JSXExpressionContainer') {
    // `cond && <Icon />`, `a ? <Icon /> : <Other />`: look inside; any other expression may be a text
    const parts: Node[] = [];
    const open = (x: Node | null): void => {
      if (!x) return;
      if (x.type === 'ParenthesizedExpression') open(one(x, 'expression'));
      else if (x.type === 'LogicalExpression' && (x.operator === '&&' || x.operator === '||')) open(one(x, 'right'));
      else if (x.type === 'ConditionalExpression') { open(one(x, 'consequent')); open(one(x, 'alternate')); }
      else parts.push(x);
    };
    open(one(child, 'expression'));
    return parts.some((x) => {
      if (x.type === 'JSXEmptyExpression') return false; // a comment
      if (x.type === 'JSXElement' || x.type === 'JSXFragment') return names(x, icons);
      return !(x.type === 'Literal' && (x.raw === 'null' || x.raw === 'false'));
    });
  }
  if (child.type === 'JSXElement') {
    const opening = one(child, 'openingElement');
    if (hasName(opening)) return true;
    if (isIcon(tag(one(opening, 'name')), icons)) return false;
    return opening?.selfClosing === true || many(child, 'children').some((c) => names(c, icons));
  }
  if (child.type === 'JSXFragment') return many(child, 'children').some((c) => names(c, icons));
  return true;
}

/** Lines (from 1) of the buttons and links of this source that nothing names. */
function unnamedLines(path: string, text: string): number[] {
  const { program, errors } = parseSync(path, text, { lang: 'tsx' });
  if (errors.length > 0) throw new Error(`${path}: ${errors[0]?.message}`);
  const root = program as unknown as Node;
  const icons = iconNames(root);
  const lines: number[] = [];
  walk(root, (node) => {
    if (node.type !== 'JSXElement') return;
    const opening = one(node, 'openingElement');
    if (!CONTROLS.has(tag(one(opening, 'name'))) || hasName(opening)) return;
    if (!many(node, 'children').some((c) => names(c, icons))) lines.push(text.slice(0, node.start).split('\n').length);
  });
  return lines;
}

const unnamed = (path: string): string[] => unnamedLines(path, readFileSync(path, 'utf8')).map((line) => `${relative(SRC, path)}:${line}`);

it('names every button and link that only draws an icon', () => {
  const all = files(SRC);
  expect(all.length).toBeGreaterThan(100);
  expect(all.flatMap(unnamed)).toEqual([]);
});

it('sees an icon-only button without a label, and accepts the usual ways of naming one', () => {
  const check = (jsx: string) => unnamedLines('x.tsx', `import { X, Plus } from 'lucide-react';\nconst a = ${jsx};`).length;
  expect(check('<button type="button"><X className="size-3" /></button>')).toBe(1);
  expect(check('<button type="button">{open ? <X /> : <Plus />}</button>')).toBe(1);
  expect(check('<button type="button"><span className="flex"><n.icon /></span></button>')).toBe(1);
  expect(check('<Link to="/" />')).toBe(1);
  expect(check('<button type="button" aria-label="Fermer"><X /></button>')).toBe(0);
  expect(check('<button type="button"><X /> Fermer</button>')).toBe(0);
  expect(check('<button type="button"><X /><span className="sr-only">{t("Fermer")}</span></button>')).toBe(0);
  expect(check('<button type="button"><X />{label}</button>')).toBe(0);
  expect(check('<Button {...p}><X /></Button>')).toBe(0);
  expect(check('<a href="/x"><img src="/logo.png" alt="Intendia" /></a>')).toBe(0);
});
