import { ConfigService } from '@nestjs/config';
import { Kafka, logLevel } from 'kafkajs';
import { readFileSync } from 'node:fs';
import type { Socket } from 'node:net';
import { join, resolve } from 'node:path';
import { createServer } from 'node:tls';
import { kafkaClientConfig } from './kafka-client-config.js';

const fixture = resolve('test/fixtures/kafka-tls');
const ca = readFileSync(join(fixture, 'ca.pem'));
const cert = readFileSync(join(fixture, 'broker-cert.pem'));
const key = readFileSync(join(fixture, 'broker-key.pem'));

// A loopback TLS/protocol fixture, not a Kafka broker. Implements only the
// ApiVersions/PLAIN authentication exchanges needed by producer.connect().
async function broker(mutual = false) {
  const sockets = new Set<Socket>();
  const requests: number[] = [];
  const server = createServer(
    { ca, cert, key, requestCert: mutual, rejectUnauthorized: true },
    (socket) => {
      let pending = Buffer.alloc(0);
      socket.on('error', () => undefined);
      socket.on('data', (chunk) => {
        pending = Buffer.concat([pending, chunk]);
        while (
          pending.length >= 4 &&
          pending.length >= pending.readInt32BE(0) + 4
        ) {
          const size = pending.readInt32BE(0);
          const request = pending.subarray(4, size + 4);
          pending = pending.subarray(size + 4);
          const api = request.readInt16BE(0);
          requests.push(api);
          const correlation = request.readInt32BE(4);
          const body = request.subarray(10 + request.readInt16BE(8));
          let response: Buffer;
          if (api === 18) {
            // error, API array length, three API records, throttle time
            response = Buffer.alloc(28);
            response.writeInt32BE(3, 2);
            [
              [18, 0, 2],
              [17, 0, 1],
              [36, 0, 1],
            ].forEach((record, i) =>
              record.forEach((value, j) =>
                response.writeInt16BE(value, 6 + i * 6 + j * 2),
              ),
            );
          } else if (api === 17) {
            response = Buffer.alloc(13);
            response.writeInt32BE(1, 2);
            response.writeInt16BE(5, 6);
            response.write('PLAIN', 8);
          } else if (api === 36) {
            const valid =
              body.subarray(4).toString() === '\0test-user\0test-password';
            response = Buffer.alloc(16);
            response.writeInt16BE(valid ? 0 : 58, 0);
            response.writeInt16BE(-1, 2);
          } else {
            socket.destroy();
            return;
          }
          const frame = Buffer.alloc(8 + response.length);
          frame.writeInt32BE(4 + response.length, 0);
          frame.writeInt32BE(correlation, 4);
          response.copy(frame, 8);
          socket.write(frame);
        }
      });
    },
  );
  server.on('tlsClientError', () => undefined);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  return {
    requests,
    producer(values: Record<string, string> = {}) {
      return new Kafka({
        ...kafkaClientConfig(
          new ConfigService({
            KAFKA_BROKERS: `127.0.0.1:${address.port}`,
            KAFKA_TLS_ENABLED: 'true',
            KAFKA_TLS_CA_FILE: join(fixture, 'ca.pem'),
            ...values,
          }),
        ),
        connectionTimeout: 1000,
        authenticationTimeout: 1000,
        requestTimeout: 1000,
        retry: { retries: 0 },
        logLevel: logLevel.NOTHING,
      }).producer();
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

describe('KafkaJS transport with actual loopback TLS', () => {
  it('accepts a trusted TLS peer and completes ApiVersions', async () => {
    const server = await broker();
    const producer = server.producer();
    try {
      await producer.connect();
      expect(server.requests).toContain(18);
    } finally {
      await producer.disconnect();
      await server.close();
    }
  });
  it('rejects an untrusted peer before any protocol request', async () => {
    const server = await broker();
    const producer = server.producer({ KAFKA_TLS_CA_FILE: '' });
    try {
      await expect(producer.connect()).rejects.toThrow();
      expect(server.requests).toEqual([]);
    } finally {
      await producer.disconnect();
      await server.close();
    }
  });
  it('connects to a peer requiring a trusted client certificate', async () => {
    const server = await broker(true);
    const producer = server.producer({
      KAFKA_TLS_CERT_FILE: join(fixture, 'broker-cert.pem'),
      KAFKA_TLS_KEY_FILE: join(fixture, 'broker-key.pem'),
    });
    try {
      await producer.connect();
      expect(server.requests).toContain(18);
    } finally {
      await producer.disconnect();
      await server.close();
    }
  });
  it('rejects a missing client identity when mutual TLS is required', async () => {
    const server = await broker(true);
    const producer = server.producer();
    try {
      await expect(producer.connect()).rejects.toThrow();
      expect(server.requests).toEqual([]);
    } finally {
      await producer.disconnect();
      await server.close();
    }
  });
  it.each([true, false])(
    'authenticates PLAIN credentials over TLS (valid=%s)',
    async (valid) => {
      const server = await broker();
      const producer = server.producer({
        KAFKA_SASL_MECHANISM: 'plain',
        KAFKA_SASL_USERNAME: 'test-user',
        KAFKA_SASL_PASSWORD: valid ? 'test-password' : 'wrong-password',
      });
      try {
        if (valid) await producer.connect();
        else await expect(producer.connect()).rejects.toThrow();
        expect(server.requests).toEqual([18, 17, 36]);
      } finally {
        await producer.disconnect();
        await server.close();
      }
    },
  );
});
