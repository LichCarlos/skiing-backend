export const CHAT_MODEL_PROVIDER = Symbol('CHAT_MODEL_PROVIDER');

export interface ChatModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatModelInput {
  messages: readonly ChatModelMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatModelProvider {
  stream(input: ChatModelInput, signal?: AbortSignal): AsyncIterable<string>;
}
