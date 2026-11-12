import { resolve } from 'node:path';
import {
  outsideRepository,
  recoveryEnvironment,
  recoverySettings,
} from './validate-database-recovery.js';

describe('independent recovery rehearsal boundaries', () => {
  const configured = () => ({
    LINJI_DATABASE_RECOVERY_CONFIRM: 'synthetic-new-clusters-only',
    LINJI_DATABASE_RECOVERY_PG_BIN: resolve('native-postgres/bin'),
    LINJI_DATABASE_RECOVERY_OUTPUT: resolve('recovery-output'),
  });
  it('requires explicit opt-in before making a directory or starting a process', () => {
    expect(() => recoverySettings({})).toThrow('confirmation');
  });
  it('resolves only the explicit tools and output configuration, never DATABASE_URL', () => {
    const env = {
      ...configured(),
      DATABASE_URL: 'postgresql://private:secret@production/business',
    };
    expect(recoverySettings(env)).toEqual({
      pgBin: env.LINJI_DATABASE_RECOVERY_PG_BIN,
      outputParent: env.LINJI_DATABASE_RECOVERY_OUTPUT,
    });
  });
  it.each([
    'relative/path',
    '"quoted"',
    "'quoted'",
    'line\nbreak',
    'line\rbreak',
    'zero\0byte',
  ])('rejects invalid tool/output path %j', (value) => {
    expect(() =>
      recoverySettings({
        ...configured(),
        LINJI_DATABASE_RECOVERY_PG_BIN: value,
      }),
    ).toThrow();
    expect(() =>
      recoverySettings({
        ...configured(),
        LINJI_DATABASE_RECOVERY_OUTPUT: value,
      }),
    ).toThrow();
  });
  it('requires both paths', () => {
    expect(() =>
      recoverySettings({
        ...configured(),
        LINJI_DATABASE_RECOVERY_PG_BIN: undefined,
      }),
    ).toThrow();
    expect(() =>
      recoverySettings({
        ...configured(),
        LINJI_DATABASE_RECOVERY_OUTPUT: undefined,
      }),
    ).toThrow();
  });
  it('removes inherited database, libpq, Prisma engine overrides and secrets without mutating the caller', () => {
    const original = {
      DATABASE_URL: 'private',
      database_url: 'private-case',
      BACKUP_ENCRYPTION_KEY: 'private',
      PGSERVICE: 'production',
      PGOPTIONS: '-c role=other',
      PGPASSWORD: 'private',
      PRISMA_QUERY_ENGINE_LIBRARY: 'outside-node-modules',
      PRISMA_SCHEMA_ENGINE_BINARY: 'outside-schema',
      INITIAL_ADMIN_PASSWORD: 'private',
      INITIAL_ADMIN_ACCOUNT: 'private',
      NODE_PATH: 'parent/node_modules',
      PATH: 'native-bin',
      NODE_OPTIONS: '--max-old-space-size=1536',
    };
    expect(recoveryEnvironment(original)).toEqual({
      PATH: 'native-bin',
      NODE_OPTIONS: '--max-old-space-size=1536',
    });
    expect(original.PGSERVICE).toBe('production');
  });
  it('rejects repository itself, child and sibling names that only share a prefix', () => {
    const root = resolve('backend');
    expect(outsideRepository(root, root)).toBe(false);
    expect(outsideRepository(root, resolve(root, 'backups'))).toBe(false);
    expect(outsideRepository(root, resolve('backend-copy'))).toBe(true);
    expect(outsideRepository(root, resolve('outside', 'runs'))).toBe(true);
  });
});
