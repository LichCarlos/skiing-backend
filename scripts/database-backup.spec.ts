import {
  databaseConnection,
  postgresEnvironment,
  restoreArguments,
  validateManifest,
} from './database-backup.js';

describe('database backup connection and restore boundaries', () => {
  it('decodes credentials without putting them into tool arguments', () => {
    const connection = databaseConnection(
      'postgresql://operator:p%40ss%3Aword@localhost:5433/linji_snow?schema=public&connection_limit=8',
    );
    expect(connection).toMatchObject({
      username: 'operator',
      password: 'p@ss:word',
      database: 'linji_snow',
      port: '5433',
    });
    expect(restoreArguments(connection.database).join(' ')).not.toContain(
      connection.password,
    );
  });
  it.each([
    'http://u:p@localhost/db',
    'postgresql://u@localhost/db',
    'postgresql://u:p@localhost/db%2Fother',
    'postgresql://u:p@localhost/-db',
    'postgresql://u:p@localhost/db#fragment',
    'postgresql://u:p@localhost/db?schema=private',
    'postgresql://u:p@localhost/db?options=-c%20role%3Dother',
    'postgresql://u:p@localhost/db?sslmode=invalid',
    'postgresql://u:p@localhost/db?sslmode=require&sslmode=disable',
  ])('rejects ambiguous or unsafe connection %s', (value) =>
    expect(() => databaseConnection(value)).toThrow(),
  );
  it('clears inherited libpq service, password file, options and secrets before setting explicit target', () => {
    const connection = databaseConnection(
      'postgresql://u:p@localhost/db?sslmode=verify-full&sslrootcert=C%3A%2Fca.pem',
    );
    const env = postgresEnvironment(connection, {
      PGSERVICE: 'other',
      PGSERVICEFILE: 'service.conf',
      PGOPTIONS: '-c search_path=private',
      PGPASSFILE: 'secret',
      PGPASSWORD: 'old',
      DATABASE_URL: 'private',
      BACKUP_ENCRYPTION_KEY: 'secret',
      PATH: 'toolpath',
    });
    expect(env).toEqual({
      PATH: 'toolpath',
      PGHOST: 'localhost',
      PGPORT: '5432',
      PGDATABASE: 'db',
      PGUSER: 'u',
      PGPASSWORD: 'p',
      PGCONNECT_TIMEOUT: '15',
      PGAPPNAME: 'linji-backup',
      PGSSLMODE: 'verify-full',
      PGSSLROOTCERT: 'C:/ca.pem',
    });
  });
  it('uses single-transaction restore and never cleans, drops, creates from archive, or restores owners/ACLs', () => {
    expect(restoreArguments('target')).toEqual([
      '--no-password',
      '--exit-on-error',
      '--single-transaction',
      '--no-owner',
      '--no-acl',
      '--dbname',
      'target',
    ]);
  });
  const valid = () => ({
    format: 'linji-postgresql-encrypted-backup-v1',
    createdAt: '2026-11-04T00:00:00.000Z',
    source: { host: 'localhost', port: '5432', database: 'source' },
    archive: {
      file: 'database.dump.aes256gcm',
      bytes: 100,
      sha256: 'a'.repeat(64),
    },
    encryption: {
      algorithm: 'aes-256-gcm',
      iv: 'b'.repeat(24),
      tag: 'c'.repeat(32),
    },
    pgDumpVersion: 'pg_dump (PostgreSQL) 17.11',
  });
  it('accepts the pinned format, encryption parameters and PostgreSQL tool major', () =>
    expect(validateManifest(valid())).toEqual(valid()));
  it.each([
    'archive path',
    'negative size',
    'digest',
    'IV',
    'tag',
    'algorithm',
    'version',
    'database',
    'port',
    'date',
  ])('rejects malformed manifest %s', (kind) => {
    const m = valid();
    if (kind === 'archive path') m.archive.file = '../other';
    if (kind === 'negative size') m.archive.bytes = -1;
    if (kind === 'digest') m.archive.sha256 = 'bad';
    if (kind === 'IV') m.encryption.iv = 'bad';
    if (kind === 'tag') m.encryption.tag = 'bad';
    if (kind === 'algorithm') m.encryption.algorithm = 'none';
    if (kind === 'version') m.pgDumpVersion = 'pg_dump (PostgreSQL) 16.0';
    if (kind === 'database') m.source.database = '--clean';
    if (kind === 'port') m.source.port = '65536';
    if (kind === 'date') m.createdAt = 'invalid';
    expect(() => validateManifest(m)).toThrow();
  });
});
