import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { connect } from 'node:net';
import { performance } from 'node:perf_hooks';
import type { AssetScanner } from '../application/ports/asset-scanner.js';

@Injectable()
export class ClamAvAssetScanner implements AssetScanner {
  async scan(buffer: Buffer): Promise<'clean' | 'infected'> {
    const host = process.env.CLAMAV_HOST?.trim();
    const port = Number(process.env.CLAMAV_PORT ?? 3310);
    const timeout = Number(process.env.CLAMAV_TIMEOUT_MS ?? 15_000);
    if (
      !host ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      !Number.isSafeInteger(timeout) ||
      timeout < 1 ||
      timeout > 2_147_483_647
    ) {
      throw new ServiceUnavailableException('ClamAV scanner is not configured');
    }

    return new Promise((resolve, reject) => {
      const startedAt = performance.now();
      const socket = connect({ host, port });
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let response = '';
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        socket.destroy();
        reject(
          new ServiceUnavailableException(
            `ClamAV scan failed: ${error.message}`,
          ),
        );
      };
      // socket.setTimeout is only an inactivity timeout and can be extended by
      // a trickling peer. This deadline covers connect, upload and response.
      const expired = () => {
        if (performance.now() - startedAt < timeout) return false;
        fail(new Error('scan timed out'));
        return true;
      };
      deadline = setTimeout(() => fail(new Error('scan timed out')), timeout);
      socket.once('connect', () => {
        if (settled || expired()) return;
        socket.write(Buffer.from('zINSTREAM\0', 'ascii'));
        for (let offset = 0; offset < buffer.length; offset += 64 * 1024) {
          const chunk = buffer.subarray(
            offset,
            Math.min(offset + 64 * 1024, buffer.length),
          );
          const size = Buffer.allocUnsafe(4);
          size.writeUInt32BE(chunk.length);
          socket.write(size);
          socket.write(chunk);
        }
        const end = Buffer.alloc(4);
        socket.end(end);
      });
      socket.on('data', (data) => {
        if (settled || expired()) return;
        response += data.toString('utf8');
        if (Buffer.byteLength(response) > 8192) {
          fail(new Error('scanner response exceeds the limit'));
          return;
        }
        if (!response.includes('\0')) return;
        settled = true;
        clearTimeout(deadline);
        socket.destroy();
        const reply = response.slice(0, response.indexOf('\0'));
        if (reply === 'stream: OK') resolve('clean');
        else if (/^stream: .+ FOUND$/.test(reply)) resolve('infected');
        else
          reject(
            new ServiceUnavailableException(
              'ClamAV returned an invalid scan response',
            ),
          );
      });
      socket.once('error', fail);
      socket.once('end', () =>
        fail(new Error('scanner ended before a complete response')),
      );
      socket.once('close', () =>
        fail(new Error('scanner closed before a complete response')),
      );
    });
  }
}
