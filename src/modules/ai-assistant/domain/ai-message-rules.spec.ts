import { describe, expect, it } from 'vitest';
import {
  AI_MESSAGE_MAX_CODE_POINTS,
  AiConversationPageInvalidError,
  AiMessageContentInvalidError,
  assertAiConversationPage,
  normalizeAiMessageContent,
} from './ai-message-rules.js';

describe('normalizeAiMessageContent', () => {
  it.each([null, undefined, 1, {}, [], true])(
    'rejects non-string %j',
    (value) => {
      expect(() => normalizeAiMessageContent(value)).toThrow(
        AiMessageContentInvalidError,
      );
    },
  );
  it('trims input and counts Unicode code points rather than UTF-16 units', () => {
    const content = '雪'.repeat(AI_MESSAGE_MAX_CODE_POINTS - 1) + '😀';
    expect(Array.from(normalizeAiMessageContent(` ${content} `))).toHaveLength(
      AI_MESSAGE_MAX_CODE_POINTS,
    );
  });

  it('rejects blank content and messages over the code point limit', () => {
    expect(() => normalizeAiMessageContent(' \n ')).toThrow(
      'Message content is required',
    );
    expect(() =>
      normalizeAiMessageContent('x'.repeat(AI_MESSAGE_MAX_CODE_POINTS + 1)),
    ).toThrow('must not exceed');
  });
});

describe('AI conversation pagination', () => {
  it.each([
    [0, 20],
    [1.5, 20],
    [1, 0],
    [1, 101],
    [NaN, 20],
    [Infinity, 20],
    [2147483647, 100],
    [Number.MAX_SAFE_INTEGER, 100],
  ])('rejects page %s / size %s', (page, size) => {
    expect(() => assertAiConversationPage(page, size)).toThrow(
      AiConversationPageInvalidError,
    );
  });
  it('allows the largest int4 skip and regular pages', () => {
    expect(() => assertAiConversationPage(2147483648, 1)).not.toThrow();
    expect(() => assertAiConversationPage(2, 100)).not.toThrow();
  });
});
