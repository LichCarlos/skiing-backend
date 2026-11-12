// Historical user questions help resolve follow-ups. They are never evidence.
export const MAX_CONTEXT_QUESTIONS = 4;
const MAX_HISTORY_CODE_POINTS = 2_000;
const MAX_QUERY_CODE_POINTS = 4_000;

/** Input is chronological; prefer recent complete questions over older ones. */
export function selectPreviousQuestions(
  questions: readonly string[],
): string[] {
  const selected: string[] = [];
  let remaining = MAX_HISTORY_CODE_POINTS;
  for (const question of questions.slice(-MAX_CONTEXT_QUESTIONS).reverse()) {
    const content = question.trim();
    if (!content) continue;
    const points = Array.from(content);
    // Keep whole questions: truncating one could change its meaning.
    if (points.length > remaining) break;
    selected.unshift(content);
    remaining -= points.length;
  }
  return selected;
}

export function contextualRetrievalQuery(
  question: string,
  previousQuestions: readonly string[],
): string {
  let query = question;
  for (const previous of [...previousQuestions].reverse()) {
    const next = `${query}\n${previous}`;
    if (Array.from(next).length > MAX_QUERY_CODE_POINTS) break;
    query = next;
  }
  return query;
}
