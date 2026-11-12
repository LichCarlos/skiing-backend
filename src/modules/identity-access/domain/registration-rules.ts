export function normalizeAccount(account: string): string {
  return account.trim().toLowerCase();
}

export function normalizeNickname(nickname: string): string {
  return nickname.trim();
}

export function isValidPasswordLength(password: string): boolean {
  const byteLength = Buffer.byteLength(password, 'utf8');
  return byteLength >= 8 && byteLength <= 72;
}

export function isValidAccount(account: string): boolean {
  return account.length > 0 && Array.from(account).length <= 50;
}

export function isValidNickname(nickname: string): boolean {
  return nickname.length > 0 && Array.from(nickname).length <= 50;
}
