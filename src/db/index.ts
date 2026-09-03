import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, PoolConfig } from 'pg';
import dotenv from 'dotenv';
import * as schema from './schema.ts';

dotenv.config();

declare global {
  var _postgresPool: Pool | null | undefined;
}

let cloudSqlHealthy: boolean = false;

export const markCloudSqlUnavailable = (reason?: any) => {
  cloudSqlHealthy = false;
  if (reason) {
    console.log('ℹ️ PostgreSQL / Supabase is currently not reachable or unprovisioned; falling back to SQLite + Cache.');
    console.warn('PostgreSQL connection notice:', reason?.message || reason);
  }
};

export const isCloudSqlHealthy = (): boolean => {
  return cloudSqlHealthy === true;
};

function cleanConnectionString(urlStr?: string): string | undefined {
  if (!urlStr) return undefined;
  const trimmed = urlStr.trim();
  if (!trimmed) return undefined;
  // If user pasted postgresql://user:[password]@host:5432/db, strip brackets from password
  return trimmed.replace(/(:\/\/[^:]+:)?\[([^\]]+)\](@)/, '$1$2$3');
}

export const isCloudSqlConfigured = (): boolean => {
  if (cloudSqlHealthy === false) {
    return false;
  }

  const rawUrl = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
  if (rawUrl && rawUrl.trim().length > 0) {
    return true;
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
      const rawUrl = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
      const connectionString = cleanConnectionString(rawUrl);

      let poolConfig: PoolConfig;

      if (connectionString) {
        poolConfig = {
          connectionString,
          ssl: { rejectUnauthorized: false },
          max: 10,
          connectionTimeoutMillis: 5000,
          idleTimeoutMillis: 30000,
        };
      } else {
        poolConfig = {
          host: process.env.SQL_HOST,
          user: process.env.SQL_USER,
          password: process.env.SQL_PASSWORD,
          database: process.env.SQL_DB_NAME,
          port: Number(process.env.SQL_PORT) || 5432,
          ssl: process.env.SQL_SSL === 'true' || process.env.SQL_HOST?.includes('supabase') ? { rejectUnauthorized: false } : undefined,
          max: 5,
          connectionTimeoutMillis: 5000,
          idleTimeoutMillis: 30000,
        };
      }

      global._postgresPool = new Pool(poolConfig);

      global._postgresPool.on('error', (err) => {
        markCloudSqlUnavailable(err);
      });

      // Quick sanity check and ensure relational schema & indexes
      global._postgresPool.query('SELECT 1').then(async () => {
        cloudSqlHealthy = true;
        console.log('✅ Supabase PostgreSQL connection verified and active.');
        await ensureSupabaseSchema(global._postgresPool!);
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

export async function ensureSupabaseSchema(p: Pool): Promise<void> {
  try {
    const ddl = `
      CREATE TABLE IF NOT EXISTS system_config (
        key text PRIMARY KEY,
        value text NOT NULL,
        updated_at text NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sites (
        id text PRIMARY KEY,
        nombre text NOT NULL,
        direccion text,
        latitude double precision,
        longitude double precision,
        radius_meters double precision,
        hora_entrada text,
        hora_salida text,
        tolerancia_minutos integer,
        data_json text,
        updated_at text NOT NULL
      );

      CREATE TABLE IF NOT EXISTS students (
        id text PRIMARY KEY,
        matricula text NOT NULL UNIQUE,
        nombre text NOT NULL,
        email text,
        especialidad text,
        rotacion text,
        grupo text,
        equipo text,
        activo integer DEFAULT 1,
        sede_id text,
        sede_nombre text,
        secondary_sede_id text,
        secondary_sede_nombre text,
        hora_entrada text,
        hora_salida text,
        tolerancia_minutos integer,
        dias_asistencia text,
        horarios_por_dia text,
        linked_device_id text,
        linked_device_name text,
        linked_at text,
        data_json text,
        updated_at text NOT NULL
      );

      CREATE TABLE IF NOT EXISTS attendance_records (
        id text PRIMARY KEY,
        student_id text,
        matricula text,
        student_nombre text,
        grupo text,
        equipo text,
        site_id text,
        site_nombre text,
        fecha text NOT NULL,
        tipo text NOT NULL,
        hora_registrada text NOT NULL,
        estado text NOT NULL,
        hora_esperada text,
        tolerancia_minutos integer,
        minutos_diferencia integer,
        latitude double precision,
        longitude double precision,
        distance_meters double precision,
        accuracy_meters double precision,
        dentro_de_zona integer,
        device_id text,
        device_name text,
        verificado_por_gps integer,
        es_justificada integer DEFAULT 0,
        motivo_justificante text,
        data_json text,
        created_at text NOT NULL
      );

      CREATE TABLE IF NOT EXISTS holidays (
        fecha text PRIMARY KEY,
        descripcion text NOT NULL,
        creado_por text,
        fecha_creacion text
      );

      -- Relational performance indexes on Supabase (optimizes Disk IO and cuts Egress)
      CREATE INDEX IF NOT EXISTS idx_records_matricula ON attendance_records(matricula);
      CREATE INDEX IF NOT EXISTS idx_records_matricula_fecha ON attendance_records(matricula, fecha DESC);
      CREATE INDEX IF NOT EXISTS idx_records_fecha ON attendance_records(fecha DESC);
      CREATE INDEX IF NOT EXISTS idx_records_estado ON attendance_records(estado);
      CREATE INDEX IF NOT EXISTS idx_records_grupo ON attendance_records(grupo);
      CREATE INDEX IF NOT EXISTS idx_records_site_id ON attendance_records(site_id);
      CREATE INDEX IF NOT EXISTS idx_students_matricula ON students(matricula);
      CREATE INDEX IF NOT EXISTS idx_students_grupo ON students(grupo);
      CREATE INDEX IF NOT EXISTS idx_students_activo ON students(activo);
      CREATE INDEX IF NOT EXISTS idx_students_sede_id ON students(sede_id);
    `;
    await p.query(ddl);
    console.log('⚡ Supabase PostgreSQL relational schema & indexes verified.');
  } catch (err: any) {
    console.warn('Notice verifying Supabase schema & indexes:', err?.message || err);
  }
}

const pool = createPool();

export const db: NodePgDatabase<typeof schema> | null = pool ? drizzle(pool, { schema }) : null;
export { pool };



