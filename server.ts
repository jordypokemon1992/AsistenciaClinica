import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import {
  initDatabase,
  persistDatabase,
  getAllDataSnapshot,
  getStudentDataSnapshot,
  getGuestDataSnapshot,
  getTeacherDataSnapshot,
  getStudentRecordsFromSupabaseRelational,
  getStudentFromSupabaseRelational,
  getAttendanceStatsFromSupabaseRelational,
  getSitesFromDb,
  saveSiteToDb,
  deleteSiteFromDb,
  getStudentsFromDb,
  getStudentByMatriculaOrIdFromDb,
  saveStudentToDb,
  saveMultipleStudentsToDb,
  deleteStudentFromDb,
  linkStudentDeviceInDb,
  unlinkStudentDeviceInDb,
  unlinkAllDevicesInDb,
  getRecordsFromDb,
  getRecordsPaginatedFromDb,
  purgeOldAttendanceRecords,
  getAttendanceStatsFromDb,
  saveRecordToDb,
  deleteRecordFromDb,
  getHolidaysFromDb,
  saveHolidayToDb,
  deleteHolidayFromDb,
  getSystemConfig,
  setSystemConfig,
  importFullSnapshotToSqlite,
  analyzeStateDiffFromDb,
  createAutoBackupBeforeRestore,
  isSupabaseConfigured,
  isSupabaseHealthy,
  syncAllToSupabase,
  pullFromSupabaseToCache,
  performDeltaSyncFromSupabase,
  getSupabaseDiagnostics,
  getSupabaseStatusInfo,
  getPendingCloudSyncCount,
  processPendingCloudSyncQueue,
} from './src/server/db';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(process.cwd(), 'public')));

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'clinicas.db');
const STATE_FILE = path.join(DATA_DIR, 'app_state.json');
const ROOT_STATE_FILE = path.join(process.cwd(), 'app_state.json');

// SSE Clients Registry
let sseClients: express.Response[] = [];

function broadcastChange(type: string, payload?: any) {
  const message = `data: ${JSON.stringify({ type, payload, timestamp: Date.now() })}\n\n`;
  sseClients.forEach((client) => {
    try {
      client.write(message);
    } catch {
      // client connection closed
    }
  });
}

// Real-time Event Stream
app.get('/api/events', (_req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (res.flushHeaders) res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: Date.now() })}\n\n`);
  sseClients.push(res);

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 25000);

  _req.on('close', () => {
    clearInterval(heartbeat);
    sseClients = sseClients.filter((client) => client !== res);
  });
});

// Health Check APIs for Cloud Run / Kubernetes / App Health
app.get(['/api/health', '/health', '/healthz', '/_ah/health'], (_req, res) => {
  res.status(200).json({
    status: 'ok',
    server: 'ClinicasTrack Hybrid Backend',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    database: 'Supabase PostgreSQL + Local SQLite Fast Mirror',
    supabaseConfigured: isSupabaseConfigured(),
  });
});

// Cloud Database (Supabase PostgreSQL) Management APIs
const handleGetCloudStatus = (_req: express.Request, res: express.Response) => {
  const statusInfo = getSupabaseStatusInfo();
  res.json({
    configured: statusInfo.configured,
    provider: statusInfo.provider,
    status: statusInfo.status,
    circuitBreakerOpen: statusInfo.circuitBreakerOpen,
    lastSyncTimestamp: statusInfo.lastSyncTimestamp,
    lastSyncIso: statusInfo.lastSyncIso,
    message: statusInfo.message,
  });
};

const handleCloudSync = async (_req: express.Request, res: express.Response) => {
  try {
    const result = await syncAllToSupabase();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'Error sincronizando con Supabase' });
  }
};

const handleCloudPull = async (req: express.Request, res: express.Response) => {
  try {
    const forceFull = req.body?.forceFull === true;
    const result = await pullFromSupabaseToCache(forceFull);
    if (result.success && result.changed) {
      const snapshot = getAllDataSnapshot();
      broadcastChange('FULL_STATE_UPDATED', snapshot);
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'Error recuperando desde Supabase' });
  }
};

const handleCloudDiagnostics = async (_req: express.Request, res: express.Response) => {
  try {
    const diag = await getSupabaseDiagnostics();
    res.json(diag);
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'Error ejecutando diagnóstico de Supabase' });
  }
};

const handleRetryOutbox = async (_req: express.Request, res: express.Response) => {
  try {
    const result = await processPendingCloudSyncQueue();
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'Error procesando cola Outbox' });
  }
};

const handleDeltaSync = async (req: express.Request, res: express.Response) => {
  try {
    const daysBack = req.body?.attendanceDaysBack ? Number(req.body.attendanceDaysBack) : 7;
    const result = await performDeltaSyncFromSupabase({ attendanceDaysBack: daysBack });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'Error ejecutando Delta Sync' });
  }
};

app.get('/api/supabase/status', handleGetCloudStatus);
app.post('/api/supabase/sync', handleCloudSync);
app.post('/api/supabase/pull', handleCloudPull);
app.post('/api/supabase/delta-sync', handleDeltaSync);
app.get('/api/supabase/diagnostics', handleCloudDiagnostics);
app.post('/api/supabase/retry-outbox', handleRetryOutbox);

// Main sync endpoint: optimized relational responses per role (cuts egress & memory)
app.get('/api/sync', async (req, res) => {
  const { role, matricula, studentId, limit } = req.query;

  // 1. Student Portal: strictly read ONLY the lines corresponding to the student's matricula
  if (role === 'student' && (matricula || studentId)) {
    const cleanMat = String(matricula || studentId).trim();
    // If student is not yet in cache and Supabase is active, pull profile using indexed lookup
    let student = getStudentByMatriculaOrIdFromDb(cleanMat);
    if (!student && isSupabaseHealthy()) {
      student = await getStudentFromSupabaseRelational(cleanMat);
    }
    // Pull student's own attendance records (from SQLite cache or Supabase index)
    const snapshot = getStudentDataSnapshot(cleanMat);
    if (snapshot.records.length === 0 && isSupabaseHealthy()) {
      const cloudRecs = await getStudentRecordsFromSupabaseRelational(cleanMat, { limit: 150 });
      if (cloudRecs.length > 0) {
        snapshot.records = cloudRecs;
      }
    }
    return res.json(snapshot);
  }

  // 2. Guest login screen: 0 attendance records sent
  if (role === 'guest') {
    const snapshot = getGuestDataSnapshot();
    return res.json(snapshot);
  }

  // 3. Teacher Dashboard: bounded record limit for high performance and minimal Egress
  const recLimit = limit ? Number(limit) : 250;
  const snapshot = getTeacherDataSnapshot(recLimit);
  res.json(snapshot);
});

// Reload endpoint
app.get('/api/reload-state', (_req, res) => {
  const snapshot = getAllDataSnapshot();
  broadcastChange('FULL_STATE_UPDATED', snapshot);
  res.json({
    success: true,
    studentsCount: snapshot.students.length,
    sitesCount: snapshot.sites.length,
    recordsCount: snapshot.records.length,
    holidaysCount: snapshot.holidays.length,
    state: snapshot,
  });
});

app.post('/api/reload-state', (_req, res) => {
  const snapshot = getAllDataSnapshot();
  broadcastChange('FULL_STATE_UPDATED', snapshot);
  res.json({
    success: true,
    studentsCount: snapshot.students.length,
    sitesCount: snapshot.sites.length,
    recordsCount: snapshot.records.length,
    holidaysCount: snapshot.holidays.length,
    state: snapshot,
  });
});

// Analyze and compare incoming JSON against current SQLite database (.db)
app.post('/api/analyze-state-diff', (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ success: false, message: 'Invalid payload for diff analysis' });
  }

  const snapshotData = (body.data && typeof body.data === 'object') ? body.data : body;
  try {
    const analysis = analyzeStateDiffFromDb(snapshotData);
    res.json({
      success: true,
      analysis,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: `Error analizando diferencias: ${err.message}` });
  }
});

// Upload state backup into SQLite with auto-backup protection and detailed sync report
app.post('/api/upload-state', (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ success: false, message: 'Invalid state payload' });
  }

  // Handle both { data: {...}, mode: 'merge' | 'replace' } and direct snapshot objects
  const snapshotData = (body.data && typeof body.data === 'object') ? body.data : body;
  const mode: 'merge' | 'replace' = body.mode === 'replace' ? 'replace' : 'merge';

  try {
    // 1. Automatically generate a safety backup before restoring
    const backupFile = createAutoBackupBeforeRestore();

    // 2. Import into SQLite with chosen mode and get exact stats
    const syncResult = importFullSnapshotToSqlite(snapshotData, mode);
    persistDatabase(true);
    const snapshot = getAllDataSnapshot();
    broadcastChange('FULL_STATE_UPDATED', snapshot);
    syncAllToSupabase().catch((err) => console.warn('Upload-state supabase sync notice:', err));

    res.json({
      success: true,
      message: mode === 'merge'
        ? `Sincronización completada en clinicas.db: ${syncResult.studentsAdded} alumnos nuevos, ${syncResult.studentsUpdated} actualizados, ${syncResult.recordsAdded} checadas agregadas.`
        : 'Base de datos restaurada y sobrescrita en clinicas.db exitosamente.',
      backupCreated: backupFile,
      mode,
      syncResult,
      studentsCount: snapshot.students.length,
      sitesCount: snapshot.sites.length,
      recordsCount: snapshot.records.length,
      holidaysCount: snapshot.holidays.length,
      state: snapshot,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: `Error importando a SQLite: ${err.message}` });
  }
});

// Export SQLite database state as JSON
app.get('/api/export-state', (_req, res) => {
  const snapshot = getAllDataSnapshot();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="app_state.json"');
  res.send(JSON.stringify(snapshot, null, 2));
});

// Server system stats
app.get('/api/server-stats', (_req, res) => {
  const snapshot = getAllDataSnapshot();
  let dbMtime = 0;
  if (fs.existsSync(DB_FILE)) dbMtime = fs.statSync(DB_FILE).mtimeMs;

  res.json({
    status: 'ok',
    server: 'ClinicasTrack Express + SQLite Local',
    engine: 'SQLite 3 (ACID Engine)',
    dbFile: DB_FILE,
    jsonMirrorFile: STATE_FILE,
    rootJsonMirrorFile: ROOT_STATE_FILE,
    studentsCount: snapshot.students.length,
    activeStudentsCount: snapshot.students.filter((s: any) => s.activo !== false).length,
    linkedDevicesCount: snapshot.students.filter((s: any) => s.linkedDeviceId).length,
    recordsCount: snapshot.records.length,
    sitesCount: snapshot.sites.length,
    holidaysCount: snapshot.holidays.length,
    activeSseClients: sseClients.length,
    lastDbMtime: dbMtime > 0 ? new Date(dbMtime).toISOString() : null,
    lastUpdate: new Date().toISOString(),
  });
});

// ----------------- STUDENTS CRUD -----------------
app.get('/api/students', (_req, res) => {
  res.json(getStudentsFromDb());
});

app.get('/api/students/:identifier', (req, res) => {
  const { identifier } = req.params;
  const student = getStudentByMatriculaOrIdFromDb(identifier);
  if (student) {
    res.json(student);
  } else {
    res.status(404).json({ success: false, message: 'Student not found' });
  }
});

app.post('/api/students', (req, res) => {
  const body = req.body;
  if (Array.isArray(body)) {
    const savedList = saveMultipleStudentsToDb(body);
    const updatedList = getStudentsFromDb();
    broadcastChange('STUDENTS_UPDATED', updatedList);
    return res.json({ success: true, count: savedList.length, students: updatedList });
  } else if (body && typeof body === 'object') {
    const saved = saveStudentToDb(body);
    const updatedList = getStudentsFromDb();
    broadcastChange('STUDENTS_UPDATED', updatedList);
    return res.json({ success: true, student: saved, students: updatedList });
  }
  res.status(400).json({ success: false, message: 'Invalid payload' });
});

app.put('/api/students/:id', (req, res) => {
  const { id } = req.params;
  const body = req.body;
  const saved = saveStudentToDb({ ...body, id });
  if (saved) {
    broadcastChange('STUDENT_UPDATED', saved);
    res.json({ success: true, student: saved });
  } else {
    res.status(404).json({ success: false, message: 'Student not found' });
  }
});

app.delete('/api/students/:id', (req, res) => {
  const { id } = req.params;
  const deleted = deleteStudentFromDb(id);
  if (deleted) {
    broadcastChange('STUDENT_DELETED', { id });
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, message: 'Student not found' });
  }
});

// Device linking / unlinking
app.post('/api/students/link-device', (req, res) => {
  const { studentId, matricula, deviceId, deviceName } = req.body;
  if (!deviceId) {
    return res.status(400).json({ success: false, message: 'Device ID required' });
  }

  const updated = linkStudentDeviceInDb(studentId, matricula, deviceId, deviceName);
  if (updated) {
    broadcastChange('DEVICE_LINKED', updated);
    return res.json({ success: true, student: updated });
  }
  res.status(404).json({ success: false, message: 'Student not found for device link' });
});

app.post('/api/students/unlink-device', (req, res) => {
  const { studentId, matricula } = req.body;
  const unlinked = unlinkStudentDeviceInDb(studentId, matricula);
  if (unlinked) {
    broadcastChange('DEVICE_UNLINKED', { studentId, matricula });
    return res.json({ success: true });
  }
  res.status(404).json({ success: false, message: 'Student not found' });
});

app.post('/api/students/unlink-all-devices', (_req, res) => {
  const count = unlinkAllDevicesInDb();
  const students = getStudentsFromDb();
  broadcastChange('STUDENTS_UPDATED', students);
  res.json({ success: true, unlinkedCount: count, totalStudents: students.length });
});

// ----------------- ATTENDANCE RECORDS -----------------
// Optimized records endpoint with pagination, date ranges and filters
app.get('/api/records', (req, res) => {
  const {
    matricula,
    studentId,
    fecha,
    startDate,
    endDate,
    grupo,
    tipo,
    limit,
    offset,
    page,
    pageSize,
  } = req.query;

  // If page or pageSize is provided, return structured pagination
  if (page !== undefined || pageSize !== undefined) {
    const paginated = getRecordsPaginatedFromDb({
      matricula: matricula ? String(matricula) : undefined,
      studentId: studentId ? String(studentId) : undefined,
      fecha: fecha ? String(fecha) : undefined,
      startDate: startDate ? String(startDate) : undefined,
      endDate: endDate ? String(endDate) : undefined,
      grupo: grupo ? String(grupo) : undefined,
      tipo: tipo ? String(tipo) : undefined,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 50,
    });
    return res.json(paginated);
  }

  const records = getRecordsFromDb({
    matricula: matricula ? String(matricula) : undefined,
    studentId: studentId ? String(studentId) : undefined,
    fecha: fecha ? String(fecha) : undefined,
    startDate: startDate ? String(startDate) : undefined,
    endDate: endDate ? String(endDate) : undefined,
    grupo: grupo ? String(grupo) : undefined,
    tipo: tipo ? String(tipo) : undefined,
    limit: limit ? Number(limit) : undefined,
    offset: offset ? Number(offset) : undefined,
  });

  res.json(records);
});

// Endpoint to purge old attendance records (retention policy)
app.post('/api/records/purge-old', (req, res) => {
  const { retentionDays, daysToKeep = 60, beforeDate } = req.body || {};
  try {
    const days = Number(retentionDays || daysToKeep) || 60;
    const result = purgeOldAttendanceRecords({
      daysToKeep: days,
      beforeDate: beforeDate ? String(beforeDate) : undefined,
    });
    if (result.deletedCount > 0) {
      persistDatabase(true);
      const snapshot = getAllDataSnapshot();
      broadcastChange('FULL_STATE_UPDATED', snapshot);
    }
    res.json({
      success: true,
      purgedCount: result.deletedCount,
      deletedCount: result.deletedCount,
      cutoffDate: result.cutoffDate,
      remainingCount: result.remainingCount,
      message: `Se eliminaron ${result.deletedCount} registros de asistencia anteriores al ${result.cutoffDate}. Quedan ${result.remainingCount} registros activos en el caché local.`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: `Error al purgar registros antiguos: ${err.message}` });
  }
});

// Fast endpoint for students: downloads only their own records for current week/month, with optional cloud fetch for official reports
app.get('/api/students/:identifier/records', async (req, res) => {
  const { identifier } = req.params;
  const { startDate, endDate, limit, fetchFromCloud } = req.query;

  let student = getStudentByMatriculaOrIdFromDb(identifier);
  if (!student && isSupabaseHealthy()) {
    student = await getStudentFromSupabaseRelational(identifier);
  }

  if (!student) {
    return res.status(404).json({ success: false, message: 'Student not found' });
  }

  if (fetchFromCloud === 'true' && isSupabaseHealthy()) {
    try {
      const remote = await getStudentRecordsFromSupabaseRelational(student.matricula, {
        startDate: startDate ? String(startDate) : undefined,
        endDate: endDate ? String(endDate) : undefined,
        limit: limit ? Number(limit) : 250,
      });
      if (remote && remote.length > 0) {
        return res.json(remote);
      }
    } catch (err) {
      console.warn('Supabase fetch records notice:', err);
    }
  }

  const records = getRecordsFromDb({
    matricula: student.matricula,
    startDate: startDate ? String(startDate) : undefined,
    endDate: endDate ? String(endDate) : undefined,
    limit: limit ? Number(limit) : 250,
  });

  res.json(records);
});

// High-speed direct SQL aggregate stats for teacher dashboard (uses Supabase relational SQL GROUP BY if requested)
app.get('/api/attendance-stats', async (req, res) => {
  const { startDate, endDate, grupo, useCloud } = req.query;

  if (useCloud === 'true' && isSupabaseHealthy()) {
    const cloudStats = await getAttendanceStatsFromSupabaseRelational(
      startDate ? String(startDate) : undefined,
      endDate ? String(endDate) : undefined,
      grupo ? String(grupo) : undefined
    );
    if (cloudStats) return res.json(cloudStats);
  }

  const stats = getAttendanceStatsFromDb(
    startDate ? String(startDate) : undefined,
    endDate ? String(endDate) : undefined,
    grupo ? String(grupo) : undefined
  );
  res.json(stats);
});

app.post('/api/records', (req, res) => {
  const body = req.body;
  if (!body) {
    return res.status(400).json({ success: false, message: 'Invalid attendance payload' });
  }

  if (Array.isArray(body)) {
    const savedList: any[] = [];
    body.forEach((rec) => {
      if (rec && rec.id) {
        const s = saveRecordToDb(rec);
        if (s) savedList.push(s);
      }
    });
    const all = getRecordsFromDb();
    broadcastChange('RECORDS_UPDATED', all);
    return res.json({ success: true, count: all.length, records: all });
  }

  if (!body.id) {
    return res.status(400).json({ success: false, message: 'Invalid attendance record: missing id' });
  }

  const saved = saveRecordToDb(body);
  broadcastChange('RECORD_SAVED', saved);
  res.json({ success: true, record: saved });
});

app.delete('/api/records/:id', (req, res) => {
  const { id } = req.params;
  const deleted = deleteRecordFromDb(id);
  if (deleted) {
    broadcastChange('RECORD_DELETED', { id });
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, message: 'Record not found' });
  }
});

// ----------------- SITES & CONFIG -----------------
app.get('/api/sites', (_req, res) => {
  res.json(getSitesFromDb());
});

app.post('/api/sites', (req, res) => {
  const sites = req.body;
  if (Array.isArray(sites)) {
    sites.forEach((s) => {
      saveSiteToDb(s);
    });
    const allSites = getSitesFromDb();
    broadcastChange('SITES_UPDATED', allSites);
    return res.json({ success: true, sites: allSites });
  }
  res.status(400).json({ success: false, message: 'Expected array of sites' });
});

app.delete('/api/sites/:id', (req, res) => {
  const { id } = req.params;
  const deleted = deleteSiteFromDb(id);
  if (deleted) {
    const allSites = getSitesFromDb();
    broadcastChange('SITES_UPDATED', allSites);
    return res.json({ success: true, sites: allSites });
  }
  res.status(404).json({ success: false, message: 'Site not found' });
});

app.post('/api/hospital', (req, res) => {
  const zone = req.body;
  if (zone) {
    setSystemConfig('hospitalZone', zone);
    persistDatabase();
    broadcastChange('HOSPITAL_UPDATED', zone);
    return res.json({ success: true, hospitalZone: zone });
  }
  res.status(400).json({ success: false, message: 'Invalid hospital zone' });
});

app.post('/api/master', (req, res) => {
  const config = req.body;
  if (config) {
    setSystemConfig('masterConfig', config);
    persistDatabase();
    broadcastChange('MASTER_UPDATED', config);
    return res.json({ success: true, masterConfig: config });
  }
  res.status(400).json({ success: false, message: 'Invalid master config' });
});

app.get('/api/holidays', (_req, res) => {
  res.json(getHolidaysFromDb());
});

app.post('/api/holidays', (req, res) => {
  const holidays = req.body;
  if (Array.isArray(holidays)) {
    holidays.forEach((h) => {
      saveHolidayToDb(h);
    });
    const allHols = getHolidaysFromDb();
    broadcastChange('HOLIDAYS_UPDATED', allHols);
    return res.json({ success: true, holidays: allHols });
  }
  res.status(400).json({ success: false, message: 'Expected array of holidays' });
});

app.delete('/api/holidays/:fecha', (req, res) => {
  const { fecha } = req.params;
  deleteHolidayFromDb(fecha);
  const allHols = getHolidaysFromDb();
  broadcastChange('HOLIDAYS_UPDATED', allHols);
  res.json({ success: true, holidays: allHols });
});

app.post('/api/full-backup', (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ success: false, message: 'Invalid full backup payload' });
  }

  importFullSnapshotToSqlite(body);
  persistDatabase();
  const snapshot = getAllDataSnapshot();
  broadcastChange('FULL_STATE_UPDATED', snapshot);

  res.json({ success: true, state: snapshot });
});

async function startServer() {
  try {
    // Initialize SQLite database
    console.log('⚡ Initializing Local SQLite Engine...');
    await initDatabase();
    console.log('✅ SQLite Engine is live.');
  } catch (dbErr) {
    console.error('⚠️ Notice initializing database (non-fatal):', dbErr);
  }

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    // Hashed static assets (Vite bundles) can be safely cached
    app.use('/assets', express.static(path.join(distPath, 'assets'), {
      maxAge: '1y',
      immutable: true,
    }));

    // Service Worker must always be fresh
    app.get('/sw.js', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Content-Type', 'application/javascript');
      res.sendFile(path.join(process.cwd(), 'public', 'sw.js'));
    });

    // General static files with no-cache for HTML files
    app.use(express.static(distPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      },
    }));

    // SPA fallback
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 ClinicasTrack Server running on http://0.0.0.0:${PORT}`);
    if (isSupabaseConfigured()) {
      console.log('✅ Supabase PostgreSQL activo como espejo en la nube + SQLite Local.');
    } else {
      console.log('⚡ Local-first SQLite & in-memory cache ready.');
    }
  });
}

startServer();
