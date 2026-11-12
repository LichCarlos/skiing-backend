export interface RagTextChunk {
  index: number;
  content: string;
}

export const RAG_CHUNK_MAX_CHARACTERS = 1_200;
export const RAG_CHUNK_OVERLAP_CHARACTERS = 150;

export function splitRagText(text: string): RagTextChunk[] {
  const characters = Array.from(text.replace(/\r\n?/g, '\n').trim());
  if (characters.length === 0) return [];

  const chunks: RagTextChunk[] = [];
  let start = 0;
  while (start < characters.length) {
    const hardEnd = Math.min(
      start + RAG_CHUNK_MAX_CHARACTERS,
      characters.length,
    );
    const end = chooseChunkEnd(characters, start, hardEnd);
    const content = characters.slice(start, end).join('').trim();
    if (content) chunks.push({ index: chunks.length, content });
    if (end >= characters.length) break;

    start = Math.max(start + 1, end - RAG_CHUNK_OVERLAP_CHARACTERS);
  }

  return chunks;
}

function chooseChunkEnd(
  characters: readonly string[],
  start: number,
  hardEnd: number,
): number {
  if (hardEnd === characters.length) return hardEnd;

  const minimumEnd = start + Math.floor((hardEnd - start) * 0.6);
  for (let index = hardEnd; index > minimumEnd; index -= 1) {
    if (isBoundary(characters[index - 1] ?? '')) return index;
  }
  return hardEnd;
}

function isBoundary(character: string): boolean {
  return /[\s。！？；.!?;]/u.test(character);
}
