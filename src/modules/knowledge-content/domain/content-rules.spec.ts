import { describe, expect, it } from 'vitest';
import {
  canPublishContent,
  canWithdrawContent,
  contentPage,
} from './content-rules.js';
import {
  validateProjectKnowledge,
  ProjectKnowledgeValidationError,
} from './project-knowledge-validation.js';

describe('content domain rules', () => {
  it('allows only explicit publication and withdrawal transitions', () => {
    for (const state of ['draft', 'withdrawn']) {
      expect(canPublishContent(state)).toBe(true);
      expect(canWithdrawContent(state)).toBe(false);
    }
    expect(canPublishContent('published')).toBe(false);
    expect(canWithdrawContent('published')).toBe(true);
    expect(canPublishContent('other')).toBe(false);
    expect(canWithdrawContent('other')).toBe(false);
  });
  it.each([
    { page: 0 },
    { pageSize: 101 },
    { page: 0.1 },
    { page: 2147483647, pageSize: 100 },
  ])('rejects unsafe paging %j', (input) => {
    expect(() => contentPage(input)).toThrow(RangeError);
  });
  it.each([
    '<script>run()</script>',
    '<img onload=run()>',
    'javascript:run()',
    'password=secret',
    '13800138000',
    'editor@example.com',
  ])('rejects prohibited knowledge content %s', (content) => {
    expect(() =>
      validateProjectKnowledge({
        title: 'Title',
        content,
        category: 'platform',
      }),
    ).toThrow(ProjectKnowledgeValidationError);
  });
  it('normalizes safe content and keeps null source URLs', () => {
    expect(
      validateProjectKnowledge({
        title: ' Title ',
        content: ' Description ',
        category: ' Platform ',
        sourceUrl: null,
      }),
    ).toEqual({
      title: 'Title',
      content: 'Description',
      category: 'Platform',
      sourceUrl: null,
    });
  });
  it.each([
    { title: 'password=private-value' },
    { category: '13800138000' },
    { sourceUrl: 'https://example.org/?%74oken=private-value' },
    { sourceUrl: 'https://account:private-value@example.org/' },
    {
      content:
        '-----BEGIN RSA PRIVATE KEY-----\nmaterial\n-----END RSA PRIVATE KEY-----',
    },
    { content: '{"refresh_token":"private-value"}' },
  ])(
    'rejects sensitive project metadata and encoded URL credentials: %j',
    (extra) => {
      expect(() =>
        validateProjectKnowledge({
          title: 'Title',
          content: 'Content',
          category: 'platform',
          ...extra,
        }),
      ).toThrow(ProjectKnowledgeValidationError);
    },
  );
  it('keeps normal password guidance, public URLs and large plain text valid', () => {
    const values = {
      title: 'Password help',
      content:
        'Change your password in account settings.\n' + 'a'.repeat(90000),
      category: 'platform',
      sourceUrl: 'https://example.org/docs?q=skiing',
    };
    expect(validateProjectKnowledge(values)).toEqual(values);
  });
  it('rejects source URLs whose canonical database value exceeds its bound', () => {
    expect(() =>
      validateProjectKnowledge({
        title: 'Title',
        content: 'Content',
        category: 'platform',
        sourceUrl: 'https://example.org/' + '\u96ea'.repeat(500),
      }),
    ).toThrow(ProjectKnowledgeValidationError);
  });
});
