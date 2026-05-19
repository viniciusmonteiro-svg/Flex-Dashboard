import { Pool, PoolClient } from 'pg';
import { getEnvOrThrow } from '@/lib/env';

declare global {
  // eslint-disable-next-line no-var
  var __pg_pool: Pool | undefined;
}

export function getPoolInstance(): Pool {
  if (!globalThis.__pg_pool) {
    globalThis.__pg_pool = new Pool({
      connectionString: getEnvOrThrow('DATABASE_URL'),
      max: 10,
    });
  }
  return globalThis.__pg_pool;
}

export async function withConnection<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPoolInstance().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
