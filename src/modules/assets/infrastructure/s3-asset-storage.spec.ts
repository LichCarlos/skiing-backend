import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { S3AssetStorage } from './s3-asset-storage.js';
import { performance } from 'node:perf_hooks';

async function fixture(
  handle: (request: IncomingMessage, response: ServerResponse) => void,
) {
  const requests: Array<{ method: string; path: string; signed: boolean }> = [];
  let closed = 0;
  const server = createServer((request, response) => {
    requests.push({
      method: request.method ?? '',
      path: request.url ?? '',
      signed:
        request.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ') ?? false,
    });
    response.once('close', () => closed++);
    request.resume();
    handle(request, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing fixture port');
  vi.stubEnv('S3_ENDPOINT', `http://127.0.0.1:${address.port}`);
  vi.stubEnv('S3_PUBLIC_ENDPOINT', 'https://assets.example.test');
  vi.stubEnv('S3_ACCESS_KEY_ID', 'test-only-access');
  vi.stubEnv('S3_SECRET_ACCESS_KEY', 'test-only-secret');
  vi.stubEnv('S3_BUCKET', 'test-assets');
  vi.stubEnv('S3_REGION', 'us-east-1');
  vi.stubEnv('S3_REQUEST_TIMEOUT_MS', '2000');
  return {
    requests,
    get closed() {
      return closed;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function put(storage: S3AssetStorage) {
  return storage.put({
    key: 'assets/7/test.png',
    body: Buffer.from('image'),
    contentType: 'image/png',
  });
}

describe('S3AssetStorage through real loopback HTTP', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('sends signed PUT and DELETE to the private endpoint', async () => {
    const api = await fixture((request, response) => {
      request.once('end', () => {
        response.writeHead(request.method === 'DELETE' ? 204 : 200);
        response.end();
      });
    });
    try {
      const storage = new S3AssetStorage();
      await put(storage);
      await storage.remove('assets/7/test.png');
      expect(
        api.requests.map(({ method, signed }) => ({ method, signed })),
      ).toEqual([
        { method: 'PUT', signed: true },
        { method: 'DELETE', signed: true },
      ]);
      expect(
        api.requests.every((r) =>
          r.path.startsWith('/test-assets/assets/7/test.png'),
        ),
      ).toBe(true);
    } finally {
      await api.close();
    }
  });

  it('signs the public endpoint offline with the existing 900-second expiry', async () => {
    const api = await fixture((_request, response) => response.end());
    try {
      const url = new URL(
        await new S3AssetStorage().createReadUrl('assets/7/test.png', 900),
      );
      expect(url.origin).toBe('https://assets.example.test');
      expect(url.pathname).toBe('/test-assets/assets/7/test.png');
      expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
      expect(api.requests).toEqual([]);
    } finally {
      await api.close();
    }
  });

  it.each([
    ['put', 'no headers'],
    ['put', 'trickling error'],
    ['remove', 'no headers'],
    ['remove', 'trickling error'],
  ] as const)(
    'bounds %s with %s and closes the actual HTTP connection',
    async (operation, mode) => {
      const api = await fixture((_request, response) => {
        if (mode === 'no headers') return;
        response.writeHead(500, { 'content-type': 'application/xml' });
        response.write('<Error>');
        const timer = setInterval(() => response.write(' '), 20);
        response.once('close', () => clearInterval(timer));
      });
      vi.stubEnv('S3_REQUEST_TIMEOUT_MS', '180');
      try {
        const storage = new S3AssetStorage();
        await expect(
          operation === 'put'
            ? put(storage)
            : storage.remove('assets/7/test.png'),
        ).rejects.toMatchObject({
          message: expect.stringMatching(/abort/i),
          $metadata: { attempts: 1 },
        });
        await vi.waitFor(() => expect(api.closed).toBe(1));
        expect(api.requests).toHaveLength(1);
      } finally {
        await api.close();
      }
    },
    1500,
  );

  it('keeps a completed deletion independent of a simultaneous stalled upload', async () => {
    const api = await fixture((request, response) => {
      if (request.method === 'DELETE') {
        response.writeHead(204);
        response.end();
      }
    });
    vi.stubEnv('S3_REQUEST_TIMEOUT_MS', '180');
    try {
      const storage = new S3AssetStorage();
      const results = await Promise.allSettled([
        put(storage),
        storage.remove('assets/7/other.png'),
      ]);
      expect(results[0]).toMatchObject({
        status: 'rejected',
        reason: { name: 'AbortError' },
      });
      expect(results[1]).toEqual({ status: 'fulfilled', value: undefined });
      await vi.waitFor(() => expect(api.closed).toBe(2));
      expect(api.requests).toHaveLength(2);
    } finally {
      await api.close();
    }
  }, 1500);

  it.each(['0', '-1', '1.5', 'NaN', '2147483648'])(
    'rejects invalid request timeout %s before creating network traffic',
    async (timeout) => {
      const api = await fixture((_request, response) => response.end());
      vi.stubEnv('S3_REQUEST_TIMEOUT_MS', timeout);
      try {
        const storage = new S3AssetStorage();
        await expect(put(storage)).rejects.toMatchObject({ status: 503 });
        await expect(storage.remove('assets/7/test.png')).rejects.toMatchObject(
          { status: 503 },
        );
        expect(api.requests).toEqual([]);
      } finally {
        await api.close();
      }
    },
  );

  it.each(['put', 'remove'] as const)(
    'does not replay %s or wait through an SDK Retry-After backoff',
    async (operation) => {
      const api = await fixture((_request, response) => {
        response.writeHead(503, {
          'content-type': 'application/xml',
          'retry-after': '2',
        });
        response.end(
          '<Error><Code>SlowDown</Code><Message>local test only</Message></Error>',
        );
      });
      vi.stubEnv('S3_REQUEST_TIMEOUT_MS', '180');
      const started = performance.now();
      try {
        const storage = new S3AssetStorage();
        await expect(
          operation === 'put'
            ? put(storage)
            : storage.remove('assets/7/test.png'),
        ).rejects.toMatchObject({
          name: 'SlowDown',
          $metadata: { attempts: 1 },
        });
        expect(performance.now() - started).toBeLessThan(1000);
        expect(api.requests).toHaveLength(1);
      } finally {
        await api.close();
      }
    },
  );
});
