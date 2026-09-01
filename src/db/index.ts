import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | null | undefined;
}

let cloudSqlHealthy: boolean | null = null;

export const markCloudSqlUnavailable = (reason?: any) => {
  if (cloudSqlHealthy !== false) {
    cloudSqlHealthy = false;
    if (reason) {
      console.log('ℹ️ Cloud SQL is currently not reachable or unprovisioned; falling back to SQLite + Google Cloud Firestore.');
    }
  }
};

export const isCloudSqlConfigured = (): boolean => {
  if (cloudSqlHealthy === false) {
    return false;
  }
  const host = process.env.SQL_HOST;
  const user = process.env.SQL_USER;
  const dbName = process.env.SQL_DB_NAME;

  if (!host || !user || !dbName) {
    return false;
  }

  // If host is an unconfigured default or loopback without explicit flag
  if ((host === '127.0.0.1' || host === 'localhost') && process.env.ENABLE_CLOUDSQL !== 'true') {
    return false;
  }

  return true;
};

export const createPool = (): Pool | null => {
  if (!isCloudSqlConfigured()) {
    return null;
  }

  if (global._postgresPool === undefined) {
    try {
      global._postgresPool = new Pool({
        host: process.env.SQL_HOST,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DB_NAME,
        max: 3,
        connectionTimeoutMillis: 2000,
        idleTimeoutMillis: 10000,
      });

      global._postgresPool.on('error', (err) => {
        markCloudSqlUnavailable(err);
      });

      // Quick non-blocking sanity check
      global._postgresPool.query('SELECT 1').then(() => {
        cloudSqlHealthy = true;
        console.log('✅ Cloud SQL PostgreSQL connection verified.');
      }).catch((err) => {
        markCloudSqlUnavailable(err);
      });
    } catch (err) {
      markCloudSqlUnavailable(err);
      global._postgresPool = null;
    }
  }
  return global._postgresPool;
};

const pool = createPool();

export const db: NodePgDatabase<typeof schema> | null = pool ? drizzle(pool, { schema }) : null;
export { pool };


