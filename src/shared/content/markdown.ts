import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

export type ArticleContentFormat = 'plain_text' | 'markdown_v1';
interface Node {
  type: string;
  value?: string;
  url?: string;
  identifier?: string;
  alt?: string;
  checked?: boolean | null;
  children?: Node[];
}
const parser = unified().use(remarkParse).use(remarkGfm);
const allowed = new Set([
  'root',
  'paragraph',
  'heading',
  'text',
  'strong',
  'emphasis',
  'delete',
  'list',
  'listItem',
  'blockquote',
  'thematicBreak',
  'break',
  'code',
  'inlineCode',
  'link',
  'image',
  'definition',
  'linkReference',
  'imageReference',
  'table',
  'tableRow',
  'tableCell',
]);

export function articleLink(
  value: string,
): { type: 'article' | 'resort'; id: number } | null {
  const match = /^(article|resort):([1-9]\d{0,9})$/.exec(value);
  if (!match || Number(match[2]) > 2147483647) return null;
  return { type: match[1] as 'article' | 'resort', id: Number(match[2]) };
}
export function safeArticleLink(value: string): boolean {
  if (articleLink(value)) return true;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 32 || code === 127 || code === 92) return false;
  }
  try {
    const url = new URL(value);
    return (
      ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
export function parseArticleMarkdown(body: string) {
  if (body.length > 100000)
    throw new Error('Article exceeds 100000 characters');
  const root = parser.parse(body) as Node;
  const definitions = new Map<string, string>();
  const assets = new Set<string>();
  const links = new Map<string, { type: 'article' | 'resort'; id: number }>();
  const plain: string[] = [];
  let count = 0,
    linkCount = 0;
  const walk = (node: Node, depth: number, work: (node: Node) => void) => {
    if (depth > 32 || ++count > 10000)
      throw new Error('Article structure exceeds safe limits');
    work(node);
    for (const child of node.children ?? []) walk(child, depth + 1, work);
  };
  walk(root, 0, (node) => {
    if (!allowed.has(node.type) || node.checked != null)
      throw new Error(
        'Unsupported Markdown: raw HTML, MDX and embedded content are not allowed',
      );
    if (node.type === 'definition')
      definitions.set(node.identifier!, node.url!);
  });
  count = 0;
  walk(root, 0, (node) => {
    const image = node.type === 'image' || node.type === 'imageReference';
    const link = node.type === 'link' || node.type === 'linkReference';
    if (image || link) {
      if (link && ++linkCount > 100)
        throw new Error('Article has too many links');
      const url = node.url ?? definitions.get(node.identifier ?? '') ?? '';
      if (image) {
        const match = /^asset:([1-9]\d{0,18})$/.exec(url);
        if (!match || BigInt(match[1]!) > 9223372036854775807n)
          throw new Error(
            'Upload images first; only asset:ID image references are allowed',
          );
        assets.add(match[1]!);
      } else {
        if (!safeArticleLink(url))
          throw new Error('Unsupported or unsafe article link');
        const logical = articleLink(url);
        if (logical) links.set(url, logical);
      }
    }
    if (
      node.type === 'text' ||
      node.type === 'code' ||
      node.type === 'inlineCode'
    )
      plain.push(node.value ?? '');
    if (
      [
        'paragraph',
        'heading',
        'tableRow',
        'listItem',
        'break',
        'thematicBreak',
      ].includes(node.type)
    )
      plain.push('\n');
  });
  return {
    assetIds: [...assets],
    links: [...links.values()],
    text: plain
      .join(' ')
      .replace(/[ \t]+/g, ' ')
      .trim(),
  };
}

export function articleReadableText(
  body: string,
  format: string | undefined,
): string {
  return format === 'markdown_v1' ? parseArticleMarkdown(body).text : body;
}
