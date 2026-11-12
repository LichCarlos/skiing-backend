export const AI_MESSAGE_MAX_CODE_POINTS = 4_000;
export const AI_MESSAGE_LIMIT_PER_USER = 5;
export const AI_MESSAGE_RATE_WINDOW_MS = 60_000;

export class AiMessageContentInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiMessageContentInvalidError';
  }
}

export function normalizeAiMessageContent(value: unknown): string {
  if (typeof value !== 'string')
    throw new AiMessageContentInvalidError('Message content must be a string');
  const content = value.trim();
  if (!content) {
    throw new AiMessageContentInvalidError('Message content is required');
  }

  if (Array.from(content).length > AI_MESSAGE_MAX_CODE_POINTS) {
    throw new AiMessageContentInvalidError(
      `Message content must not exceed ${AI_MESSAGE_MAX_CODE_POINTS} characters`,
    );
  }

  return content;
}

export class AiConversationPageInvalidError extends Error {}

export function assertAiConversationPage(page: number, pageSize: number): void {
  const skip = (page - 1) * pageSize;
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    !Number.isSafeInteger(skip) ||
    skip > 2_147_483_647
  )
    throw new AiConversationPageInvalidError('Invalid conversation pagination');
}
