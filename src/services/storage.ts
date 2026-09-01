import { Student, HospitalZone, HospitalSite, AttendanceRecord, DiaInhabil } from '../types';
import {
  INITIAL_HOSPITAL_SITES,
  INITIAL_HOSPITAL_ZONE,
  INITIAL_STUDENTS,
  generateInitialAttendanceRecords,
} from '../utils/mockData';
import { sortDaysArray, sortDaySchedules } from '../utils/dayUtils';

const KEYS = {
  HOSPITAL: 'hosp_attendance_zone',
  SITES: 'hosp_attendance_sites',
  STUDENTS: 'hosp_attendance_students',
  RECORDS: 'hosp_attendance_records',
  MASTER: 'hosp_master_config',
  RECENT_LOGINS: 'hosp_recent_student_logins',
  HOLIDAYS: 'hosp_dias_inhabiles',
};

export interface MasterConfig {
  usuario: string;
  password: string;
  nombreDocente: string;
}

export const INITIAL_MASTER_CONFIG: MasterConfig = {
  usuario: 'Moch_Coord_AreaClinica',
  password: 'L0b0s2026',
  nombreDocente: 'Coordinación de Área Clínica',
};

// Safe student merge helper on the client
export function mergeClientStudentSafely(existing: Student | null | undefined, incoming: Student): Student {
  const sanitized = sanitizeStudentSchedules(incoming);
  if (!existing) {
    return {
      ...sanitized,
      updatedAt: sanitized.updatedAt || new Date().toISOString(),
    };
  }

  // Compare timestamps to know if existing (local) or incoming (server/edit) is more recent
  const existingTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
  const incomingTime = sanitized.updatedAt ? new Date(sanitized.updatedAt).getTime() : 0;
  const isExistingNewer = existingTime > incomingTime && existingTime > 0;

  // The more recent object is the primary source of truth
  const primary = isExistingNewer ? existing : sanitized;
  const secondary = isExistingNewer ? sanitized : existing;

  // 1. Device Lock: Never overwrite an existing device link with null
  const preservedDeviceId = sanitized.linkedDeviceId !== undefined ? sanitized.linkedDeviceId : (existing.linkedDeviceId ?? null);
  const preservedDeviceName = sanitized.linkedDeviceName !== undefined ? sanitized.linkedDeviceName : (existing.linkedDeviceName ?? null);
  const preservedLinkedAt = sanitized.linkedAt !== undefined ? sanitized.linkedAt : (existing.linkedAt ?? null);

  // 2. Schedule & Sede Preservation
  const rawResolvedHorarios = (primary.horariosPorDia && primary.horariosPorDia.length > 0)
    ? primary.horariosPorDia
    : (secondary.horariosPorDia && secondary.horariosPorDia.length > 0)
    ? secondary.horariosPorDia
    : [];
  const resolvedHorarios = sortDaySchedules(rawResolvedHorarios);

  const rawResolvedDias = (primary.diasAsistencia && primary.diasAsistencia.length > 0)
    ? primary.diasAsistencia
    : (secondary.diasAsistencia && secondary.diasAsistencia.length > 0)
    ? secondary.diasAsistencia
    : (resolvedHorarios.length > 0 ? resolvedHorarios.map((h) => h.dia) : ['Lunes', 'Miércoles']);
  const resolvedDias = sortDaysArray(rawResolvedDias);

  const resolvedSedeId = primary.sedeId || secondary.sedeId || 'site-1';
  const resolvedSedeNombre = primary.sedeNombre || secondary.sedeNombre || 'Sede Principal';
  const resolvedSecondarySedeId = primary.secondarySedeId !== undefined ? primary.secondarySedeId : secondary.secondarySedeId;
  const resolvedSecondarySedeNombre = primary.secondarySedeNombre !== undefined ? primary.secondarySedeNombre : secondary.secondarySedeNombre;

  const resolvedHoraEntrada = primary.horaEntrada || (resolvedHorarios[0]?.horaEntrada) || secondary.horaEntrada || '07:00';
  const resolvedHoraSalida = primary.horaSalida || (resolvedHorarios[0]?.horaSalida) || secondary.horaSalida || '15:00';
  const resolvedTolerancia = primary.toleranciaMinutos !== undefined ? primary.toleranciaMinutos : (secondary.toleranciaMinutos ?? 15);

  return {
    ...secondary,
    ...primary,
    id: existing.id || sanitized.id,
    matricula: (primary.matricula || secondary.matricula || '').trim(),
    nombre: primary.nombre || secondary.nombre,
    grupo: primary.grupo || secondary.grupo || '10 A',
    equipo: primary.equipo || secondary.equipo || 'Equipo 1',
    especialidad: primary.especialidad || secondary.especialidad || 'Urgencias Médicas',
    rotacion: primary.rotacion || secondary.rotacion || primary.especialidad || 'Urgencias Médicas',
    diasAsistencia: resolvedDias,
    horariosPorDia: resolvedHorarios,
    sedeId: resolvedSedeId,
    sedeNombre: resolvedSedeNombre,
    secondarySedeId: resolvedSecondarySedeId,
    secondarySedeNombre: resolvedSecondarySedeNombre,
    horaEntrada: resolvedHoraEntrada,
    horaSalida: resolvedHoraSalida,
    toleranciaMinutos: resolvedTolerancia,
    linkedDeviceId: preservedDeviceId,
    linkedDeviceName: preservedDeviceName,
    linkedAt: preservedLinkedAt,
    activo: primary.activo !== undefined ? primary.activo : (secondary.activo !== undefined ? secondary.activo : true),
    updatedAt: (isExistingNewer ? existing.updatedAt : sanitized.updatedAt) || new Date().toISOString(),
  };
}

// Sync helper from Express Backend API (Client reads authoritative server state)
let isSyncingBackend = false;
let pendingSyncAgain = false;

export async function syncFromExpressBackend(): Promise<void> {
  if (isSyncingBackend) {
    pendingSyncAgain = true;
    return;
  }
  isSyncingBackend = true;
  try {
    const res = await fetch('/api/sync');
    if (res.ok) {
      const data = await res.json();
      if (data.hospitalZone) localStorage.setItem(KEYS.HOSPITAL, JSON.stringify(data.hospitalZone));
      if (Array.isArray(data.sites) && data.sites.length > 0) {
        localStorage.setItem(KEYS.SITES, JSON.stringify(data.sites));
      }
      if (Array.isArray(data.students)) {
        localStorage.setItem(KEYS.STUDENTS, JSON.stringify(data.students.map(sanitizeStudentSchedules)));
      }
      if (data.masterConfig) localStorage.setItem(KEYS.MASTER, JSON.stringify(data.masterConfig));
      if (Array.isArray(data.holidays)) {
        localStorage.setItem(KEYS.HOLIDAYS, JSON.stringify(data.holidays));
      }
      if (Array.isArray(data.records)) {
        localStorage.setItem(KEYS.RECORDS, JSON.stringify(data.records));
      }
    }
  } catch {
    // Quietly ignore transient network hiccups
  } finally {
    isSyncingBackend = false;
    if (pendingSyncAgain) {
      pendingSyncAgain = false;
      syncFromExpressBackend().catch(() => {});
    }
  }
}

// Force reload state directly from server's app_state.json file
export async function forceReloadStateFromServer(): Promise<{
  success: boolean;
  studentsCount: number;
  sitesCount: number;
  recordsCount: number;
  holidaysCount: number;
}> {
  try {
    const res = await fetch('/api/reload-state', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      if (data.state) {
        if (data.state.hospitalZone) localStorage.setItem(KEYS.HOSPITAL, JSON.stringify(data.state.hospitalZone));
        if (Array.isArray(data.state.sites)) localStorage.setItem(KEYS.SITES, JSON.stringify(data.state.sites));
        if (Array.isArray(data.state.students)) localStorage.setItem(KEYS.STUDENTS, JSON.stringify(data.state.students));
        if (Array.isArray(data.state.records)) localStorage.setItem(KEYS.RECORDS, JSON.stringify(data.state.records));
        if (data.state.masterConfig) localStorage.setItem(KEYS.MASTER, JSON.stringify(data.state.masterConfig));
        if (Array.isArray(data.state.holidays)) localStorage.setItem(KEYS.HOLIDAYS, JSON.stringify(data.state.holidays));
      }
      return {
        success: true,
        studentsCount: data.studentsCount ?? 0,
        sitesCount: data.sitesCount ?? 0,
        recordsCount: data.recordsCount ?? 0,
        holidaysCount: data.holidaysCount ?? 0,
      };
    }
  } catch (err) {
    console.warn('Error reloading state from server:', err);
  }
  return { success: false, studentsCount: 0, sitesCount: 0, recordsCount: 0, holidaysCount: 0 };
}

export interface StateDiffAnalysis {
  students: {
    totalIncoming: number;
    totalInDb: number;
    added: {
      id: string;
      matricula: string;
      nombre: string;
      grupo: string;
      equipo: string;
      sedeNombre?: string;
      horariosCount?: number;
    }[];
    modified: {
      id: string;
      matricula: string;
      nombre: string;
      grupo: string;
      equipo: string;
      changes: string[];
      oldSummary: string;
      newSummary: string;
    }[];
    unchangedCount: number;
  };
  records: {
    totalIncoming: number;
    totalInDb: number;
    newRecordsCount: number;
    existingRecordsCount: number;
    latestIncomingDate: string;
    latestDbDate: string;
  };
  sites: {
    totalIncoming: number;
    totalInDb: number;
    added: string[];
    modified: string[];
    unchangedCount: number;
  };
  holidays: {
    totalIncoming: number;
    totalInDb: number;
    added: string[];
    unchangedCount: number;
  };
  summary: {
    hasChanges: boolean;
    totalChangesCount: number;
    recommendation: 'merge' | 'replace' | 'none';
    warningReasons: string[];
  };
}

// Analyze differences between incoming JSON state and SQLite server database
export async function analyzeStateFileWithServer(data: any): Promise<{
  success: boolean;
  analysis?: StateDiffAnalysis;
  message?: string;
}> {
  try {
    const res = await fetch('/api/analyze-state-diff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
    if (res.ok) {
      const resp = await res.json();
      return { success: true, analysis: resp.analysis };
    }
    const errData = await res.json().catch(() => ({}));
    return { success: false, message: errData.message || 'Error al analizar el archivo' };
  } catch (err: any) {
    return { success: false, message: err.message || 'Error de conexión con el servidor SQLite' };
  }
}

// Upload state snapshot directly to SQLite server with merge/replace mode and auto-backup
export async function uploadStateFileToServer(data: any, mode: 'merge' | 'replace' = 'merge'): Promise<{
  success: boolean;
  message: string;
  backupCreated?: string | null;
  syncResult?: {
    studentsAdded: number;
    studentsUpdated: number;
    recordsAdded: number;
    recordsUpdated: number;
    sitesAdded: number;
    sitesUpdated: number;
    holidaysAdded: number;
  };
  stats?: { students: number; sites: number; records: number; holidays: number };
}> {
  try {
    const res = await fetch('/api/upload-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, mode }),
    });
    if (res.ok) {
      const respData = await res.json();
      await syncFromExpressBackend();
      return {
        success: true,
        message: respData.message || (mode === 'merge' ? 'Datos combinados con éxito en clinicas.db.' : 'Base de datos restaurada con éxito en clinicas.db.'),
        backupCreated: respData.backupCreated || null,
        syncResult: respData.syncResult,
        stats: {
          students: respData.studentsCount ?? 0,
          sites: respData.sitesCount ?? 0,
          records: respData.recordsCount ?? 0,
          holidays: respData.holidaysCount ?? 0,
        },
      };
    }
    const errData = await res.json().catch(() => ({}));
    return { success: false, message: errData.message || 'El servidor rechazó el archivo JSON.' };
  } catch (err: any) {
    return { success: false, message: `Error al subir archivo: ${err.message}` };
  }
}

// Initialize localStorage if empty
export function initializeStorage(): void {
  if (!localStorage.getItem(KEYS.HOSPITAL)) {
    localStorage.setItem(KEYS.HOSPITAL, JSON.stringify(INITIAL_HOSPITAL_ZONE));
  }
  if (!localStorage.getItem(KEYS.SITES)) {
    localStorage.setItem(KEYS.SITES, JSON.stringify(INITIAL_HOSPITAL_SITES));
  }
  if (!localStorage.getItem(KEYS.STUDENTS)) {
    localStorage.setItem(KEYS.STUDENTS, JSON.stringify(INITIAL_STUDENTS));
  }
  if (!localStorage.getItem(KEYS.RECORDS)) {
    localStorage.setItem(
      KEYS.RECORDS,
      JSON.stringify(generateInitialAttendanceRecords())
    );
  }
  if (!localStorage.getItem(KEYS.MASTER)) {
    localStorage.setItem(KEYS.MASTER, JSON.stringify(INITIAL_MASTER_CONFIG));
  }
}

// Reset to initial demo state
export function resetDemoData(): void {
  localStorage.setItem(KEYS.HOSPITAL, JSON.stringify(INITIAL_HOSPITAL_ZONE));
  localStorage.setItem(KEYS.SITES, JSON.stringify(INITIAL_HOSPITAL_SITES));
  localStorage.setItem(KEYS.STUDENTS, JSON.stringify(INITIAL_STUDENTS));
  localStorage.setItem(
    KEYS.RECORDS,
    JSON.stringify(generateInitialAttendanceRecords())
  );
  localStorage.setItem(KEYS.MASTER, JSON.stringify(INITIAL_MASTER_CONFIG));
  localStorage.setItem(KEYS.HOLIDAYS, JSON.stringify([]));

  // Push reset request to Express backend
  fetch('/api/reset', { method: 'POST' }).catch(console.warn);
}

// Master Config API
export function getMasterConfig(): MasterConfig {
  initializeStorage();
  try {
    const data = localStorage.getItem(KEYS.MASTER);
    if (data) {
      const parsed: MasterConfig = JSON.parse(data);
      if (parsed.usuario === 'DOCENTE') {
        saveMasterConfig(INITIAL_MASTER_CONFIG);
        return INITIAL_MASTER_CONFIG;
      }
      return parsed;
    }
    return INITIAL_MASTER_CONFIG;
  } catch {
    return INITIAL_MASTER_CONFIG;
  }
}

export function saveMasterConfig(config: MasterConfig): void {
  localStorage.setItem(KEYS.MASTER, JSON.stringify(config));
  fetch('/api/master', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  }).catch(console.warn);
}

export function verifyMasterAuth(usuarioInput: string, passwordInput: string): boolean {
  const master = getMasterConfig();
  return (
    usuarioInput.trim().toUpperCase() === master.usuario.trim().toUpperCase() &&
    passwordInput === master.password
  );
}

// Hospital Sites API (Multiple Locations)
export function getHospitalSites(): HospitalSite[] {
  initializeStorage();
  try {
    const data = localStorage.getItem(KEYS.SITES);
    return data ? JSON.parse(data) : INITIAL_HOSPITAL_SITES;
  } catch {
    return INITIAL_HOSPITAL_SITES;
  }
}

export function getHospitalSiteById(siteId: string): HospitalSite {
  const sites = getHospitalSites();
  return (
    sites.find((s) => s.id === siteId) ||
    sites[0] || {
      id: 'default',
      nombre: 'Sede Principal ClinicasTrack',
      direccion: 'Dirección no especificada',
      latitude: 19.4125,
      longitude: -99.155,
      radiusMeters: 150,
      horaEntrada: '07:00',
      horaSalida: '15:00',
      toleranciaMinutos: 15,
    }
  );
}

export function saveHospitalSite(site: HospitalSite): void {
  const sites = getHospitalSites();
  const index = sites.findIndex((s) => s.id === site.id);
  if (index >= 0) {
    sites[index] = site;
  } else {
    sites.push(site);
  }
  localStorage.setItem(KEYS.SITES, JSON.stringify(sites));
  if (index === 0 || sites.length === 1) {
    saveHospitalZone(site);
  }

  fetch('/api/sites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sites),
  }).catch(console.warn);
}

export function deleteHospitalSite(siteId: string): void {
  const sites = getHospitalSites().filter((s) => s.id !== siteId);
  if (sites.length > 0) {
    localStorage.setItem(KEYS.SITES, JSON.stringify(sites));
    saveHospitalZone(sites[0]);
  }

  fetch('/api/sites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sites),
  }).catch(console.warn);
}

// Hospital Zone API
export function getHospitalZone(): HospitalZone {
  initializeStorage();
  try {
    const data = localStorage.getItem(KEYS.HOSPITAL);
    return data ? JSON.parse(data) : INITIAL_HOSPITAL_ZONE;
  } catch {
    return INITIAL_HOSPITAL_ZONE;
  }
}

export function saveHospitalZone(zone: HospitalZone): void {
  localStorage.setItem(KEYS.HOSPITAL, JSON.stringify(zone));
  fetch('/api/hospital', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(zone),
  }).catch(console.warn);
}

// Students API
// Disabled autoHealStudentDevices to prevent restoring legacy device IDs from old attendance records after unlinking.
export function autoHealStudentDevices(): void {
  // No-op: Do not auto-populate device IDs from historic attendance logs.
}

export function sanitizeStudentSchedules(student: Student): Student {
  if (!student) return student;

  let horariosPorDia = student.horariosPorDia;
  const diasAsistencia = sortDaysArray(student.diasAsistencia || []);

  if (!horariosPorDia || !Array.isArray(horariosPorDia) || horariosPorDia.length === 0) {
    if (diasAsistencia.length > 0) {
      const ent = student.horaEntrada || '07:00';
      const sal = student.horaSalida || '15:00';
      horariosPorDia = diasAsistencia.map((d) => ({
        dia: d,
        horaEntrada: ent,
        horaSalida: sal,
        turnos: [{ horaEntrada: ent, horaSalida: sal }],
        toleranciaMinutos: student.toleranciaMinutos || 15,
      }));
    }
  }

  if (horariosPorDia && horariosPorDia.length > 0) {
    const cleanedHorarios = sortDaySchedules(horariosPorDia.map((h) => {
      const turnos = Array.isArray(h.turnos) && h.turnos.length > 0
        ? h.turnos
        : [{ horaEntrada: h.horaEntrada || student.horaEntrada || '07:00', horaSalida: h.horaSalida || student.horaSalida || '15:00' }];

      const primaryEntrada = turnos[0]?.horaEntrada || h.horaEntrada || student.horaEntrada || '07:00';
      const primarySalida = turnos[turnos.length - 1]?.horaSalida || h.horaSalida || student.horaSalida || '15:00';

      return {
        ...h,
        horaEntrada: primaryEntrada,
        horaSalida: primarySalida,
        turnos,
        toleranciaMinutos: h.toleranciaMinutos || student.toleranciaMinutos || 15,
      };
    }));

    const primaryEntrada = cleanedHorarios[0]?.horaEntrada || student.horaEntrada || '07:00';
    const primarySalida = cleanedHorarios[0]?.horaSalida || student.horaSalida || '15:00';

    return {
      ...student,
      diasAsistencia,
      horaEntrada: primaryEntrada,
      horaSalida: primarySalida,
      horariosPorDia: cleanedHorarios,
    };
  }

  return {
    ...student,
    diasAsistencia,
  };
}

export function getStudents(): Student[] {
  initializeStorage();
  try {
    const data = localStorage.getItem(KEYS.STUDENTS);
    const rawStudents: Student[] = data ? JSON.parse(data) : [];

    const cleaned = rawStudents.filter((s) => {
      const lowerMat = (s.matricula || '').toLowerCase().trim();
      const lowerName = (s.nombre || '').toLowerCase().trim();
      return (
        !lowerMat.includes('prieba') &&
        !lowerName.includes('prieba') &&
        !lowerMat.includes('prueba') &&
        !lowerName.includes('prueba') &&
        lowerMat !== '123456' &&
        lowerMat !== '012345'
      );
    });

    return cleaned.map(sanitizeStudentSchedules);
  } catch {
    return [];
  }
}

export function getRecentStudentLogins(): Student[] {
  initializeStorage();
  try {
    const raw = localStorage.getItem(KEYS.RECENT_LOGINS);
    if (!raw) return [];
    const recentMatriculas: string[] = JSON.parse(raw);
    const allStudents = getStudents();

    const recentStudents: Student[] = [];
    for (const mat of recentMatriculas) {
      const st = allStudents.find((s) => isMatriculaMatch(s.matricula, mat) && s.activo);
      if (st && !recentStudents.some((rs) => rs.id === st.id)) {
        recentStudents.push(st);
      }
    }
    return recentStudents;
  } catch {
    return [];
  }
}

export function addRecentStudentLogin(matricula: string): void {
  initializeStorage();
  try {
    const raw = localStorage.getItem(KEYS.RECENT_LOGINS);
    let recentMatriculas: string[] = raw ? JSON.parse(raw) : [];
    recentMatriculas = recentMatriculas.filter((m) => m.trim() !== matricula.trim());
    recentMatriculas.unshift(matricula.trim());
    recentMatriculas = recentMatriculas.slice(0, 4);
    localStorage.setItem(KEYS.RECENT_LOGINS, JSON.stringify(recentMatriculas));
  } catch (err) {
    console.warn('Error saving recent login:', err);
  }
}

export function isMatriculaMatch(mat1: string | number | null | undefined, mat2: string | number | null | undefined): boolean {
  if (mat1 === null || mat1 === undefined || mat2 === null || mat2 === undefined) return false;
  const str1 = String(mat1).trim().toLowerCase();
  const str2 = String(mat2).trim().toLowerCase();
  if (!str1 || !str2) return false;
  if (str1 === str2) return true;

  const clean1 = str1.replace(/[^a-z0-9]/g, '');
  const clean2 = str2.replace(/[^a-z0-9]/g, '');
  if (clean1 && clean2 && clean1 === clean2) return true;

  const noZero1 = clean1.replace(/^0+/, '');
  const noZero2 = clean2.replace(/^0+/, '');
  if (noZero1 && noZero2 && noZero1 === noZero2) return true;

  return false;
}

export function updateLocalStudent(cloudSt: Student): void {
  if (!cloudSt) return;
  const localStudents = getStudents();
  const idx = localStudents.findIndex(
    (s) =>
      s.id === cloudSt.id ||
      (s.matricula && cloudSt.matricula && isMatriculaMatch(s.matricula, cloudSt.matricula))
  );
  if (idx >= 0) {
    localStudents[idx] = mergeClientStudentSafely(localStudents[idx], cloudSt);
  } else {
    localStudents.push(mergeClientStudentSafely(null, cloudSt));
  }
  localStorage.setItem(KEYS.STUDENTS, JSON.stringify(localStudents));
}

export function getStudentByMatricula(matricula: string | number): Student | null {
  const students = getStudents();
  if (!students || students.length === 0) return null;
  return students.find((s) => isMatriculaMatch(s.matricula, matricula)) || null;
}

export async function getStudentByMatriculaAsync(matricula: string | number): Promise<Student | null> {
  await syncFromExpressBackend();
  return getStudentByMatricula(matricula);
}

export function saveStudent(student: Student): void {
  const updatedStudent: Student = {
    ...student,
    updatedAt: new Date().toISOString(),
  };
  const sanitized = sanitizeStudentSchedules(updatedStudent);
  const students = getStudents();
  const index = students.findIndex(
    (s) =>
      s.id === sanitized.id ||
      (s.matricula && sanitized.matricula && isMatriculaMatch(s.matricula, sanitized.matricula))
  );
  if (index >= 0) {
    students[index] = sanitized;
  } else {
    students.push(sanitized);
  }
  localStorage.setItem(KEYS.STUDENTS, JSON.stringify(students));

  fetch('/api/students', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sanitized),
  }).catch(console.warn);
}

export function saveStudentsList(studentsList: Student[]): void {
  const now = new Date().toISOString();
  const sanitizedList = studentsList.map((st) =>
    sanitizeStudentSchedules({
      ...st,
      updatedAt: now,
    })
  );

  const currentStudents = getStudents();
  const updatedIdSet = new Set(sanitizedList.map((s) => s.id));
  const updatedMatSet = new Set(
    sanitizedList.filter((s) => s.matricula).map((s) => String(s.matricula).trim().toLowerCase())
  );

  const remaining = currentStudents.filter((cs) => {
    if (!cs) return false;
    if (cs.id && updatedIdSet.has(cs.id)) return false;
    if (cs.matricula && updatedMatSet.has(String(cs.matricula).trim().toLowerCase())) return false;
    return true;
  });

  const mergedList = [...remaining, ...sanitizedList];
  localStorage.setItem(KEYS.STUDENTS, JSON.stringify(mergedList));

  fetch('/api/students', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sanitizedList),
  }).catch(console.warn);
}

export function deleteStudent(studentId: string): void {
  const students = getStudents().filter((s) => s.id !== studentId);
  localStorage.setItem(KEYS.STUDENTS, JSON.stringify(students));

  fetch(`/api/students/${encodeURIComponent(studentId)}`, {
    method: 'DELETE',
  }).catch(console.warn);
}

export function unlinkStudentDevice(studentId: string): Student | null {
  const students = getStudents();
  const student = students.find(
    (s) => s.id === studentId || (s.matricula && isMatriculaMatch(s.matricula, studentId))
  );
  if (student) {
    student.linkedDeviceId = null;
    student.linkedDeviceName = null;
    student.linkedAt = null;
    localStorage.setItem(KEYS.STUDENTS, JSON.stringify(students));

    fetch('/api/students/unlink-device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: student.id, matricula: student.matricula }),
    }).catch(console.warn);

    return student;
  }
  return null;
}

export async function unlinkAllStudentDevices(): Promise<boolean> {
  const students = getStudents();
  students.forEach((s) => {
    s.linkedDeviceId = null;
    s.linkedDeviceName = null;
    s.linkedAt = null;
  });
  localStorage.setItem(KEYS.STUDENTS, JSON.stringify(students));

  try {
    const res = await fetch('/api/students/unlink-all-devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok) {
      return true;
    }
  } catch (err) {
    console.warn('Error calling unlink-all-devices endpoint:', err);
  }

  // Fallback: sync cleared list via POST /api/students?replace=true
  try {
    await fetch('/api/students?replace=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(students),
    });
    return true;
  } catch {
    return false;
  }
}

export function linkStudentDevice(
  studentId: string,
  deviceId: string,
  deviceName: string
): Student | null {
  const students = getStudents();

  const existingDeviceOwner = students.find(
    (s) => (s.id !== studentId && !isMatriculaMatch(s.matricula, studentId)) && s.linkedDeviceId === deviceId
  );
  if (existingDeviceOwner) {
    console.warn(
      `[Seguridad Dispositivo] El dispositivo "${deviceId}" ya está vinculado al alumno "${existingDeviceOwner.nombre}" (${existingDeviceOwner.matricula}).`
    );
    return null;
  }

  const student = students.find(
    (s) => s.id === studentId || (s.matricula && isMatriculaMatch(s.matricula, studentId))
  );
  if (student) {
    const linkedAt = new Date().toISOString();
    student.linkedDeviceId = deviceId;
    student.linkedDeviceName = deviceName;
    student.linkedAt = linkedAt;
    localStorage.setItem(KEYS.STUDENTS, JSON.stringify(students));

    fetch('/api/students/link-device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: student.id,
        matricula: student.matricula,
        deviceId,
        deviceName,
      }),
    }).catch(console.warn);

    return student;
  }
  return null;
}

// Attendance Records API
export function getAttendanceRecords(): AttendanceRecord[] {
  initializeStorage();
  try {
    const data = localStorage.getItem(KEYS.RECORDS);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// Download only the current student's records from server (fast and lightweight)
export async function fetchStudentRecordsFromServer(matriculaOrId: string, startDate?: string, endDate?: string): Promise<AttendanceRecord[]> {
  try {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    params.append('limit', '80');

    const res = await fetch(`/api/students/${encodeURIComponent(matriculaOrId)}/records?${params.toString()}`);
    if (res.ok) {
      const records: AttendanceRecord[] = await res.json();
      if (Array.isArray(records)) {
        // Cache in local records map
        const local = getAttendanceRecords();
        const map = new Map<string, AttendanceRecord>();
        local.forEach((r) => { if (r && r.id) map.set(r.id, r); });
        records.forEach((r) => { if (r && r.id) map.set(r.id, r); });
        const merged = Array.from(map.values());
        localStorage.setItem(KEYS.RECORDS, JSON.stringify(merged));
        return records;
      }
    }
  } catch (err) {
    console.warn('Error fetching student records from server:', err);
  }
  return getRecordsByStudentId(matriculaOrId);
}

// Fetch direct aggregate statistics calculated by SQLite server
export async function fetchAttendanceStatsFromServer(startDate?: string, endDate?: string, grupo?: string) {
  try {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (grupo && grupo !== 'ALL') params.append('grupo', grupo);

    const res = await fetch(`/api/attendance-stats?${params.toString()}`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('Error fetching aggregate stats from server:', err);
  }
  return null;
}

export function saveAttendanceRecord(record: AttendanceRecord): void {
  const records = getAttendanceRecords();
  const index = records.findIndex((r) => r.id === record.id);
  if (index >= 0) {
    records[index] = record;
  } else {
    records.unshift(record);
  }
  localStorage.setItem(KEYS.RECORDS, JSON.stringify(records));

  fetch('/api/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  }).catch(console.warn);
}

export function deleteAttendanceRecord(recordId: string): void {
  const records = getAttendanceRecords().filter((r) => r.id !== recordId);
  localStorage.setItem(KEYS.RECORDS, JSON.stringify(records));

  fetch(`/api/records/${encodeURIComponent(recordId)}`, {
    method: 'DELETE',
  }).catch(console.warn);
}

export function getRecordsByStudentId(studentId: string): AttendanceRecord[] {
  return getAttendanceRecords().filter((r) => r.studentId === studentId || isMatriculaMatch(r.matricula, studentId));
}

// Días Inhábiles API
export function getDiasInhabiles(): DiaInhabil[] {
  initializeStorage();
  try {
    const data = localStorage.getItem(KEYS.HOLIDAYS);
    const list: DiaInhabil[] = data ? JSON.parse(data) : [];
    return list.sort((a, b) => a.fecha.localeCompare(b.fecha));
  } catch {
    return [];
  }
}

export function saveDiaInhabil(dia: DiaInhabil): void {
  const list = getDiasInhabiles();
  const index = list.findIndex((item) => item.id === dia.id || item.fecha === dia.fecha);
  if (index >= 0) {
    list[index] = dia;
  } else {
    list.push(dia);
  }
  list.sort((a, b) => a.fecha.localeCompare(b.fecha));
  localStorage.setItem(KEYS.HOLIDAYS, JSON.stringify(list));

  fetch('/api/holidays', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(list),
  }).catch(console.warn);
}

export function deleteDiaInhabil(id: string): void {
  const list = getDiasInhabiles().filter((item) => item.id !== id);
  localStorage.setItem(KEYS.HOLIDAYS, JSON.stringify(list));

  fetch('/api/holidays', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(list),
  }).catch(console.warn);
}

export async function pushLocalDataToCloud(): Promise<void> {
  try {
    const backupData = exportFullSystemBackup();
    await fetch('/api/full-backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backupData),
    });
  } catch (err) {
    console.warn('Error syncing local data to Express backend /data/app_state.json:', err);
  }
}

export async function clearSemesterStudents(): Promise<void> {
  localStorage.setItem(KEYS.STUDENTS, JSON.stringify([]));
  localStorage.setItem(KEYS.RECENT_LOGINS, JSON.stringify([]));
  try {
    await fetch('/api/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([]),
    });
    await pushLocalDataToCloud();
  } catch (err) {
    console.warn('Error clearing semester students:', err);
  }
}

export interface CloudSyncOptions {
  role?: 'teacher' | 'student' | 'guest';
  studentId?: string;
  matricula?: string;
}

export function subscribeToCloudChanges(
  onUpdate: () => void,
  _options: CloudSyncOptions = { role: 'guest' }
): () => void {
  initializeStorage();

  let isSubscribed = true;
  let debounceTimeout: any = null;

  const triggerDebouncedSync = () => {
    if (debounceTimeout) clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      if (!isSubscribed) return;
      syncFromExpressBackend().then(() => {
        if (isSubscribed) onUpdate();
      });
    }, 300);
  };

  // Initial sync from Express backend
  syncFromExpressBackend().then(() => {
    if (isSubscribed) onUpdate();
  });

  // 1. Connect EventSource to SSE endpoint `/api/events` for real-time live sync
  let eventSource: EventSource | null = null;
  let sseActive = false;
  try {
    eventSource = new EventSource('/api/events');
    eventSource.onopen = () => {
      sseActive = true;
    };
    eventSource.onmessage = (_e) => {
      if (!isSubscribed) return;
      sseActive = true;
      triggerDebouncedSync();
    };
    eventSource.onerror = () => {
      sseActive = false;
      // EventSource handles automatic reconnection transparently
    };
  } catch (err) {
    console.warn('Could not initialize SSE EventSource:', err);
  }

  // 2. Fallback lightweight periodic check every 90s only if SSE is disconnected
  const pollInterval = setInterval(() => {
    if (!isSubscribed) return;
    if (sseActive) return; // SSE handles real-time push events
    if (typeof document !== 'undefined' && document.hidden) return; // Don't poll when tab is in background
    triggerDebouncedSync();
  }, 90000);

  return () => {
    isSubscribed = false;
    if (debounceTimeout) clearTimeout(debounceTimeout);
    if (eventSource) {
      eventSource.close();
    }
    clearInterval(pollInterval);
  };
}

export interface FullSystemBackup {
  version: string;
  app: string;
  timestamp: string;
  students: Student[];
  sites: HospitalSite[];
  records: AttendanceRecord[];
  hospitalZone: HospitalZone;
  masterConfig: MasterConfig;
  holidays: DiaInhabil[];
}

export function exportFullSystemBackup(): FullSystemBackup {
  return {
    version: '1.0',
    app: 'ClinicasTrack',
    timestamp: new Date().toISOString(),
    students: getStudents(),
    sites: getHospitalSites(),
    records: getAttendanceRecords(),
    hospitalZone: getHospitalZone(),
    masterConfig: getMasterConfig(),
    holidays: getDiasInhabiles(),
  };
}

export async function importFullSystemBackup(
  data: any
): Promise<{ success: boolean; message: string; stats?: { students: number; sites: number; records: number; holidays: number } }> {
  try {
    if (!data || typeof data !== 'object') {
      return { success: false, message: 'El archivo JSON de respaldo no es válido o está dañado.' };
    }

    const rawStudents = Array.isArray(data.students) ? data.students : [];
    const students = rawStudents.map(sanitizeStudentSchedules);
    const sites = Array.isArray(data.sites) ? data.sites : [];
    const records = Array.isArray(data.records) ? data.records : [];
    const holidays = Array.isArray(data.holidays) ? data.holidays : [];
    const hospitalZone = data.hospitalZone && typeof data.hospitalZone === 'object' ? data.hospitalZone : null;
    const masterConfig = data.masterConfig && typeof data.masterConfig === 'object' ? data.masterConfig : null;

    if (students.length === 0 && sites.length === 0 && records.length === 0) {
      return {
        success: false,
        message: 'El archivo importado no contiene registros válidos de alumnos, sedes o asistencias.',
      };
    }

    // Save to LocalStorage
    localStorage.setItem(KEYS.STUDENTS, JSON.stringify(students));
    localStorage.setItem(KEYS.SITES, JSON.stringify(sites));
    localStorage.setItem(KEYS.RECORDS, JSON.stringify(records));
    localStorage.setItem(KEYS.HOLIDAYS, JSON.stringify(holidays));
    if (hospitalZone) localStorage.setItem(KEYS.HOSPITAL, JSON.stringify(hospitalZone));
    if (masterConfig) localStorage.setItem(KEYS.MASTER, JSON.stringify(masterConfig));

    // Send to Express Backend /api/upload-state for disk & memory sync
    const backupState = {
      hospitalZone: hospitalZone || INITIAL_HOSPITAL_ZONE,
      sites: sites.length > 0 ? sites : INITIAL_HOSPITAL_SITES,
      students,
      records,
      masterConfig: masterConfig || INITIAL_MASTER_CONFIG,
      holidays,
    };
    await fetch('/api/upload-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backupState),
    });

    return {
      success: true,
      message: 'Respaldo importado y sincronizado correctamente en la raíz y en el servidor.',
      stats: {
        students: students.length,
        sites: sites.length,
        records: records.length,
        holidays: holidays.length,
      },
    };
  } catch (err: any) {
    console.error('Error al importar el respaldo:', err);
    return {
      success: false,
      message: `Error durante la importación: ${err.message || 'Estructura JSON desconocida'}`,
    };
  }
}

// ----------------- SUPABASE MASTER & RETENTION CLIENT HELPERS -----------------
export async function purgeOldAttendanceRecordsFromServer(
  retentionDays = 60
): Promise<{ success: boolean; purgedCount: number; cutoffDate: string; remainingCount: number; message: string }> {
  try {
    const res = await fetch('/api/records/purge-old', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retentionDays }),
    });
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    return await res.json();
  } catch (err: any) {
    console.error('Error purging old records:', err);
    return {
      success: false,
      purgedCount: 0,
      cutoffDate: '',
      remainingCount: 0,
      message: `Error: ${err.message}`,
    };
  }
}

export async function fetchFirebaseStatus(): Promise<{
  configured: boolean;
  projectId: string | null;
  databaseId?: string | null;
  status?: string;
  circuitBreakerOpen?: boolean;
  lastSyncTimestamp?: number;
  lastSyncIso?: string | null;
  message: string;
}> {
  try {
    const res = await fetch('/api/firebase/status');
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    return await res.json();
  } catch (err: any) {
    return {
      configured: false,
      projectId: null,
      message: err.message,
    };
  }
}

export async function syncAllToFirebaseNow(): Promise<{
  success: boolean;
  message: string;
  syncedCounts?: any;
}> {
  try {
    const res = await fetch('/api/firebase/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      message: err.message,
    };
  }
}

export async function pullFirebaseMasterNow(forceFull = false): Promise<{
  success: boolean;
  message: string;
  changed?: boolean;
  details?: any;
}> {
  try {
    const res = await fetch('/api/firebase/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forceFull }),
    });
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      message: err.message,
    };
  }
}

export async function fetchFirebaseDiagnostics(): Promise<any> {
  try {
    const res = await fetch('/api/firebase/diagnostics');
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    return await res.json();
  } catch (err: any) {
    return { configured: false, error: err.message };
  }
}

