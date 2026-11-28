// Every button and link has a name a screen reader can say: a text, or an `aria-label` when it only draws an icon.
// Read from the sources (every .tsx, not only the screens a test visits): an element whose content is nothing but
// icons and that carries no `aria-label` / `aria-labelledby` / `title` is reported with its file and line.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
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

/** Names imported from lucide-react in this file, and local names that look like an icon (`<n.icon />`, `<Icon />`). */
function iconNames(source: ts.SourceFile): Set<string> {
  const icons = new Set<string>(['svg']);
  for (const st of source.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.moduleSpecifier.text !== 'lucide-react') continue;
    const named = st.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) for (const el of named.elements) icons.add(el.name.text);
  }
  return icons;
}

const isIcon = (tag: string, icons: Set<string>) => icons.has(tag) || /(^|\.)(icon|Icon)$/.test(tag) || /Icon$/.test(tag);

/** true: this child can give the control a name; false: it only draws (an icon, white space, a comment). */
function names(child: ts.JsxChild, icons: Set<string>): boolean {
  if (ts.isJsxText(child)) return child.text.trim() !== '';
  if (ts.isJsxExpression(child)) {
    const e = child.expression;
    if (!e) return false; // a comment
    // `cond && <Icon />`, `a ? <Icon /> : <Other />`: look inside; any other expression may be a text
    const parts: ts.Expression[] = [];
    const open = (x: ts.Expression): void => {
      if (ts.isParenthesizedExpression(x)) open(x.expression);
      else if (ts.isBinaryExpression(x) && (x.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || x.operatorToken.kind === ts.SyntaxKind.BarBarToken)) open(x.right);
      else if (ts.isConditionalExpression(x)) { open(x.whenTrue); open(x.whenFalse); }
      else parts.push(x);
    };
    open(e);
    return parts.some((x) => {
      if (ts.isJsxSelfClosingElement(x) || ts.isJsxElement(x) || ts.isJsxFragment(x)) return names(x, icons);
      return x.kind !== ts.SyntaxKind.NullKeyword && x.kind !== ts.SyntaxKind.FalseKeyword;
    });
  }
  if (ts.isJsxSelfClosingElement(child)) return !isIcon(child.tagName.getText(), icons) || hasName(child.attributes);
  if (ts.isJsxElement(child)) {
    if (hasName(child.openingElement.attributes)) return true;
    if (isIcon(child.openingElement.tagName.getText(), icons)) return false;
    return child.children.some((c) => names(c, icons));
  }
  if (ts.isJsxFragment(child)) return child.children.some((c) => names(c, icons));
  return true;
}

function hasName(attrs: ts.JsxAttributes): boolean {
  return attrs.properties.some((p) => ts.isJsxSpreadAttribute(p) // props passed through: the caller names it
    || (ts.isJsxAttribute(p) && NAMES.has(p.name.getText())));
}

function unnamed(path: string): string[] {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const icons = iconNames(source);
  const found: string[] = [];
  const at = (node: ts.Node) => `${relative(SRC, path)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && CONTROLS.has(node.openingElement.tagName.getText())) {
      if (!hasName(node.openingElement.attributes) && !node.children.some((c) => names(c, icons))) found.push(at(node));
    } else if (ts.isJsxSelfClosingElement(node) && CONTROLS.has(node.tagName.getText())) {
      if (!hasName(node.attributes)) found.push(at(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

it('names every button and link that only draws an icon', () => {
  const all = files(SRC);
  expect(all.length).toBeGreaterThan(100);
  expect(all.flatMap(unnamed)).toEqual([]);
});

it('sees an icon-only button without a label, and accepts the usual ways of naming one', () => {
  const check = (jsx: string) => {
    const source = ts.createSourceFile('x.tsx', `import { X, Plus } from 'lucide-react';\nconst a = ${jsx};`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const icons = iconNames(source);
    let bad = 0;
    const visit = (node: ts.Node): void => {
      if (ts.isJsxElement(node) && CONTROLS.has(node.openingElement.tagName.getText()) && !hasName(node.openingElement.attributes) && !node.children.some((c) => names(c, icons))) bad += 1;
      if (ts.isJsxSelfClosingElement(node) && CONTROLS.has(node.tagName.getText()) && !hasName(node.attributes)) bad += 1;
      ts.forEachChild(node, visit);
    };
    visit(source);
    return bad;
  };
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
