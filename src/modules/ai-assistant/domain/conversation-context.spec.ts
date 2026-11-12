import { describe, expect, it } from 'vitest';
import {
  contextualRetrievalQuery,
  selectPreviousQuestions,
} from './conversation-context.js';

describe('conversation context limits', () => {
  it('keeps recent whole questions in chronological order and trims blanks', () => {
    expect(
      selectPreviousQuestions(['old', 'one', ' ', ' two ', 'three']),
    ).toEqual(['one', 'two', 'three']);
  });

  it('uses a Unicode code-point budget without breaking or partially quoting a question', () => {
    const recent = '😀'.repeat(1_000);
    expect(selectPreviousQuestions(['older', recent, recent])).toEqual([
      recent,
      recent,
    ]);
    expect(selectPreviousQuestions(['older', '😀'.repeat(2_001)])).toEqual([]);
  });

  it('preserves the current question and prefers recent questions within the retrieval budget', () => {
    expect(
      contextualRetrievalQuery('几点开门？', ['北岭雪场', '初学者区域']),
    ).toBe('几点开门？\n初学者区域\n北岭雪场');
    const question = '😀'.repeat(4_000);
    expect(contextualRetrievalQuery(question, ['北岭雪场'])).toBe(question);
    expect(
      contextualRetrievalQuery('x'.repeat(3_990), ['old', 'too long question']),
    ).toBe('x'.repeat(3_990));
  });
});
