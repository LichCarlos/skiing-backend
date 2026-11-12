import { describe, expect, it } from 'vitest';
import {
  articleLink,
  articleReadableText,
  parseArticleMarkdown,
  safeArticleLink,
} from './markdown.js';

describe('Markdown v1 controlled content protocol', () => {
  it('extracts deduplicated stable IDs from inline and reference syntax, not code', () => {
    const body =
      '# 雪道笔记\n\n[万龙](resort:7) [再去](resort:7) [知识][doc]\n\n![雪道](asset:12) ![再次][img]\n\n[doc]: article:9\n[img]: asset:12\n\n`[不是引用](resort:99)`';
    expect(parseArticleMarkdown(body)).toMatchObject({
      assetIds: ['12'],
      links: [
        { type: 'resort', id: 7 },
        { type: 'article', id: 9 },
      ],
    });
  });
  it('retains readable facts and code but strips formatting, destinations and image secrets for RAG', () => {
    const text = articleReadableText(
      '# 雪场\n\n**安全** [万龙](resort:7)\n\n![雪道](asset:12)\n\n|装备|建议|\n|---|---|\n|头盔|必备|',
      'markdown_v1',
    );
    expect(text).toContain('安全');
    expect(text).toContain('必备');
    expect(text).not.toMatch(/resort:|asset:|\*\*|!\[/);
  });
  it('does not reinterpret any legacy or unknown-format plain text', () => {
    for (const format of [undefined, 'plain_text', 'future_v2'])
      expect(
        articleReadableText('# old\n<script>literal</script>', format),
      ).toBe('# old\n<script>literal</script>');
  });
  it.each([
    '<img src=x onerror=alert(1)>',
    '<iframe src="https://x.test"/>',
    '- [x] task',
    '[bad](javascript:alert)',
    '[bad](data:text/html,a)',
    '[bad](file:///etc/passwd)',
    '[bad](//evil.test)',
    '[bad](#missing)',
    '![x](https://127.0.0.1/private)',
    '![x](data:image/png;base64,AA)',
    '![x](asset:0)',
    '![x](asset:9223372036854775808)',
  ])('rejects unsupported or unsafe input %s', (source) => {
    expect(() => parseArticleMarkdown(source)).toThrow();
  });
  it('retains text and link budgets while allowing more than 100 distinct images', () => {
    expect(() => parseArticleMarkdown('x'.repeat(100001))).toThrow();
    expect(() => parseArticleMarkdown('[x](resort:1) '.repeat(101))).toThrow();
    const ids = Array.from({ length: 150 }, (_, i) => String(i + 1));
    expect(
      parseArticleMarkdown(ids.map((id) => `![x](asset:${id})`).join('\n'))
        .assetIds,
    ).toEqual(ids);
    expect(() =>
      parseArticleMarkdown('![x](asset:1) '.repeat(150)),
    ).not.toThrow();
  });
  it('supports all six heading levels, tables, fenced code, lists and HTTPS links', () => {
    expect(() =>
      parseArticleMarkdown(
        '###### 六级\n\n> 引用\n\n1. 装备\n\n```ts\nconst safe = "<html>";\n```\n\n|a|b|\n|---|---|\n|1|2|\n\n[来源](https://example.com/a?q=1)',
      ),
    ).not.toThrow();
  });
  it('rejects credentials, control characters and invalid IDs', () => {
    for (const url of [
      'https://u:p@x.test',
      'https://x.test\\evil',
      'https://x.test\n/a',
      'article:2147483648',
      'resort:01',
      'asset:12',
    ])
      expect(safeArticleLink(url)).toBe(false);
    expect(articleLink('article:2147483647')).toEqual({
      type: 'article',
      id: 2147483647,
    });
  });
});
