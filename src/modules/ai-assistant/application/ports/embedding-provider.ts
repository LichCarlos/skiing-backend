export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

export interface EmbeddingProvider {
  embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]>;
}
