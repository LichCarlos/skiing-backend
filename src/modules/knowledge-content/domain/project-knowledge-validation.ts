export class ProjectKnowledgeValidationError extends Error {
  constructor(
    readonly kind: 'invalid' | 'unsafe',
    message: string,
  ) {
    super(message);
  }
}
export function validateProjectKnowledge(body: {
  title: string;
  content: string;
  category: string;
  sourceUrl?: string | null;
}) {
  const title = text(body.title, 200, 'title');
  const content = text(body.content, 100000, 'content');
  const category = text(body.category, 80, 'category');
  for (const value of [title, content, category]) assertPublishableText(value);
  let sourceUrl: string | null = null;
  if (
    body.sourceUrl !== undefined &&
    body.sourceUrl !== null &&
    body.sourceUrl !== ''
  ) {
    if (typeof body.sourceUrl !== 'string' || body.sourceUrl.length > 2048)
      throw new ProjectKnowledgeValidationError('invalid', 'Invalid sourceUrl');
    let url: URL;
    try {
      url = new URL(body.sourceUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      sourceUrl = url.toString();
      if (sourceUrl.length > 2048) throw new Error();
    } catch {
      throw new ProjectKnowledgeValidationError(
        'invalid',
        'sourceUrl must be a valid HTTP(S) URL',
      );
    }
    if (url.username || url.password)
      throw new ProjectKnowledgeValidationError(
        'unsafe',
        'URL credentials are not allowed',
      );
    let decodedUrl = sourceUrl;
    try {
      decodedUrl = decodeURIComponent(sourceUrl);
    } catch {
      /* Preserve valid URLs containing literal percent signs. */
    }
    for (const value of [
      body.sourceUrl,
      decodedUrl,
      ...Array.from(url.searchParams, ([key, value]) => `${key}=${value}`),
    ])
      assertPublishableText(value);
  }
  return {
    title: title,
    content: content,
    category: category,
    sourceUrl: sourceUrl,
  };
}
function assertPublishableText(value: string): void {
  if (/<\s*script\b|\bon\w+\s*=|javascript:/i.test(value))
    throw new ProjectKnowledgeValidationError(
      'unsafe',
      'HTML executable content is not allowed',
    );
  if (
    /\b(password|passwd|secret|api[_ -]?key|(?:access|refresh)[_ -]?token|token|private[_ -]?key)["']?\s*[:=]\s*\S+/i.test(
      value,
    ) ||
    /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/i.test(value) ||
    /\b\d{17}[\dXx]\b|\b1[3-9]\d{9}\b|[\w.+-]{1,64}@[\w.-]{1,253}\.[A-Za-z]{2,63}/.test(
      value,
    )
  )
    throw new ProjectKnowledgeValidationError(
      'unsafe',
      'Sensitive credentials or personal information are not allowed',
    );
}
function text(value: string, max: number, field: string) {
  if (typeof value !== 'string')
    throw new ProjectKnowledgeValidationError('invalid', `Invalid ${field}`);
  const result = value.trim();
  if (!result || Array.from(result).length > max)
    throw new ProjectKnowledgeValidationError('invalid', `Invalid ${field}`);
  return result;
}
