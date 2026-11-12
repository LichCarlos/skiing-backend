import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClamAvAssetScanner } from './clamav-asset-scanner.js';

describe('ClamAvAssetScanner', () => {
  let server: Server | undefined;
  const sockets = new Set<Socket>();

  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    if (!server?.listening) return;
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
    server = undefined;
  });

  async function listen(handle: (socket: Socket) => void) {
    server = createServer({ allowHalfOpen: true }, (socket) => {
      sockets.add(socket);
      socket.on('error', () => undefined);
      handle(socket);
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Test server did not bind');
    vi.stubEnv('CLAMAV_HOST', '127.0.0.1');
    vi.stubEnv('CLAMAV_PORT', String(address.port));
    vi.stubEnv('CLAMAV_TIMEOUT_MS', '2000');
  }

  it.each(['', 'stream: OK'])(
    'rejects a closed connection with an incomplete response %j',
    async (reply) => {
      await listen((socket) => {
        socket.resume();
        socket.on('end', () => socket.end(reply));
      });
      await expect(
        new ClamAvAssetScanner().scan(Buffer.from('image')),
      ).rejects.toMatchObject({ status: 503 });
    },
  );

  it.each([
    'stream: OK invalid\0',
    'arbitrary OK\0',
    'stream: ERROR\0',
    'x'.repeat(8193),
  ])(
    'fails closed on malformed or oversized scanner replies',
    async (reply) => {
      await listen((socket) => {
        socket.resume();
        socket.on('end', () => socket.end(reply));
      });
      await expect(
        new ClamAvAssetScanner().scan(Buffer.from('image')),
      ).rejects.toMatchObject({ status: 503 });
    },
  );

  it('accepts a valid response fragmented across TCP packets', async () => {
    await listen((socket) => {
      socket.resume();
      socket.on('end', () => {
        socket.write('stream: ');
        setImmediate(() => socket.end('OK\0'));
      });
    });
    await expect(
      new ClamAvAssetScanner().scan(Buffer.from('image')),
    ).resolves.toBe('clean');
  });

  it('times out a scanner that never replies', async () => {
    await listen((socket) => socket.resume());
    vi.stubEnv('CLAMAV_TIMEOUT_MS', '25');
    await expect(
      new ClamAvAssetScanner().scan(Buffer.from('image')),
    ).rejects.toMatchObject({ status: 503 });
  });

  it.each([
    'stream: OK\0',
    'stream: Slow-Test-Signature FOUND\0',
    'stream: incomplete without terminator',
  ])(
    'enforces a total deadline even when the scanner keeps sending %j',
    async (reply) => {
      let received = 0,
        closed = false;
      await listen((socket) => {
        socket.resume();
        socket.on('end', () => {
          let index = 0;
          const timer = setInterval(() => {
            if (index < reply.length) {
              socket.write(reply[index++]!);
              received++;
            } else {
              clearInterval(timer);
              socket.end();
            }
          }, 30);
          socket.once('close', () => {
            clearInterval(timer);
            closed = true;
          });
        });
      });
      vi.stubEnv('CLAMAV_TIMEOUT_MS', '180');
      await expect(
        new ClamAvAssetScanner().scan(Buffer.from('image')),
      ).rejects.toMatchObject({
        status: 503,
        message: expect.stringContaining('timed out'),
      });
      await vi.waitFor(() => expect(closed).toBe(true));
      expect(received).toBeGreaterThan(0);
      expect(received).toBeLessThan(reply.length);
    },
  );

  it('keeps a short scan independent from a concurrent scan which exceeds its deadline', async () => {
    let connections = 0;
    await listen((socket) => {
      const short = connections++ === 0;
      socket.resume();
      socket.on('end', () => {
        if (short) socket.end('stream: OK\0');
        else {
          const timer = setInterval(() => socket.write('s'), 20);
          socket.once('close', () => clearInterval(timer));
        }
      });
    });
    vi.stubEnv('CLAMAV_TIMEOUT_MS', '180');
    const results = await Promise.allSettled([
      new ClamAvAssetScanner().scan(Buffer.from('short')),
      new ClamAvAssetScanner().scan(Buffer.from('slow')),
    ]);
    expect(results[0]).toEqual({ status: 'fulfilled', value: 'clean' });
    expect(results[1]).toMatchObject({
      status: 'rejected',
      reason: { status: 503, message: expect.stringContaining('timed out') },
    });
  });

  it.each(['0', '-1', '1.5', 'NaN', '2147483648'])(
    'rejects invalid total timeout %s before opening a connection',
    async (timeout) => {
      let connections = 0;
      await listen((socket) => {
        connections++;
        socket.resume();
      });
      vi.stubEnv('CLAMAV_TIMEOUT_MS', timeout);
      await expect(
        new ClamAvAssetScanner().scan(Buffer.from('image')),
      ).rejects.toMatchObject({ status: 503 });
      expect(connections).toBe(0);
    },
  );

  it.each([
    ['stream: OK\0', 'clean'],
    ['stream: Eicar-Test-Signature FOUND\0', 'infected'],
  ] as const)(
    'parses the ClamAV INSTREAM response as %s',
    async (response, expected) => {
      const received: Buffer[] = [];
      server = createServer((socket) => {
        socket.on('data', (chunk) => received.push(Buffer.from(chunk)));
        socket.on('end', () => socket.end(response));
      });
      await new Promise<void>((resolve) =>
        server!.listen(0, '127.0.0.1', resolve),
      );
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('TCP test server did not bind');
      vi.stubEnv('CLAMAV_HOST', '127.0.0.1');
      vi.stubEnv('CLAMAV_PORT', String(address.port));
      vi.stubEnv('CLAMAV_TIMEOUT_MS', '2000');

      const file = Buffer.from('test-image-bytes');
      await expect(new ClamAvAssetScanner().scan(file)).resolves.toBe(expected);
      const request = Buffer.concat(received);
      expect(request.subarray(0, 10).toString('ascii')).toBe('zINSTREAM\0');
      expect(request.includes(file)).toBe(true);
      expect(request.subarray(-4)).toEqual(Buffer.alloc(4));
    },
  );
});
