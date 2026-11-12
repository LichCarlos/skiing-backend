export function merchantText(value: unknown, max: number): string {
  if (typeof value !== 'string') throw new RangeError('Invalid text');
  const text = value.trim();
  if (!text || Array.from(text).length > max)
    throw new RangeError('Invalid text');
  return text;
}

export function merchantVersion(value: unknown): number {
  if (
    !Number.isInteger(value) ||
    Number(value) < 1 ||
    Number(value) >= 2147483647
  )
    throw new RangeError('Invalid or exhausted version');
  return Number(value);
}

export function merchantTarget(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 2147483647)
    throw new RangeError('Invalid target');
  return value;
}
