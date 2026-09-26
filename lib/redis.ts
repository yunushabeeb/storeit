import { createClient, type RedisClientType } from 'redis';

// One connection for the process. `connecting` collapses concurrent callers
// during startup so the first request burst does not open several clients.
const globalForRedis = globalThis as unknown as {
  redis?: RedisClientType;
  connecting?: Promise<RedisClientType>;
};

export async function getRedis() {
  if (globalForRedis.redis?.isOpen) return globalForRedis.redis;

  if (!globalForRedis.connecting) {
    const url = process.env.REDIS_URL;

    if (!url) throw new Error('REDIS_URL is not set');

    const client = createClient({ url });

    // The client emits errors asynchronously. Without a listener, Node treats
    // that as an unhandled error and can take the process down.
    client.on('error', (error) => {
      console.error('Redis error', error);
    });

    globalForRedis.connecting = client.connect().then(() => {
      globalForRedis.redis = client;
      globalForRedis.connecting = undefined;
      return client;
    });
  }

  return globalForRedis.connecting;
}
