import { connect, type Socket } from 'node:net';

// ClamAV's INSTREAM command accepts chunks prefixed by a 4-byte big-endian
// length. 64KB matches the size the daemon expects to read in one piece.
const CHUNK_SIZE = 64 * 1024;

type ScanBody = Buffer | AsyncIterable<Uint8Array>;

// Waits for drain when the kernel buffer is full. Without that wait, a large
// file would queue the whole scan in memory and defeat streaming.
function writeChunk(socket: Socket, data: Buffer) {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      socket.off('drain', onDrain);
      reject(error);
    };
    const onDrain = () => {
      socket.off('error', onError);
      resolve();
    };

    socket.once('error', onError);

    if (socket.write(data)) {
      socket.off('error', onError);
      resolve();
      return;
    }

    socket.once('drain', onDrain);
  });
}

async function* pieces(body: ScanBody) {
  if (Buffer.isBuffer(body)) {
    yield body;
    return;
  }

  for await (const chunk of body) {
    yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  }
}

function verdict(raw: string) {
  // zINSTREAM replies are null-terminated, for example "stream: OK\0".
  // trim() does not remove that null, and treating it as a failure made every
  // clean file look like a scanner outage.
  const reply = raw.replace(/\0/g, '').trim();

  if (reply.endsWith('OK')) return { clean: true as const };

  if (reply.includes('FOUND')) {
    return {
      clean: false as const,
      signature: reply.replace(/^stream:\s*/, '').replace(/\s+FOUND$/, ''),
    };
  }

  throw new Error(reply || 'Malware scanner returned an empty response');
}

export async function scanBytes(body: ScanBody) {
  const host = process.env.CLAMAV_HOST;
  const port = Number(process.env.CLAMAV_PORT || 3310);

  if (!host) {
    // Production refuses the upload when scanning is not configured. A local
    // demo without ClamAV may continue, and the warning is the record of that.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Malware scanning is not configured');
    }

    console.warn('[storeit] CLAMAV_HOST is unset. Upload accepted without a scan.');
    return { clean: true as const };
  }

  const reply = await new Promise<string>((resolve, reject) => {
    const socket = connect({ host, port });
    const parts: Buffer[] = [];
    let settled = false;
    const finish = (handler: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      handler();
    };
    const timer = setTimeout(() => {
      socket.destroy();
      finish(() => reject(new Error('Malware scanner timed out')));
    }, 60_000);

    socket.on('data', (chunk) => {
      parts.push(chunk);

      if (Buffer.concat(parts).includes(0)) {
        socket.destroy();
        finish(() => resolve(Buffer.concat(parts).toString('utf8')));
      }
    });
    socket.on('error', (error) => {
      socket.destroy();
      finish(() => reject(error));
    });
    socket.on('connect', () => {
      void (async () => {
        try {
          await writeChunk(socket, Buffer.from('zINSTREAM\0'));

          for await (const slice of pieces(body)) {
            for (let offset = 0; offset < slice.length; offset += CHUNK_SIZE) {
              const part = slice.subarray(offset, offset + CHUNK_SIZE);
              const size = Buffer.alloc(4);
              size.writeUInt32BE(part.length);
              await writeChunk(socket, size);
              await writeChunk(socket, part);
            }
          }

          // A zero length ends the stream. The socket stays open for the reply.
          // Ending it here makes clamd close without sending "stream: OK".
          await writeChunk(socket, Buffer.alloc(4));
        } catch (error) {
          socket.destroy();
          finish(() =>
            reject(error instanceof Error ? error : new Error('Malware scan failed')),
          );
        }
      })();
    });
    socket.on('close', () => {
      finish(() => resolve(Buffer.concat(parts).toString('utf8')));
    });
  });

  return verdict(reply);
}
