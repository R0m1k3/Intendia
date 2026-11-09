import type { Element, ElementContent, Root, RootContent, Text } from 'hast';

/**
 * Rehype plugin: in text nodes (inline code included, code blocks and links excluded), each path the
 * server confirmed becomes <a data-path="<workspace-relative path>"> showing the written text.
 */
export function rehypePaths(found: Map<string, string>) {
  const keys = [...found.keys()].sort((a, b) => b.length - a.length);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = keys.length
    ? new RegExp(`(?<![\\w/.:~-])(${keys.map(esc).join('|')})(?=$|[\\s\`'"<>()\\[\\]{}|*.,;:!?/])`, 'g')
    : null;

  const split = (node: Text): ElementContent[] => {
    if (!re) return [node];
    const out: ElementContent[] = [];
    let last = 0;
    for (const m of node.value.matchAll(re)) {
      const at = m.index!;
      if (at > last) out.push({ type: 'text', value: node.value.slice(last, at) });
      out.push({
        type: 'element', tagName: 'a',
        properties: { href: '#', dataPath: found.get(m[1]!)!, title: m[1]! },
        children: [{ type: 'text', value: m[1]! }],
      });
      last = at + m[1]!.length;
    }
    if (last === 0) return [node];
    if (last < node.value.length) out.push({ type: 'text', value: node.value.slice(last) });
    return out;
  };

  const walk = (parent: Root | Element) => {
    const next: (RootContent | ElementContent)[] = [];
    for (const child of parent.children) {
      if (child.type === 'text') next.push(...split(child));
      else {
        if (child.type === 'element' && child.tagName !== 'a' && child.tagName !== 'pre') walk(child);
        next.push(child);
      }
    }
    parent.children = next as typeof parent.children;
  };

  return () => (tree: Root) => {
    if (re) walk(tree);
  };
}
