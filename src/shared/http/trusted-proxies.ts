import { isIP } from 'node:net';
import type { Request } from 'express';

export function trustedProxyAllowlist(
  value = process.env.TRUSTED_PROXY_CIDRS ?? '',
): string[] | false {
  if (!value.trim()) return false;
  const entries = value.split(',').map((entry) => entry.trim());
  for (const entry of entries) {
    const [address, prefix, ...rest] = entry.split('/');
    const version = isIP(address!);
    if (
      !version ||
      rest.length ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) ||
          Number(prefix) < 1 ||
          Number(prefix) > (version === 4 ? 32 : 128)))
    )
      throw new Error(
        'TRUSTED_PROXY_CIDRS must contain only explicit IP/CIDR entries',
      );
  }
  return entries;
}

/** Express resolves the configured trusted chain; canonicalize equivalent IP spellings. */
export function loginClientIp(request: Request): string {
  const input = request.ip ?? request.socket.remoteAddress ?? '';
  const version = isIP(input);
  if (version === 4) return input;
  if (version !== 6) throw new Error('Client address unavailable');
  const canonical = new URL(`http://[${input}]/`).hostname
    .slice(1, -1)
    .toLowerCase();
  if (canonical.startsWith('::ffff:')) {
    const parts = canonical.slice(7).split(':');
    if (parts.length === 2) {
      const high = Number.parseInt(parts[0]!, 16),
        low = Number.parseInt(parts[1]!, 16);
      return [high >>> 8, high & 255, low >>> 8, low & 255].join('.');
    }
  }
  return canonical;
}
