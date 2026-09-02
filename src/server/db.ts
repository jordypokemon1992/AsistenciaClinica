import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { db as pgDb, isCloudSqlConfigured, markCloudSqlUnavailable } from '../db/index.ts';
import {
  students as pgStudents,
  sites as pgSites,
  attendanceRecords as pgAttendanceRecords,
  systemConfig as pgSystemConfig,
  holidays as pgHolidays,
} from '../db/schema.ts';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import {
  syncStudentToFirestore,
  syncMultipleStudentsToFirestore,
  deleteStudentFromFirestore,
  syncSiteToFirestore,
  deleteSiteFromFirestore,
  syncRecordToFirestore,
  syncMultipleRecordsToFirestore,
  deleteRecordFromFirestore,
  syncHolidayToFirestore,
  deleteHolidayFromFirestore,
  syncConfigToFirestore,
  syncAllToFirestore,
  pullFromFirestoreToCache,
  isFirestoreConfigured,
} from './firestore.ts';

const DATA_DIR = path.join(process.cwd(), 'data');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const DB_FILE = path.join(DATA_DIR, 'clinicas.db');
const JSON_STATE_FILE = path.join(DATA_DIR, 'app_state.json');
const ROOT_JSON_STATE_FILE = path.join(process.cwd(), 'app_state.json');

let db: Database | null = null;
let isSaving = false;
let saveDebounceTimer: NodeJS.Timeout | null = null;
let pgInitialized = false;

// Creates an automatic timestamped backup of clinicas.db and app_state.json before restoring
export function createAutoBackupBeforeRestore(): string | null {
  if (!db) return null;
  try {
    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDbFile = path.join(BACKUPS_DIR, `clinicas_backup_${timestamp}.db`);
    const backupJsonFile = path.join(BACKUPS_DIR, `app_state_backup_${timestamp}.json`);

    const data = db.export();
    fs.writeFileSync(backupDbFile, Buffer.from(data));

    const fullState = getAllDataSnapshot();
    fs.writeFileSync(backupJsonFile, JSON.stringify(fullState, null, 2), 'utf-8');

    console.log(`🛡️ Auto-backup created before restore: clinicas_backup_${timestamp}.db`);

    try {
      const files = fs.readdirSync(BACKUPS_DIR);
      const dbBackups = files
        .filter((f) => f.startsWith('clinicas_backup_') && f.endsWith('.db'))
        .map((f) => ({ name: f, time: fs.statSync(path.join(BACKUPS_DIR, f)).mtimeMs }))
        .sort((a, b) => b.time - a.time);

      if (dbBackups.length > 25) {
        for (const old of dbBackups.slice(25)) {
          try {
            fs.unlinkSync(path.join(BACKUPS_DIR, old.name));
            const pairedJson = old.name.replace('clinicas_backup_', 'app_state_backup_').replace('.db', '.json');
            if (fs.existsSync(path.join(BACKUPS_DIR, pairedJson))) {
              fs.unlinkSync(path.join(BACKUPS_DIR, pairedJson));
            }
          } catch {}
        }
      }
    } catch {}

    return `clinicas_backup_${timestamp}.db`;
  } catch (err) {
    console.error('⚠️ Error creating auto-backup before restore:', err);
    return null;
  }
}

// Migrate data from local snapshot/sqlite into Cloud SQL PostgreSQL
async function syncToPostgreSql() {
  if (!isCloudSqlConfigured() || !pgDb) return;
  try {
    console.log('🔄 Checking and synchronizing state with Cloud SQL PostgreSQL...');
    const snapshot = getAllDataSnapshot();

    // Check existing count in postgres
    const existingStudents = await pgDb.select({ id: pgStudents.id }).from(pgStudents);
    console.log(`📊 Cloud SQL current students count: ${existingStudents.length}, local students count: ${snapshot.students.length}`);

    if (existingStudents.length === 0 && snapshot.students.length > 0) {
      console.log('🚀 Migrating initial student catalog to Cloud SQL PostgreSQL...');
      for (const st of snapshot.students) {
        if (!st || !st.matricula) continue;
        try {
          await pgDb
            .insert(pgStudents)
            .values({
              id: st.id || `std-${st.matricula}`,
              matricula: String(st.matricula).trim(),
              nombre: st.nombre || '',
              email: st.email || '',
              especialidad: st.especialidad || st.rotacion || 'Urgencias Médicas',
              rotacion: st.rotacion || st.especialidad || 'Urgencias Médicas',
              grupo: st.grupo || '10 A',
              equipo: st.equipo || 'Equipo 1',
              activo: st.activo !== false ? 1 : 0,
              sedeId: st.sedeId || 'site-1',
              sedeNombre: st.sedeNombre || 'Hospital General Los Mochis',
              secondarySedeId: st.secondarySedeId || null,
              secondarySedeNombre: st.secondarySedeNombre || null,
              horaEntrada: st.horaEntrada || '07:00',
              horaSalida: st.horaSalida || '15:00',
              toleranciaMinutos: st.toleranciaMinutos || 15,
              diasAsistencia: JSON.stringify(st.diasAsistencia || []),
              horariosPorDia: JSON.stringify(st.horariosPorDia || []),
              linkedDeviceId: st.linkedDeviceId || null,
              linkedDeviceName: st.linkedDeviceName || null,
              linkedAt: st.linkedAt || null,
              dataJson: JSON.stringify(st),
              updatedAt: st.updatedAt || new Date().toISOString(),
            })
            .onConflictDoUpdate({
              target: pgStudents.matricula,
              set: {
                nombre: st.nombre || '',
                email: st.email || '',
                especialidad: st.especialidad || st.rotacion || 'Urgencias Médicas',
                rotacion: st.rotacion || st.especialidad || 'Urgencias Médicas',
                grupo: st.grupo || '10 A',
                equipo: st.equipo || 'Equipo 1',
                activo: st.activo !== false ? 1 : 0,
                sedeId: st.sedeId || 'site-1',
                sedeNombre: st.sedeNombre || 'Hospital General Los Mochis',
                secondarySedeId: st.secondarySedeId || null,
                secondarySedeNombre: st.secondarySedeNombre || null,
                horaEntrada: st.horaEntrada || '07:00',
                horaSalida: st.horaSalida || '15:00',
                toleranciaMinutos: st.toleranciaMinutos || 15,
                diasAsistencia: JSON.stringify(st.diasAsistencia || []),
                horariosPorDia: JSON.stringify(st.horariosPorDia || []),
                linkedDeviceId: st.linkedDeviceId || null,
                linkedDeviceName: st.linkedDeviceName || null,
                linkedAt: st.linkedAt || null,
                dataJson: JSON.stringify(st),
                updatedAt: st.updatedAt || new Date().toISOString(),
              },
            });
        } catch (stErr) {
          console.warn(`Warning inserting student ${st.matricula} to Cloud SQL:`, stErr);
        }
      }
      console.log('✅ Students migrated to Cloud SQL PostgreSQL.');
    }

    // Sync Sites
    if (snapshot.sites.length > 0) {
      for (const s of snapshot.sites) {
        if (!s || !s.id) continue;
        try {
          await pgDb
            .insert(pgSites)
            .values({
              id: s.id,
              nombre: s.nombre || '',
              direccion: s.direccion || '',
              latitude: Number(s.latitude) || 0,
              longitude: Number(s.longitude) || 0,
              radiusMeters: Number(s.radiusMeters) || 150,
              horaEntrada: s.horaEntrada || '07:00',
              horaSalida: s.horaSalida || '15:00',
              toleranciaMinutos: Number(s.toleranciaMinutos) || 15,
              dataJson: JSON.stringify(s),
              updatedAt: s.updatedAt || new Date().toISOString(),
            })
            .onConflictDoUpdate({
              target: pgSites.id,
              set: {
                nombre: s.nombre || '',
                direccion: s.direccion || '',
                latitude: Number(s.latitude) || 0,
                longitude: Number(s.longitude) || 0,
                radiusMeters: Number(s.radiusMeters) || 150,
                horaEntrada: s.horaEntrada || '07:00',
                horaSalida: s.horaSalida || '15:00',
                toleranciaMinutos: Number(s.toleranciaMinutos) || 15,
                dataJson: JSON.stringify(s),
                updatedAt: s.updatedAt || new Date().toISOString(),
              },
            });
        } catch (siteErr) {
          console.warn(`Warning inserting site ${s.id} to Cloud SQL:`, siteErr);
        }
      }
    }

    // Sync Attendance Records
    const existingRecords = await pgDb.select({ id: pgAttendanceRecords.id }).from(pgAttendanceRecords);
    if (existingRecords.length === 0 && snapshot.records.length > 0) {
      console.log(`🚀 Migrating ${snapshot.records.length} historical attendance records to Cloud SQL PostgreSQL...`);
      for (const r of snapshot.records) {
        if (!r || !r.id) continue;
        try {
          const resolvedEstado = (r.esJustificada || r.checkInStatus === 'JUSTIFICADA' || r.estado === 'JUSTIFICADA')
            ? 'JUSTIFICADA'
            : (r.checkInStatus || r.estado || 'A_TIEMPO');

          await pgDb
            .insert(pgAttendanceRecords)
            .values({
              id: r.id,
              studentId: r.studentId || '',
              matricula: r.matricula ? String(r.matricula).trim() : '',
              studentNombre: r.studentNombre || '',
              grupo: r.grupo || '',
              equipo: r.equipo || '',
              siteId: r.siteId || '',
              siteNombre: r.siteNombre || '',
              fecha: r.fecha || '',
              tipo: r.tipo || (resolvedEstado === 'JUSTIFICADA' ? 'JUSTIFICANTE' : 'ENTRADA'),
              horaRegistrada: r.horaRegistrada || '',
              estado: resolvedEstado,
              horaEsperada: r.horaEsperada || '',
              toleranciaMinutos: Number(r.toleranciaMinutos) || 15,
              minutosDiferencia: Number(r.minutosDiferencia) || 0,
              latitude: Number(r.latitude) || 0,
              longitude: Number(r.longitude) || 0,
              distanceMeters: Number(r.distanceMeters) || 0,
              accuracyMeters: Number(r.accuracyMeters) || 0,
              dentroDeZona: r.dentroDeZona ? 1 : 0,
              deviceId: r.deviceId || '',
              deviceName: r.deviceName || '',
              verificadoPorGPS: r.verificadoPorGPS ? 1 : 0,
              esJustificada: (r.esJustificada || resolvedEstado === 'JUSTIFICADA') ? 1 : 0,
              motivoJustificante: r.motivoJustificante || '',
              dataJson: JSON.stringify(r),
              createdAt: r.fecha || new Date().toISOString(),
            })
            .onConflictDoNothing();
        } catch (recErr) {
          console.warn(`Warning inserting record ${r.id} to Cloud SQL:`, recErr);
        }
      }
      console.log('✅ Attendance records migrated to Cloud SQL PostgreSQL.');
    }

    // Sync System Config
    if (snapshot.masterConfig) {
      await pgDb
        .insert(pgSystemConfig)
        .values({
          key: 'masterConfig',
          value: JSON.stringify(snapshot.masterConfig),
          updatedAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: pgSystemConfig.key,
          set: {
            value: JSON.stringify(snapshot.masterConfig),
            updatedAt: new Date().toISOString(),
          },
        });
    }

    if (snapshot.hospitalZone) {
      await pgDb
        .insert(pgSystemConfig)
        .values({
          key: 'hospitalZone',
          value: JSON.stringify(snapshot.hospitalZone),
          updatedAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: pgSystemConfig.key,
          set: {
            value: JSON.stringify(snapshot.hospitalZone),
            updatedAt: new Date().toISOString(),
          },
        });
    }

    pgInitialized = true;
    console.log('🌟 Cloud SQL PostgreSQL synchronization verified successfully.');
  } catch (pgSyncErr) {
    markCloudSqlUnavailable(pgSyncErr);
  }
}

// Initialize SQLite database and tables with self-healing integrity checks & Cloud SQL bootstrap
export async function initDatabase(): Promise<Database> {
  if (db) return db;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const SQL = await initSqlJs();

  // Try loading from existing binary SQLite database file first
  let loadedFromDb = false;
  if (fs.existsSync(DB_FILE)) {
    try {
      const fileBuffer = fs.readFileSync(DB_FILE);
      if (fileBuffer.length > 0) {
        const testDb = new SQL.Database(fileBuffer);
        const checkRes = testDb.exec('PRAGMA quick_check');
        const checkStatus = checkRes[0]?.values[0]?.[0];
        if (checkStatus === 'ok') {
          db = testDb;
          console.log(`📦 SQLite database loaded and verified: ${DB_FILE} (${fileBuffer.length} bytes)`);
          loadedFromDb = true;
        } else {
          console.warn(`⚠️ SQLite database integrity check failed (${checkStatus}). Will rebuild from clean state.`);
          testDb.close();
        }
      }
    } catch (err) {
      console.error('⚠️ Error reading or verifying clinicas.db, will auto-recover:', err);
    }
  }

  if (!db) {
    db = new SQL.Database();
    loadedFromDb = false;
  }

  const schemaSql = `
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      direccion TEXT,
      latitude REAL,
      longitude REAL,
      radiusMeters REAL,
      horaEntrada TEXT,
      horaSalida TEXT,
      toleranciaMinutos INTEGER,
      data_json TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      matricula TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      email TEXT,
      especialidad TEXT,
      rotacion TEXT,
      grupo TEXT,
      equipo TEXT,
      activo INTEGER DEFAULT 1,
      sedeId TEXT,
      sedeNombre TEXT,
      secondarySedeId TEXT,
      secondarySedeNombre TEXT,
      horaEntrada TEXT,
      horaSalida TEXT,
      toleranciaMinutos INTEGER,
      diasAsistencia TEXT,
      horariosPorDia TEXT,
      linkedDeviceId TEXT,
      linkedDeviceName TEXT,
      linkedAt TEXT,
      data_json TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attendance_records (
      id TEXT PRIMARY KEY,
      studentId TEXT,
      matricula TEXT,
      studentNombre TEXT,
      grupo TEXT,
      equipo TEXT,
      siteId TEXT,
      siteNombre TEXT,
      fecha TEXT NOT NULL,
      tipo TEXT NOT NULL,
      horaRegistrada TEXT NOT NULL,
      estado TEXT NOT NULL,
      horaEsperada TEXT,
      toleranciaMinutos INTEGER,
      minutosDiferencia INTEGER,
      latitude REAL,
      longitude REAL,
      distanceMeters REAL,
      accuracyMeters REAL,
      dentroDeZona INTEGER,
      deviceId TEXT,
      deviceName TEXT,
      verificadoPorGPS INTEGER,
      esJustificada INTEGER DEFAULT 0,
      motivoJustificante TEXT,
      data_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS holidays (
      fecha TEXT PRIMARY KEY,
      descripcion TEXT NOT NULL,
      creadoPor TEXT,
      fechaCreacion TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_students_matricula ON students(matricula);
    CREATE INDEX IF NOT EXISTS idx_records_student_fecha ON attendance_records(matricula, fecha);
    CREATE INDEX IF NOT EXISTS idx_records_fecha ON attendance_records(fecha);
    CREATE INDEX IF NOT EXISTS idx_records_estado ON attendance_records(estado);
    CREATE INDEX IF NOT EXISTS idx_records_grupo ON attendance_records(grupo);
  `;

  try {
    db.run(schemaSql);
  } catch (schemaErr) {
    console.error('⚠️ Error applying schema to SQLite database, resetting to clean instance:', schemaErr);
    try {
      if (db) db.close();
    } catch {}
    db = new SQL.Database();
    db.run(schemaSql);
    loadedFromDb = false;
  }

  if (!loadedFromDb) {
    loadDataFromSnapshots();
    flushDatabaseToDisk();
  }

  console.log('✅ SQLite Local Database initialized and indexed successfully.');

  // Asynchronously trigger Cloud SQL sync in background if configured
  if (isCloudSqlConfigured()) {
    syncToPostgreSql().catch((err) => {
      console.warn('⚠️ Cloud SQL background synchronization note:', err);
    });
  }

  return db;
}

// Helper to seed from json snapshots if database was newly created
function loadDataFromSnapshots() {
  if (!db) return;

  let stateToLoad: any = null;

  if (fs.existsSync(JSON_STATE_FILE)) {
    try {
      const raw = fs.readFileSync(JSON_STATE_FILE, 'utf-8');
      stateToLoad = JSON.parse(raw);
      console.log(`📦 Loading data snapshot from ${JSON_STATE_FILE} into SQLite...`);
    } catch (err) {
      console.error(`⚠️ Error reading ${JSON_STATE_FILE}:`, err);
    }
  }

  if (!stateToLoad && fs.existsSync(ROOT_JSON_STATE_FILE)) {
    try {
      const raw = fs.readFileSync(ROOT_JSON_STATE_FILE, 'utf-8');
      stateToLoad = JSON.parse(raw);
      console.log(`📦 Loading data snapshot from ${ROOT_JSON_STATE_FILE} into SQLite...`);
    } catch (err) {
      console.error(`⚠️ Error reading ${ROOT_JSON_STATE_FILE}:`, err);
    }
  }

  if (stateToLoad) {
    try {
      importFullSnapshotToSqlite(stateToLoad, 'merge');
    } catch (err) {
      console.error('⚠️ Error importing snapshot during database initialization:', err);
    }
  }
}

// Flush binary SQLite database and JSON mirror to disk with atomic write protection
function flushDatabaseToDisk() {
  if (!db || isSaving) return;
  isSaving = true;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    const tmpDbFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmpDbFile, buffer);
    fs.renameSync(tmpDbFile, DB_FILE);

    const fullState = getAllDataSnapshot();
    const jsonStr = JSON.stringify(fullState, null, 2);

    const tmpJsonFile = `${JSON_STATE_FILE}.tmp`;
    fs.writeFileSync(tmpJsonFile, jsonStr, 'utf-8');
    fs.renameSync(tmpJsonFile, JSON_STATE_FILE);

    fs.writeFileSync(ROOT_JSON_STATE_FILE, jsonStr, 'utf-8');
  } catch (err) {
    console.error('⚠️ Error persisting SQLite DB:', err);
  } finally {
    isSaving = false;
  }
}

// Immediate database persistence
export function persistDatabase(_immediate = true) {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
  }
  flushDatabaseToDisk();
}

// Helper for safe rollback that prevents 'cannot rollback - no transaction is active'
function safeRollback() {
  if (!db) return;
  try {
    db.run('ROLLBACK');
  } catch (_err) {
    // Suppress error if transaction was already aborted or not open
  }
}

// Import full state object into SQLite & Cloud SQL
export function importFullSnapshotToSqlite(data: any, mode: 'merge' | 'replace' = 'merge') {
  if (!db || !data) {
    return {
      studentsAdded: 0,
      studentsUpdated: 0,
      recordsAdded: 0,
      recordsUpdated: 0,
      sitesAdded: 0,
      sitesUpdated: 0,
      holidaysAdded: 0,
    };
  }

  let studentsAdded = 0;
  let studentsUpdated = 0;
  let recordsAdded = 0;
  let recordsUpdated = 0;
  let sitesAdded = 0;
  let sitesUpdated = 0;
  let holidaysAdded = 0;

  let inTx = false;
  try {
    db.run('BEGIN TRANSACTION');
    inTx = true;
    if (mode === 'replace') {
      if (Array.isArray(data.students) && data.students.length > 0) {
        db.run('DELETE FROM students');
      }
      if (Array.isArray(data.sites) && data.sites.length > 0) {
        db.run('DELETE FROM sites');
      }
      if (Array.isArray(data.records) && data.records.length > 0) {
        db.run('DELETE FROM attendance_records');
      }
      if (Array.isArray(data.holidays) && data.holidays.length > 0) {
        db.run('DELETE FROM holidays');
      }
    }

    if (data.masterConfig) {
      setSystemConfigInternal('masterConfig', data.masterConfig);
    }
    if (data.hospitalZone) {
      setSystemConfigInternal('hospitalZone', data.hospitalZone);
    }

    if (Array.isArray(data.sites) && data.sites.length > 0) {
      const existingSitesMap = new Map<string, any>();
      if (mode === 'merge') {
        getSitesFromDb().forEach((s) => {
          if (s?.id) existingSitesMap.set(s.id, s);
        });
      }

      const stmtSite = db.prepare(`
        INSERT OR REPLACE INTO sites (id, nombre, direccion, latitude, longitude, radiusMeters, horaEntrada, horaSalida, toleranciaMinutos, data_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const s of data.sites) {
        if (!s || !s.id) continue;
        if (existingSitesMap.has(s.id)) {
          sitesUpdated++;
        } else {
          sitesAdded++;
        }
        stmtSite.run([
          s.id,
          s.nombre || '',
          s.direccion || '',
          s.latitude || 0,
          s.longitude || 0,
          s.radiusMeters || 150,
          s.horaEntrada || '07:00',
          s.horaSalida || '15:00',
          s.toleranciaMinutos || 15,
          JSON.stringify(s),
          new Date().toISOString(),
        ]);
      }
      stmtSite.free();
    }

    if (Array.isArray(data.students)) {
      const existingStudentsMap = new Map<string, any>();
      if (mode === 'merge') {
        getStudentsFromDb().forEach((st) => {
          if (st?.id) existingStudentsMap.set(st.id, st);
          if (st?.matricula) existingStudentsMap.set(String(st.matricula).trim().toLowerCase(), st);
        });
      }

      const stmtStudent = db.prepare(`
        INSERT OR REPLACE INTO students (
          id, matricula, nombre, email, especialidad, rotacion, grupo, equipo, activo,
          sedeId, sedeNombre, secondarySedeId, secondarySedeNombre, horaEntrada, horaSalida,
          toleranciaMinutos, diasAsistencia, horariosPorDia, linkedDeviceId, linkedDeviceName,
          linkedAt, data_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const st of data.students) {
        if (!st || !st.matricula) continue;
        const matricula = String(st.matricula).trim();
        const matKey = matricula.toLowerCase();
        const studentId = st.id || `std-${matricula}`;

        const existing = mode === 'merge' ? (existingStudentsMap.get(studentId) || existingStudentsMap.get(matKey)) : null;

        if (existing) {
          studentsUpdated++;
        } else {
          studentsAdded++;
        }

        const existingTime = existing?.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
        const incomingTime = (st.updatedAt || st._updatedAt) ? new Date(st.updatedAt || st._updatedAt).getTime() : 0;
        const isExistingNewer = mode === 'merge' && existingTime > incomingTime && incomingTime > 0;

        const primary = isExistingNewer ? existing : st;
        const secondary = isExistingNewer ? st : existing;

        const linkedDeviceId = primary.linkedDeviceId !== undefined && primary.linkedDeviceId !== null
          ? primary.linkedDeviceId
          : (secondary?.linkedDeviceId || null);
        const linkedDeviceName = primary.linkedDeviceName !== undefined && primary.linkedDeviceName !== null
          ? primary.linkedDeviceName
          : (secondary?.linkedDeviceName || null);
        const linkedAt = primary.linkedAt !== undefined && primary.linkedAt !== null
          ? primary.linkedAt
          : (secondary?.linkedAt || null);

        const hasPrimarySched = Array.isArray(primary.horariosPorDia) && primary.horariosPorDia.length > 0;
        const hasSecondarySched = Array.isArray(secondary?.horariosPorDia) && secondary.horariosPorDia.length > 0;
        const horariosPorDia = hasPrimarySched
          ? primary.horariosPorDia
          : (hasSecondarySched ? secondary.horariosPorDia : []);

        const hasPrimaryDias = Array.isArray(primary.diasAsistencia) && primary.diasAsistencia.length > 0;
        const hasSecondaryDias = Array.isArray(secondary?.diasAsistencia) && secondary.diasAsistencia.length > 0;
        const diasAsistencia = hasPrimaryDias
          ? primary.diasAsistencia
          : (hasSecondaryDias ? secondary.diasAsistencia : (horariosPorDia.length > 0 ? horariosPorDia.map((h: any) => h.dia) : ['Lunes', 'Miércoles']));

        const fullStudent = {
          ...secondary,
          ...primary,
          id: existing?.id || studentId,
          matricula,
          nombre: primary.nombre || secondary?.nombre || '',
          email: primary.email || secondary?.email || '',
          grupo: primary.grupo || secondary?.grupo || '10 A',
          equipo: primary.equipo || secondary?.equipo || 'Equipo 1',
          especialidad: primary.especialidad || secondary?.especialidad || 'Urgencias Médicas',
          rotacion: primary.rotacion || secondary?.rotacion || 'Urgencias Médicas',
          diasAsistencia,
          horariosPorDia,
          horaEntrada: primary.horaEntrada || (horariosPorDia[0]?.horaEntrada) || secondary?.horaEntrada || '07:00',
          horaSalida: primary.horaSalida || (horariosPorDia[0]?.horaSalida) || secondary?.horaSalida || '15:00',
          toleranciaMinutos: primary.toleranciaMinutos !== undefined ? primary.toleranciaMinutos : (secondary?.toleranciaMinutos ?? 15),
          sedeId: primary.sedeId || secondary?.sedeId || 'site-1',
          sedeNombre: primary.sedeNombre || secondary?.sedeNombre || 'Hospital General Los Mochis',
          secondarySedeId: primary.secondarySedeId !== undefined ? primary.secondarySedeId : (secondary?.secondarySedeId || null),
          secondarySedeNombre: primary.secondarySedeNombre !== undefined ? primary.secondarySedeNombre : (secondary?.secondarySedeNombre || null),
          linkedDeviceId,
          linkedDeviceName,
          linkedAt,
          activo: primary.activo !== undefined ? primary.activo : (secondary?.activo !== undefined ? secondary.activo : true),
          updatedAt: isExistingNewer ? existing.updatedAt : (st.updatedAt || st._updatedAt || new Date().toISOString()),
        };

        const diasAsistenciaStr = JSON.stringify(fullStudent.diasAsistencia || []);
        const horariosPorDiaStr = JSON.stringify(fullStudent.horariosPorDia || []);

        stmtStudent.run([
          fullStudent.id,
          fullStudent.matricula,
          fullStudent.nombre || '',
          fullStudent.email || '',
          fullStudent.especialidad || fullStudent.rotacion || 'Urgencias Médicas',
          fullStudent.rotacion || fullStudent.especialidad || 'Urgencias Médicas',
          fullStudent.grupo || '10 A',
          fullStudent.equipo || 'Equipo 1',
          fullStudent.activo !== false ? 1 : 0,
          fullStudent.sedeId || 'site-1',
          fullStudent.sedeNombre || 'Hospital General Los Mochis',
          fullStudent.secondarySedeId || null,
          fullStudent.secondarySedeNombre || null,
          fullStudent.horaEntrada || '07:00',
          fullStudent.horaSalida || '15:00',
          fullStudent.toleranciaMinutos || 15,
          diasAsistenciaStr,
          horariosPorDiaStr,
          fullStudent.linkedDeviceId || null,
          fullStudent.linkedDeviceName || null,
          fullStudent.linkedAt || null,
          JSON.stringify(fullStudent),
          fullStudent.updatedAt,
        ]);
      }
      stmtStudent.free();
    }

    if (Array.isArray(data.records)) {
      const existingRecSet = new Set<string>();
      if (mode === 'merge') {
        getRecordsFromDb().forEach((r) => {
          if (r?.id) existingRecSet.add(r.id);
        });
      }

      const stmtRecord = db.prepare(`
        INSERT OR REPLACE INTO attendance_records (
          id, studentId, matricula, studentNombre, grupo, equipo, siteId, siteNombre,
          fecha, tipo, horaRegistrada, estado, horaEsperada, toleranciaMinutos,
          minutosDiferencia, latitude, longitude, distanceMeters, accuracyMeters,
          dentroDeZona, deviceId, deviceName, verificadoPorGPS, esJustificada,
          motivoJustificante, data_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const r of data.records) {
        if (!r || !r.id) continue;
        if (existingRecSet.has(r.id)) {
          recordsUpdated++;
        } else {
          recordsAdded++;
        }

        const resolvedEstado = (r.esJustificada || r.checkInStatus === 'JUSTIFICADA' || r.estado === 'JUSTIFICADA')
          ? 'JUSTIFICADA'
          : (r.checkInStatus || r.estado || 'A_TIEMPO');

        stmtRecord.run([
          r.id,
          r.studentId || '',
          r.matricula ? String(r.matricula).trim() : '',
          r.studentNombre || '',
          r.grupo || '',
          r.equipo || '',
          r.siteId || '',
          r.siteNombre || '',
          r.fecha || '',
          r.tipo || (resolvedEstado === 'JUSTIFICADA' ? 'JUSTIFICANTE' : 'ENTRADA'),
          r.horaRegistrada || '',
          resolvedEstado,
          r.horaEsperada || '',
          r.toleranciaMinutos || 15,
          r.minutosDiferencia || 0,
          r.latitude || 0,
          r.longitude || 0,
          r.distanceMeters || 0,
          r.accuracyMeters || 0,
          r.dentroDeZona ? 1 : 0,
          r.deviceId || '',
          r.deviceName || '',
          r.verificadoPorGPS ? 1 : 0,
          (r.esJustificada || resolvedEstado === 'JUSTIFICADA') ? 1 : 0,
          r.motivoJustificante || '',
          JSON.stringify(r),
          r.fecha || new Date().toISOString(),
        ]);
      }
      stmtRecord.free();
    }

    if (Array.isArray(data.holidays)) {
      const existingHolSet = new Set<string>();
      if (mode === 'merge') {
        getHolidaysFromDb().forEach((h) => {
          if (h?.fecha) existingHolSet.add(h.fecha);
        });
      }

      const stmtHol = db.prepare(`
        INSERT OR REPLACE INTO holidays (fecha, descripcion, creadoPor, fechaCreacion)
        VALUES (?, ?, ?, ?)
      `);
      for (const h of data.holidays) {
        if (!h || !h.fecha) continue;
        if (!existingHolSet.has(h.fecha)) {
          holidaysAdded++;
        }
        stmtHol.run([
          h.fecha,
          h.descripcion || '',
          h.creadoPor || '',
          h.fechaCreacion || new Date().toISOString(),
        ]);
      }
      stmtHol.free();
    }

    db.run('COMMIT');
    inTx = false;

    // Async replicate full snapshot to PostgreSQL
    syncToPostgreSql().catch(() => {});

    return {
      studentsAdded,
      studentsUpdated,
      recordsAdded,
      recordsUpdated,
      sitesAdded,
      sitesUpdated,
      holidaysAdded,
    };
  } catch (err) {
    if (inTx) {
      safeRollback();
    }
    console.error('Error importing snapshot to SQLite:', err);
    throw err;
  }
}

// Detailed comparison of incoming JSON data with current SQLite database
export function analyzeStateDiffFromDb(data: any) {
  if (!db || !data || typeof data !== 'object') {
    return {
      students: { totalIncoming: 0, totalInDb: 0, added: [], modified: [], unchangedCount: 0 },
      records: { totalIncoming: 0, totalInDb: 0, newRecordsCount: 0, existingRecordsCount: 0, latestIncomingDate: 'Sin registros', latestDbDate: 'Sin registros' },
      sites: { totalIncoming: 0, totalInDb: 0, added: [], modified: [], unchangedCount: 0 },
      holidays: { totalIncoming: 0, totalInDb: 0, added: [], unchangedCount: 0 },
      summary: { hasChanges: false, totalChangesCount: 0, recommendation: 'none' as const, warningReasons: [] },
    };
  }

  const currentStudents = getStudentsFromDb();
  const currentRecords = getRecordsFromDb();
  const currentSites = getSitesFromDb();
  const currentHolidays = getHolidaysFromDb();

  const studentMap = new Map<string, any>();
  currentStudents.forEach((s) => {
    if (s.id) studentMap.set(s.id, s);
    if (s.matricula) studentMap.set(String(s.matricula).trim().toLowerCase(), s);
  });

  const rawIncomingStudents = Array.isArray(data.students) ? data.students : [];
  const studentsAdded: any[] = [];
  const studentsModified: any[] = [];
  let studentsUnchangedCount = 0;

  for (const inc of rawIncomingStudents) {
    if (!inc || !inc.matricula) continue;
    const matKey = String(inc.matricula).trim().toLowerCase();
    const existing = studentMap.get(inc.id) || studentMap.get(matKey);

    if (!existing) {
      studentsAdded.push({
        id: inc.id || `std-${inc.matricula}`,
        matricula: inc.matricula,
        nombre: inc.nombre || 'Sin nombre',
        grupo: inc.grupo || 'Sin grupo',
        equipo: inc.equipo || 'Sin equipo',
        sedeNombre: inc.sedeNombre || 'Sede Principal',
        horariosCount: Array.isArray(inc.horariosPorDia) ? inc.horariosPorDia.length : 0,
      });
    } else {
      const changes: string[] = [];

      if (inc.nombre && inc.nombre.trim() !== existing.nombre?.trim()) {
        changes.push(`Nombre: "${existing.nombre}" → "${inc.nombre}"`);
      }
      if (inc.grupo && inc.grupo !== existing.grupo) {
        changes.push(`Grupo: ${existing.grupo} → ${inc.grupo}`);
      }
      if (inc.equipo && inc.equipo !== existing.equipo) {
        changes.push(`Equipo: ${existing.equipo} → ${inc.equipo}`);
      }
      if (inc.rotacion && inc.rotacion !== existing.rotacion) {
        changes.push(`Rotación: ${existing.rotacion} → ${inc.rotacion}`);
      }
      if (inc.sedeNombre && inc.sedeNombre !== existing.sedeNombre) {
        changes.push(`Sede: ${existing.sedeNombre} → ${inc.sedeNombre}`);
      }

      const incSched = Array.isArray(inc.horariosPorDia) ? inc.horariosPorDia : [];
      const exSched = Array.isArray(existing.horariosPorDia) ? existing.horariosPorDia : [];
      const incSchedStr = JSON.stringify(incSched.map((h: any) => ({ dia: h.dia, entrada: h.horaEntrada, salida: h.horaSalida, turnos: h.turnos })));
      const exSchedStr = JSON.stringify(exSched.map((h: any) => ({ dia: h.dia, entrada: h.horaEntrada, salida: h.horaSalida, turnos: h.turnos })));

      if (incSched.length > 0 && incSchedStr !== exSchedStr) {
        changes.push(`Horarios actualizados (${incSched.length} días configurados)`);
      }

      const incDays = Array.isArray(inc.diasAsistencia) ? inc.diasAsistencia : [];
      const exDays = Array.isArray(existing.diasAsistencia) ? existing.diasAsistencia : [];
      if (incDays.length > 0 && JSON.stringify(incDays.sort()) !== JSON.stringify(exDays.sort())) {
        changes.push(`Días de asistencia: [${exDays.join(', ')}] → [${incDays.join(', ')}]`);
      }

      if (changes.length > 0) {
        studentsModified.push({
          id: existing.id || inc.id,
          matricula: inc.matricula,
          nombre: inc.nombre || existing.nombre,
          grupo: inc.grupo || existing.grupo,
          equipo: inc.equipo || existing.equipo,
          changes,
          oldSummary: `${existing.sedeNombre || 'Sede 1'} • ${exSched.length} días`,
          newSummary: `${inc.sedeNombre || existing.sedeNombre || 'Sede 1'} • ${incSched.length} días`,
        });
      } else {
        studentsUnchangedCount++;
      }
    }
  }

  const rawIncomingRecords = Array.isArray(data.records) ? data.records : [];
  const existingRecordIds = new Set(currentRecords.map((r) => r.id));
  let newRecordsCount = 0;
  let existingRecordsCount = 0;

  for (const rec of rawIncomingRecords) {
    if (!rec || !rec.id) continue;
    if (existingRecordIds.has(rec.id)) {
      existingRecordsCount++;
    } else {
      newRecordsCount++;
    }
  }

  const incomingDates = rawIncomingRecords.map((r: any) => r.fecha || '').filter(Boolean).sort();
  const dbDates = currentRecords.map((r: any) => r.fecha || '').filter(Boolean).sort();
  const latestIncomingDate = incomingDates.length > 0 ? incomingDates[incomingDates.length - 1] : 'Sin registros';
  const latestDbDate = dbDates.length > 0 ? dbDates[dbDates.length - 1] : 'Sin registros';

  const rawIncomingSites = Array.isArray(data.sites) ? data.sites : [];
  const existingSiteIds = new Set(currentSites.map((s) => s.id));
  const sitesAdded: string[] = [];
  const sitesModified: string[] = [];
  let sitesUnchangedCount = 0;

  for (const s of rawIncomingSites) {
    if (!s || !s.id) continue;
    if (!existingSiteIds.has(s.id)) {
      sitesAdded.push(s.nombre || s.id);
    } else {
      const ex = currentSites.find((site) => site.id === s.id);
      if (ex && (ex.nombre !== s.nombre || ex.latitude !== s.latitude || ex.longitude !== s.longitude)) {
        sitesModified.push(s.nombre || s.id);
      } else {
        sitesUnchangedCount++;
      }
    }
  }

  const rawIncomingHolidays = Array.isArray(data.holidays) ? data.holidays : [];
  const existingHolidayDates = new Set(currentHolidays.map((h) => h.fecha));
  const holidaysAdded: string[] = [];
  let holidaysUnchangedCount = 0;

  for (const h of rawIncomingHolidays) {
    if (!h || !h.fecha) continue;
    if (!existingHolidayDates.has(h.fecha)) {
      holidaysAdded.push(`${h.fecha} (${h.descripcion || 'Día inhábil'})`);
    } else {
      holidaysUnchangedCount++;
    }
  }

  const warningReasons: string[] = [];
  if (rawIncomingRecords.length < currentRecords.length) {
    warningReasons.push(`El archivo JSON contiene menos registros de asistencia (${rawIncomingRecords.length}) que la base de datos actual (${currentRecords.length}).`);
  }
  if (rawIncomingStudents.length < currentStudents.length) {
    warningReasons.push(`El archivo JSON contiene menos alumnos (${rawIncomingStudents.length}) que la base de datos actual (${currentStudents.length}).`);
  }
  if (latestIncomingDate !== 'Sin registros' && latestDbDate !== 'Sin registros' && latestIncomingDate < latestDbDate) {
    warningReasons.push(`La fecha de asistencia más reciente en el archivo (${latestIncomingDate}) es anterior a la fecha activa en la base de datos (${latestDbDate}).`);
  }

  const totalChangesCount = studentsAdded.length + studentsModified.length + newRecordsCount + sitesAdded.length + sitesModified.length + holidaysAdded.length;

  return {
    students: {
      totalIncoming: rawIncomingStudents.length,
      totalInDb: currentStudents.length,
      added: studentsAdded,
      modified: studentsModified,
      unchangedCount: studentsUnchangedCount,
    },
    records: {
      totalIncoming: rawIncomingRecords.length,
      totalInDb: currentRecords.length,
      newRecordsCount,
      existingRecordsCount,
      latestIncomingDate,
      latestDbDate,
    },
    sites: {
      totalIncoming: rawIncomingSites.length,
      totalInDb: currentSites.length,
      added: sitesAdded,
      modified: sitesModified,
      unchangedCount: sitesUnchangedCount,
    },
    holidays: {
      totalIncoming: rawIncomingHolidays.length,
      totalInDb: currentHolidays.length,
      added: holidaysAdded,
      unchangedCount: holidaysUnchangedCount,
    },
    summary: {
      hasChanges: totalChangesCount > 0,
      totalChangesCount,
      recommendation: 'merge' as const,
      warningReasons,
    },
  };
}

function setSystemConfigInternal(key: string, value: any) {
  if (!db) return;
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO system_config (key, value, updated_at)
    VALUES (?, ?, ?)
  `);
  stmt.run([key, JSON.stringify(value), new Date().toISOString()]);
  stmt.free();

  if (isCloudSqlConfigured() && pgDb) {
    pgDb
      .insert(pgSystemConfig)
      .values({
        key,
        value: JSON.stringify(value),
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: pgSystemConfig.key,
        set: {
          value: JSON.stringify(value),
          updatedAt: new Date().toISOString(),
        },
      })
      .catch((err) => markCloudSqlUnavailable(err));
  }
}

// Config getters/setters
export function getSystemConfig(key: string, defaultValue: any = null): any {
  if (!db) return defaultValue;
  const stmt = db.prepare(`SELECT value FROM system_config WHERE key = ?`);
  stmt.bind([key]);
  if (stmt.step()) {
    const row = stmt.get();
    stmt.free();
    try {
      return JSON.parse(row[0] as string);
    } catch {
      return row[0];
    }
  }
  stmt.free();
  return defaultValue;
}

export function setSystemConfig(key: string, value: any) {
  setSystemConfigInternal(key, value);
  persistDatabase();
  syncConfigToFirestore(key, value).catch(() => {});
}

// ----------------- CRUD Operations -----------------

export const DEFAULT_HOSPITAL_SITES = [
  {
    id: 'site-1',
    nombre: 'Hospital General Los Mochis',
    direccion: 'Blvd. Macario Gaxiola y Av. Hidalgo, Los Mochis, Sin.',
    latitude: 25.7925,
    longitude: -108.996,
    radiusMeters: 150,
    horaEntrada: '07:00',
    horaSalida: '15:00',
    toleranciaMinutos: 15,
  },
  {
    id: 'site-2',
    nombre: 'IMSS Clínica 49 y 37',
    direccion: 'Blvd. Rosendo G. Castro s/n, Col. Centro, Los Mochis, Sin.',
    latitude: 25.798,
    longitude: -108.999,
    radiusMeters: 150,
    horaEntrada: '07:00',
    horaSalida: '15:00',
    toleranciaMinutos: 15,
  },
  {
    id: 'site-3',
    nombre: 'ISSSTE Los Mochis',
    direccion: 'Av. Independencia y Santos Degollado, Los Mochis, Sin.',
    latitude: 25.795,
    longitude: -108.992,
    radiusMeters: 180,
    horaEntrada: '08:00',
    horaSalida: '16:00',
    toleranciaMinutos: 20,
  },
];

export function getSitesFromDb(): any[] {
  if (!db) return DEFAULT_HOSPITAL_SITES;
  const res = db.exec('SELECT data_json FROM sites ORDER BY nombre ASC');
  if (res.length === 0 || res[0].values.length === 0) {
    // Seed default sites so sites are never empty
    for (const site of DEFAULT_HOSPITAL_SITES) {
      saveSiteToDb(site);
    }
    return DEFAULT_HOSPITAL_SITES;
  }
  return res[0].values.map((v) => JSON.parse(v[0] as string));
}

export function saveSiteToDb(site: any) {
  if (!db || !site || !site.id) return;
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO sites (id, nombre, direccion, latitude, longitude, radiusMeters, horaEntrada, horaSalida, toleranciaMinutos, data_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run([
    site.id,
    site.nombre || '',
    site.direccion || '',
    site.latitude || 0,
    site.longitude || 0,
    site.radiusMeters || 150,
    site.horaEntrada || '07:00',
    site.horaSalida || '15:00',
    site.toleranciaMinutos || 15,
    JSON.stringify(site),
    site.updatedAt || new Date().toISOString(),
  ]);
  stmt.free();
  persistDatabase();

  if (isCloudSqlConfigured() && pgDb) {
    pgDb
      .insert(pgSites)
      .values({
        id: site.id,
        nombre: site.nombre || '',
        direccion: site.direccion || '',
        latitude: Number(site.latitude) || 0,
        longitude: Number(site.longitude) || 0,
        radiusMeters: Number(site.radiusMeters) || 150,
        horaEntrada: site.horaEntrada || '07:00',
        horaSalida: site.horaSalida || '15:00',
        toleranciaMinutos: Number(site.toleranciaMinutos) || 15,
        dataJson: JSON.stringify(site),
        updatedAt: site.updatedAt || new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: pgSites.id,
        set: {
          nombre: site.nombre || '',
          direccion: site.direccion || '',
          latitude: Number(site.latitude) || 0,
          longitude: Number(site.longitude) || 0,
          radiusMeters: Number(site.radiusMeters) || 150,
          horaEntrada: site.horaEntrada || '07:00',
          horaSalida: site.horaSalida || '15:00',
          toleranciaMinutos: Number(site.toleranciaMinutos) || 15,
          dataJson: JSON.stringify(site),
          updatedAt: site.updatedAt || new Date().toISOString(),
        },
      })
      .catch((err) => markCloudSqlUnavailable(err));
  }

  syncSiteToFirestore(site).catch(() => {});
}

export function deleteSiteFromDb(siteId: string): boolean {
  if (!db || !siteId) return false;
  const stmt = db.prepare(`DELETE FROM sites WHERE id = ?`);
  stmt.run([siteId]);
  stmt.free();
  persistDatabase();

  if (isCloudSqlConfigured() && pgDb) {
    pgDb
      .delete(pgSites)
      .where(eq(pgSites.id, siteId))
      .catch((err) => markCloudSqlUnavailable(err));
  }

  deleteSiteFromFirestore(siteId).catch(() => {});
  return true;
}

export function getStudentsFromDb(): any[] {
  if (!db) return [];
  const res = db.exec('SELECT data_json FROM students ORDER BY nombre ASC');
  if (res.length === 0) return [];
  return res[0].values.map((v) => JSON.parse(v[0] as string));
}

export function getStudentByMatriculaOrIdFromDb(identifier: string): any | null {
  if (!db || !identifier) return null;
  const clean = String(identifier).trim();
  const stmt = db.prepare(`
    SELECT data_json FROM students 
    WHERE id = ? OR lower(trim(matricula)) = ?
    LIMIT 1
  `);
  stmt.bind([clean, clean.toLowerCase()]);
  if (stmt.step()) {
    const row = stmt.get();
    stmt.free();
    return JSON.parse(row[0] as string);
  }
  stmt.free();
  return null;
}

export function saveStudentToDb(student: any, persist = true, syncFirestore = true): any {
  if (!db || !student) return null;
  const matricula = String(student.matricula || '').trim();
  if (!matricula) return null;

  const existing = getStudentByMatriculaOrIdFromDb(student.id || matricula);
  const studentId = existing?.id || student.id || `std-${matricula}`;

  const linkedDeviceId = student.linkedDeviceId !== undefined ? student.linkedDeviceId : (existing?.linkedDeviceId || null);
  const linkedDeviceName = student.linkedDeviceName !== undefined ? student.linkedDeviceName : (existing?.linkedDeviceName || null);
  const linkedAt = student.linkedAt !== undefined ? student.linkedAt : (existing?.linkedAt || null);

  const hasIncomingSched = Array.isArray(student.horariosPorDia);
  const horariosPorDia = hasIncomingSched ? student.horariosPorDia : (existing?.horariosPorDia || []);

  const hasIncomingDias = Array.isArray(student.diasAsistencia);
  const diasAsistencia = hasIncomingDias ? student.diasAsistencia : (existing?.diasAsistencia || []);

  const fullStudent = {
    ...existing,
    ...student,
    id: studentId,
    matricula,
    diasAsistencia,
    horariosPorDia,
    horaEntrada: student.horaEntrada || (horariosPorDia[0]?.horaEntrada) || existing?.horaEntrada || '07:00',
    horaSalida: student.horaSalida || (horariosPorDia[0]?.horaSalida) || existing?.horaSalida || '15:00',
    toleranciaMinutos: student.toleranciaMinutos !== undefined ? student.toleranciaMinutos : (existing?.toleranciaMinutos ?? 15),
    sedeId: student.sedeId || existing?.sedeId || 'site-1',
    sedeNombre: student.sedeNombre || existing?.sedeNombre || 'Hospital General Los Mochis',
    secondarySedeId: student.secondarySedeId !== undefined ? student.secondarySedeId : (existing?.secondarySedeId || null),
    secondarySedeNombre: student.secondarySedeNombre !== undefined ? student.secondarySedeNombre : (existing?.secondarySedeNombre || null),
    linkedDeviceId,
    linkedDeviceName,
    linkedAt,
    updatedAt: student.updatedAt || new Date().toISOString(),
  };

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO students (
      id, matricula, nombre, email, especialidad, rotacion, grupo, equipo, activo,
      sedeId, sedeNombre, secondarySedeId, secondarySedeNombre, horaEntrada, horaSalida,
      toleranciaMinutos, diasAsistencia, horariosPorDia, linkedDeviceId, linkedDeviceName,
      linkedAt, data_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run([
    fullStudent.id,
    fullStudent.matricula,
    fullStudent.nombre || '',
    fullStudent.email || '',
    fullStudent.especialidad || fullStudent.rotacion || 'Urgencias Médicas',
    fullStudent.rotacion || fullStudent.especialidad || 'Urgencias Médicas',
    fullStudent.grupo || '10 A',
    fullStudent.equipo || 'Equipo 1',
    fullStudent.activo !== false ? 1 : 0,
    fullStudent.sedeId || 'site-1',
    fullStudent.sedeNombre || 'Hospital General Los Mochis',
    fullStudent.secondarySedeId || null,
    fullStudent.secondarySedeNombre || null,
    fullStudent.horaEntrada || '07:00',
    fullStudent.horaSalida || '15:00',
    fullStudent.toleranciaMinutos || 15,
    JSON.stringify(fullStudent.diasAsistencia || []),
    JSON.stringify(fullStudent.horariosPorDia || []),
    fullStudent.linkedDeviceId || null,
    fullStudent.linkedDeviceName || null,
    fullStudent.linkedAt || null,
    JSON.stringify(fullStudent),
    fullStudent.updatedAt,
  ]);
  stmt.free();

  if (persist) {
    persistDatabase(true);
  }

  if (isCloudSqlConfigured() && pgDb) {
    pgDb
      .insert(pgStudents)
      .values({
        id: fullStudent.id,
        matricula: fullStudent.matricula,
        nombre: fullStudent.nombre || '',
        email: fullStudent.email || '',
        especialidad: fullStudent.especialidad || fullStudent.rotacion || 'Urgencias Médicas',
        rotacion: fullStudent.rotacion || fullStudent.especialidad || 'Urgencias Médicas',
        grupo: fullStudent.grupo || '10 A',
        equipo: fullStudent.equipo || 'Equipo 1',
        activo: fullStudent.activo !== false ? 1 : 0,
        sedeId: fullStudent.sedeId || 'site-1',
        sedeNombre: fullStudent.sedeNombre || 'Hospital General Los Mochis',
        secondarySedeId: fullStudent.secondarySedeId || null,
        secondarySedeNombre: fullStudent.secondarySedeNombre || null,
        horaEntrada: fullStudent.horaEntrada || '07:00',
        horaSalida: fullStudent.horaSalida || '15:00',
        toleranciaMinutos: Number(fullStudent.toleranciaMinutos) || 15,
        diasAsistencia: JSON.stringify(fullStudent.diasAsistencia || []),
        horariosPorDia: JSON.stringify(fullStudent.horariosPorDia || []),
        linkedDeviceId: fullStudent.linkedDeviceId || null,
        linkedDeviceName: fullStudent.linkedDeviceName || null,
        linkedAt: fullStudent.linkedAt || null,
        dataJson: JSON.stringify(fullStudent),
        updatedAt: fullStudent.updatedAt,
      })
      .onConflictDoUpdate({
        target: pgStudents.matricula,
        set: {
          nombre: fullStudent.nombre || '',
          email: fullStudent.email || '',
          especialidad: fullStudent.especialidad || fullStudent.rotacion || 'Urgencias Médicas',
          rotacion: fullStudent.rotacion || fullStudent.especialidad || 'Urgencias Médicas',
          grupo: fullStudent.grupo || '10 A',
          equipo: fullStudent.equipo || 'Equipo 1',
          activo: fullStudent.activo !== false ? 1 : 0,
          sedeId: fullStudent.sedeId || 'site-1',
          sedeNombre: fullStudent.sedeNombre || 'Hospital General Los Mochis',
          secondarySedeId: fullStudent.secondarySedeId || null,
          secondarySedeNombre: fullStudent.secondarySedeNombre || null,
          horaEntrada: fullStudent.horaEntrada || '07:00',
          horaSalida: fullStudent.horaSalida || '15:00',
          toleranciaMinutos: Number(fullStudent.toleranciaMinutos) || 15,
          diasAsistencia: JSON.stringify(fullStudent.diasAsistencia || []),
          horariosPorDia: JSON.stringify(fullStudent.horariosPorDia || []),
          linkedDeviceId: fullStudent.linkedDeviceId || null,
          linkedDeviceName: fullStudent.linkedDeviceName || null,
          linkedAt: fullStudent.linkedAt || null,
          dataJson: JSON.stringify(fullStudent),
          updatedAt: fullStudent.updatedAt,
        },
      })
      .catch((err) => markCloudSqlUnavailable(err));
  }

  if (syncFirestore) {
    syncStudentToFirestore(fullStudent).catch(() => {});
  }

  return fullStudent;
}

export function saveMultipleStudentsToDb(studentsList: any[]): any[] {
  if (!db || !Array.isArray(studentsList)) return [];
  const results: any[] = [];
  let inTx = false;
  try {
    db.run('BEGIN TRANSACTION');
    inTx = true;
    for (const st of studentsList) {
      const saved = saveStudentToDb(st, false, false);
      if (saved) results.push(saved);
    }
    db.run('COMMIT');
    inTx = false;
  } catch (err) {
    if (inTx) {
      safeRollback();
    }
    console.error('Error saving batch students to SQLite:', err);
  }
  persistDatabase();
  syncMultipleStudentsToFirestore(results).catch((err) => console.warn('Batch students sync notice:', err));
  return results;
}

export function deleteStudentFromDb(studentId: string): boolean {
  if (!db || !studentId) return false;
  const clean = String(studentId).trim();
  const stmt = db.prepare(`DELETE FROM students WHERE id = ? OR lower(trim(matricula)) = ?`);
  stmt.run([clean, clean.toLowerCase()]);
  stmt.free();
  persistDatabase();

  if (pgDb) {
    pgDb
      .delete(pgStudents)
      .where(eq(pgStudents.matricula, clean))
      .catch((err) => console.warn('PostgreSQL deleteStudent notice:', err));
  }

  deleteStudentFromFirestore(clean).catch(() => {});

  return true;
}

export function linkStudentDeviceInDb(studentId: string, matricula: string, deviceId: string, deviceName: string): any | null {
  if (!db) return null;
  const student = getStudentByMatriculaOrIdFromDb(studentId || matricula);
  if (!student) return null;

  student.linkedDeviceId = deviceId;
  student.linkedDeviceName = deviceName;
  student.linkedAt = new Date().toISOString();
  student.updatedAt = new Date().toISOString();

  return saveStudentToDb(student);
}

export function unlinkStudentDeviceInDb(studentId: string, matricula: string): boolean {
  if (!db) return false;
  const student = getStudentByMatriculaOrIdFromDb(studentId || matricula);
  if (!student) return false;

  student.linkedDeviceId = null;
  student.linkedDeviceName = null;
  student.linkedAt = null;
  student.updatedAt = new Date().toISOString();

  saveStudentToDb(student);
  return true;
}

export function unlinkAllDevicesInDb(): number {
  if (!db) return 0;
  const students = getStudentsFromDb();
  let count = 0;
  let inTx = false;
  try {
    db.run('BEGIN TRANSACTION');
    inTx = true;
    for (const st of students) {
      if (st.linkedDeviceId) {
        st.linkedDeviceId = null;
        st.linkedDeviceName = null;
        st.linkedAt = null;
        st.updatedAt = new Date().toISOString();
        saveStudentToDb(st, false);
        count++;
      }
    }
    db.run('COMMIT');
    inTx = false;
  } catch (err) {
    if (inTx) {
      safeRollback();
    }
    console.error('Error unlinking all devices:', err);
  }
  persistDatabase();
  return count;
}

// ----------------- ADVANCED ATTENDANCE QUERYING & AGGREGATIONS -----------------

export interface RecordQueryParams {
  matricula?: string;
  studentId?: string;
  fecha?: string;
  startDate?: string;
  endDate?: string;
  grupo?: string;
  tipo?: string;
  limit?: number;
  offset?: number;
}

export function getRecordsFromDb(params?: RecordQueryParams): any[] {
  if (!db) return [];

  const conditions: string[] = [];
  const binds: any[] = [];

  if (params?.matricula) {
    conditions.push('(lower(trim(matricula)) = ?)');
    binds.push(String(params.matricula).trim().toLowerCase());
  }

  if (params?.studentId) {
    conditions.push('(studentId = ?)');
    binds.push(params.studentId);
  }

  if (params?.fecha) {
    conditions.push('(fecha = ?)');
    binds.push(params.fecha);
  } else {
    if (params?.startDate) {
      conditions.push('(fecha >= ?)');
      binds.push(params.startDate);
    }
    if (params?.endDate) {
      conditions.push('(fecha <= ?)');
      binds.push(params.endDate);
    }
  }

  if (params?.grupo && params.grupo !== 'ALL') {
    conditions.push('(replace(upper(grupo), " ", "") = ?)');
    binds.push(params.grupo.replace(/\s+/g, '').toUpperCase());
  }

  if (params?.tipo) {
    conditions.push('(tipo = ?)');
    binds.push(params.tipo);
  }

  let sql = 'SELECT data_json FROM attendance_records';
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY fecha DESC, horaRegistrada DESC';

  if (params?.limit && params.limit > 0) {
    sql += ` LIMIT ${Number(params.limit)}`;
    if (params?.offset && params.offset > 0) {
      sql += ` OFFSET ${Number(params.offset)}`;
    }
  }

  const stmt = db.prepare(sql);
  if (binds.length > 0) {
    stmt.bind(binds);
  }

  const results: any[] = [];
  while (stmt.step()) {
    const row = stmt.get();
    try {
      results.push(JSON.parse(row[0] as string));
    } catch {}
  }
  stmt.free();
  return results;
}

export function getRecordsPaginatedFromDb(params: RecordQueryParams & { page?: number; pageSize?: number }) {
  if (!db) {
    return { records: [], total: 0, page: 1, pageSize: 50, totalPages: 0, hasMore: false };
  }

  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.max(1, Math.min(500, Number(params.pageSize || params.limit) || 50));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const binds: any[] = [];

  if (params?.matricula) {
    conditions.push('(lower(trim(matricula)) = ?)');
    binds.push(String(params.matricula).trim().toLowerCase());
  }

  if (params?.studentId) {
    conditions.push('(studentId = ?)');
    binds.push(params.studentId);
  }

  if (params?.fecha) {
    conditions.push('(fecha = ?)');
    binds.push(params.fecha);
  } else {
    if (params?.startDate) {
      conditions.push('(fecha >= ?)');
      binds.push(params.startDate);
    }
    if (params?.endDate) {
      conditions.push('(fecha <= ?)');
      binds.push(params.endDate);
    }
  }

  if (params?.grupo && params.grupo !== 'ALL') {
    conditions.push('(replace(upper(grupo), " ", "") = ?)');
    binds.push(params.grupo.replace(/\s+/g, '').toUpperCase());
  }

  if (params?.tipo) {
    conditions.push('(tipo = ?)');
    binds.push(params.tipo);
  }

  const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

  // 1. Total count
  let total = 0;
  const countSql = `SELECT count(*) FROM attendance_records ${whereClause}`;
  const countStmt = db.prepare(countSql);
  if (binds.length > 0) countStmt.bind(binds);
  if (countStmt.step()) {
    total = Number(countStmt.get()[0] || 0);
  }
  countStmt.free();

  // 2. Query page records
  const dataSql = `SELECT data_json FROM attendance_records ${whereClause} ORDER BY fecha DESC, horaRegistrada DESC LIMIT ${pageSize} OFFSET ${offset}`;
  const dataStmt = db.prepare(dataSql);
  if (binds.length > 0) dataStmt.bind(binds);

  const records: any[] = [];
  while (dataStmt.step()) {
    const row = dataStmt.get();
    try {
      records.push(JSON.parse(row[0] as string));
    } catch {}
  }
  dataStmt.free();

  const totalPages = Math.ceil(total / pageSize) || 1;
  const hasMore = page < totalPages;

  return {
    records,
    total,
    page,
    pageSize,
    totalPages,
    hasMore,
  };
}

// ----------------- CHECADAS RETENTION & CLEANUP UTILITY -----------------
export function purgeOldAttendanceRecords(options?: {
  daysToKeep?: number;
  beforeDate?: string;
  deleteFromFirestore?: boolean;
}): {
  deletedCount: number;
  cutoffDate: string;
  remainingCount: number;
} {
  if (!db) {
    return { deletedCount: 0, cutoffDate: '', remainingCount: 0 };
  }

  let cutoffDate = options?.beforeDate;
  if (!cutoffDate) {
    const daysToKeep = options?.daysToKeep !== undefined ? options.daysToKeep : 60;
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - daysToKeep);
    cutoffDate = targetDate.toISOString().split('T')[0];
  }

  // Find count of records before cutoff
  let deletedCount = 0;
  const countStmt = db.prepare('SELECT count(*) FROM attendance_records WHERE fecha < ?');
  countStmt.bind([cutoffDate]);
  if (countStmt.step()) {
    deletedCount = Number(countStmt.get()[0] || 0);
  }
  countStmt.free();

  if (deletedCount > 0) {
    // Delete from SQLite local cache
    const delStmt = db.prepare('DELETE FROM attendance_records WHERE fecha < ?');
    delStmt.run([cutoffDate]);
    delStmt.free();
    persistDatabase(true);
    console.log(`🧹 [Caché Local SQLite] Se purgaron ${deletedCount} checadas anteriores a ${cutoffDate}.`);
  }

  // Count remaining
  let remainingCount = 0;
  const remStmt = db.prepare('SELECT count(*) FROM attendance_records');
  if (remStmt.step()) {
    remainingCount = Number(remStmt.get()[0] || 0);
  }
  remStmt.free();

  return {
    deletedCount,
    cutoffDate,
    remainingCount,
  };
}

// Direct SQL aggregate calculations for teacher dashboard metrics
export function getAttendanceStatsFromDb(startDate?: string, endDate?: string, grupo?: string) {
  if (!db) {
    return {
      total: 0,
      aTiempo: 0,
      retardos: 0,
      faltas: 0,
      justificadas: 0,
      byDate: [],
      byGroup: [],
    };
  }

  const conditions: string[] = [];
  const binds: any[] = [];

  if (startDate) {
    conditions.push('fecha >= ?');
    binds.push(startDate);
  }
  if (endDate) {
    conditions.push('fecha <= ?');
    binds.push(endDate);
  }
  if (grupo && grupo !== 'ALL') {
    conditions.push('replace(upper(grupo), " ", "") = ?');
    binds.push(grupo.replace(/\s+/g, '').toUpperCase());
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const stateQuery = `SELECT estado, count(*) as total FROM attendance_records ${whereClause} GROUP BY estado`;
  const stateStmt = db.prepare(stateQuery);
  if (binds.length > 0) stateStmt.bind(binds);

  let total = 0;
  let aTiempo = 0;
  let retardos = 0;
  let faltas = 0;
  let justificadas = 0;

  while (stateStmt.step()) {
    const row = stateStmt.get();
    const st = String(row[0] || '').toUpperCase();
    const count = Number(row[1] || 0);
    total += count;
    if (st === 'A_TIEMPO' || st === 'PRESENTE') aTiempo += count;
    else if (st === 'RETARDO') retardos += count;
    else if (st === 'FALTA' || st === 'INASISTENCIA') faltas += count;
    else if (st === 'JUSTIFICADA') justificadas += count;
  }
  stateStmt.free();

  const dateQuery = `SELECT fecha, estado, count(*) FROM attendance_records ${whereClause} GROUP BY fecha, estado ORDER BY fecha DESC LIMIT 60`;
  const dateStmt = db.prepare(dateQuery);
  if (binds.length > 0) dateStmt.bind(binds);

  const dateMap = new Map<string, { fecha: string; total: number; aTiempo: number; retardos: number; faltas: number }>();
  while (dateStmt.step()) {
    const row = dateStmt.get();
    const f = String(row[0]);
    const st = String(row[1]).toUpperCase();
    const count = Number(row[2]);

    if (!dateMap.has(f)) {
      dateMap.set(f, { fecha: f, total: 0, aTiempo: 0, retardos: 0, faltas: 0 });
    }
    const entry = dateMap.get(f)!;
    entry.total += count;
    if (st === 'A_TIEMPO' || st === 'PRESENTE') entry.aTiempo += count;
    else if (st === 'RETARDO') entry.retardos += count;
    else if (st === 'FALTA') entry.faltas += count;
  }
  dateStmt.free();

  return {
    total,
    aTiempo,
    retardos,
    faltas,
    justificadas,
    byDate: Array.from(dateMap.values()),
  };
}

export function saveRecordToDb(record: any): any {
  if (!db || !record || !record.id) return null;
  const resolvedEstado = (record.esJustificada || record.checkInStatus === 'JUSTIFICADA' || record.estado === 'JUSTIFICADA')
    ? 'JUSTIFICADA'
    : (record.checkInStatus || record.estado || 'A_TIEMPO');

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO attendance_records (
      id, studentId, matricula, studentNombre, grupo, equipo, siteId, siteNombre,
      fecha, tipo, horaRegistrada, estado, horaEsperada, toleranciaMinutos,
      minutosDiferencia, latitude, longitude, distanceMeters, accuracyMeters,
      dentroDeZona, deviceId, deviceName, verificadoPorGPS, esJustificada,
      motivoJustificante, data_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run([
    record.id,
    record.studentId || '',
    record.matricula ? String(record.matricula).trim() : '',
    record.studentNombre || '',
    record.grupo || '',
    record.equipo || '',
    record.siteId || '',
    record.siteNombre || '',
    record.fecha || '',
    record.tipo || (resolvedEstado === 'JUSTIFICADA' ? 'JUSTIFICANTE' : 'ENTRADA'),
    record.horaRegistrada || '',
    resolvedEstado,
    record.horaEsperada || '',
    record.toleranciaMinutos || 15,
    record.minutosDiferencia || 0,
    record.latitude || 0,
    record.longitude || 0,
    record.distanceMeters || 0,
    record.accuracyMeters || 0,
    record.dentroDeZona ? 1 : 0,
    record.deviceId || '',
    record.deviceName || '',
    record.verificadoPorGPS ? 1 : 0,
    (record.esJustificada || resolvedEstado === 'JUSTIFICADA') ? 1 : 0,
    record.motivoJustificante || '',
    JSON.stringify(record),
    record.fecha || new Date().toISOString(),
  ]);
  stmt.free();

  persistDatabase(true);

  if (isCloudSqlConfigured() && pgDb) {
    pgDb
      .insert(pgAttendanceRecords)
      .values({
        id: record.id,
        studentId: record.studentId || '',
        matricula: record.matricula ? String(record.matricula).trim() : '',
        studentNombre: record.studentNombre || '',
        grupo: record.grupo || '',
        equipo: record.equipo || '',
        siteId: record.siteId || '',
        siteNombre: record.siteNombre || '',
        fecha: record.fecha || '',
        tipo: record.tipo || (resolvedEstado === 'JUSTIFICADA' ? 'JUSTIFICANTE' : 'ENTRADA'),
        horaRegistrada: record.horaRegistrada || '',
        estado: resolvedEstado,
        horaEsperada: record.horaEsperada || '',
        toleranciaMinutos: Number(record.toleranciaMinutos) || 15,
        minutosDiferencia: Number(record.minutosDiferencia) || 0,
        latitude: Number(record.latitude) || 0,
        longitude: Number(record.longitude) || 0,
        distanceMeters: Number(record.distanceMeters) || 0,
        accuracyMeters: Number(record.accuracyMeters) || 0,
        dentroDeZona: record.dentroDeZona ? 1 : 0,
        deviceId: record.deviceId || '',
        deviceName: record.deviceName || '',
        verificadoPorGPS: record.verificadoPorGPS ? 1 : 0,
        esJustificada: (record.esJustificada || resolvedEstado === 'JUSTIFICADA') ? 1 : 0,
        motivoJustificante: record.motivoJustificante || '',
        dataJson: JSON.stringify(record),
        createdAt: record.fecha || new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: pgAttendanceRecords.id,
        set: {
          horaRegistrada: record.horaRegistrada || '',
          estado: resolvedEstado,
          esJustificada: (record.esJustificada || resolvedEstado === 'JUSTIFICADA') ? 1 : 0,
          motivoJustificante: record.motivoJustificante || '',
          dataJson: JSON.stringify(record),
        },
      })
      .catch((err) => markCloudSqlUnavailable(err));
  }

  syncRecordToFirestore(record).catch(() => {});

  return record;
}

export function deleteRecordFromDb(recordId: string): boolean {
  if (!db || !recordId) return false;
  const stmt = db.prepare(`DELETE FROM attendance_records WHERE id = ?`);
  stmt.run([recordId]);
  stmt.free();
  persistDatabase();

  if (isCloudSqlConfigured() && pgDb) {
    pgDb
      .delete(pgAttendanceRecords)
      .where(eq(pgAttendanceRecords.id, recordId))
      .catch((err) => markCloudSqlUnavailable(err));
  }

  deleteRecordFromFirestore(recordId).catch(() => {});

  return true;
}

export function getHolidaysFromDb(): any[] {
  if (!db) return [];
  const res = db.exec('SELECT fecha, descripcion, creadoPor, fechaCreacion FROM holidays ORDER BY fecha ASC');
  if (res.length === 0) return [];
  return res[0].values.map((row) => ({
    fecha: row[0],
    descripcion: row[1],
    creadoPor: row[2],
    fechaCreacion: row[3],
  }));
}

export function saveHolidayToDb(holiday: any) {
  if (!db || !holiday || !holiday.fecha) return;
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO holidays (fecha, descripcion, creadoPor, fechaCreacion)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run([
    holiday.fecha,
    holiday.descripcion || '',
    holiday.creadoPor || '',
    holiday.fechaCreacion || new Date().toISOString(),
  ]);
  stmt.free();
  persistDatabase();

  if (isCloudSqlConfigured() && pgDb) {
    pgDb
      .insert(pgHolidays)
      .values({
        fecha: holiday.fecha,
        descripcion: holiday.descripcion || '',
        creadoPor: holiday.creadoPor || '',
        fechaCreacion: holiday.fechaCreacion || new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: pgHolidays.fecha,
        set: {
          descripcion: holiday.descripcion || '',
          creadoPor: holiday.creadoPor || '',
          fechaCreacion: holiday.fechaCreacion || new Date().toISOString(),
        },
      })
      .catch((err) => markCloudSqlUnavailable(err));
  }

  syncHolidayToFirestore(holiday).catch(() => {});
}

export function deleteHolidayFromDb(fecha: string) {
  if (!db || !fecha) return;
  const stmt = db.prepare(`DELETE FROM holidays WHERE fecha = ?`);
  stmt.run([fecha]);
  stmt.free();
  persistDatabase();

  if (isCloudSqlConfigured() && pgDb) {
    pgDb
      .delete(pgHolidays)
      .where(eq(pgHolidays.fecha, fecha))
      .catch((err) => markCloudSqlUnavailable(err));
  }

  deleteHolidayFromFirestore(fecha).catch(() => {});
}

// Generate complete snapshot of the database
export function getAllDataSnapshot(): {
  hospitalZone: any;
  sites: any[];
  students: any[];
  records: any[];
  masterConfig: any;
  holidays: any[];
} {
  return {
    hospitalZone: getSystemConfig('hospitalZone', {
      id: 'site-1',
      nombre: 'Hospital General Los Mochis',
      direccion: 'Blvd. Macario Gaxiola y Av. Hidalgo, Los Mochis, Sin.',
      latitude: 25.7925,
      longitude: -108.996,
      radiusMeters: 150,
      horaEntrada: '07:00',
      horaSalida: '15:00',
      toleranciaMinutos: 15,
    }),
    sites: getSitesFromDb(),
    students: getStudentsFromDb(),
    records: getRecordsFromDb(),
    masterConfig: getSystemConfig('masterConfig', {
      usuario: 'Moch_Coord_AreaClinica',
      password: 'L0b0s2026',
      nombreDocente: 'Coordinación de Área Clínica',
    }),
    holidays: getHolidaysFromDb(),
  };
}
