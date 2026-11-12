import { randomBytes } from 'node:crypto';

// Per-suite synthetic namespace keeps unrelated disposable fixtures isolated.
// Production has no default; missing-key tests explicitly remove this value.
process.env.LOGIN_RATE_LIMIT_SECRET = randomBytes(32).toString('hex');
