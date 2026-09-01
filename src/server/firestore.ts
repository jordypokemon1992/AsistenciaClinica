import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  Firestore,
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  getDoc,
  getCountFromServer,
  DocumentData,
} from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

// Default static configuration for permanent resilience
const DEFAULT_FIREBASE_CONFIG = {
  projectId: 'trans-reporter-4gtt6',
  appId: '1:660195420750:web:111788d6cce5c16a88311f',
  apiKey: 'AIzaSyAF--KKxWRARiqPSgkf1i-o0oDw6dwJtfc',
  authDomain: 'trans-reporter-4gtt6.firebaseapp.com',
  storageBucket: 'trans-reporter-4gtt6.firebasestorage.app',
  messagingSenderId: '660195420750',
  firestoreDatabaseId: 'ai-studio-controldeasisten-8e1a87c7-a80a-48c1-b598-7f3266a17263',
};

// Load config from firebase-applet-config.json
let firebaseConfig: any = null;
const configPath = path.join(process.cwd(), 'firebase-applet-config.json');

if (fs.existsSync(configPath)) {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    firebaseConfig = JSON.parse(raw);
  } catch (err) {
    console.error('⚠️ Error reading firebase-applet-config.json:', err);
  }
}

// Fallback to process.env and DEFAULT_FIREBASE_CONFIG
if (!firebaseConfig || !firebaseConfig.projectId || !firebaseConfig.apiKey) {
  firebaseConfig = {
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_CONFIG.projectId,
    appId: process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID || DEFAULT_FIREBASE_CONFIG.appId,
    apiKey: process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || DEFAULT_FIREBASE_CONFIG.apiKey,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN || DEFAULT_FIREBASE_CONFIG.authDomain,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET || DEFAULT_FIREBASE_CONFIG.storageBucket,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || DEFAULT_FIREBASE_CONFIG.messagingSenderId,
    firestoreDatabaseId: process.env.FIREBASE_DATABASE_ID || process.env.VITE_FIREBASE_DATABASE_ID || DEFAULT_FIREBASE_CONFIG.firestoreDatabaseId,
  };
} else {
  // Ensure databaseId and storage details are always merged
  firebaseConfig = {
    ...DEFAULT_FIREBASE_CONFIG,
    ...firebaseConfig,
  };
}

let app: FirebaseApp | null = null;
let firestoreDb: Firestore | null = null;

// Circuit breaker state to prevent retry storms
let circuitBreakerOpen = false;
let circuitBreakerTrippedAt = 0;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 3;
const CIRCUIT_RESET_MS = 45000; // 45 seconds

let lastSyncTimestamp = 0;
let lastSyncStatus: 'IDLE' | 'SYNCING' | 'SUCCESS' | 'ERROR' = 'IDLE';
let lastSyncError: string | null = null;

export function isFirestoreConfigured(): boolean {
  return Boolean(firebaseConfig && firebaseConfig.projectId && firebaseConfig.apiKey);
}

export function getFirestoreApp(): FirebaseApp | null {
  if (!isFirestoreConfigured()) return null;
  if (app) return app;

  try {
    if (getApps().length > 0) {
      app = getApp();
    } else {
      app = initializeApp({
        apiKey: firebaseConfig.apiKey,
        authDomain: firebaseConfig.authDomain,
        projectId: firebaseConfig.projectId,
        storageBucket: firebaseConfig.storageBucket,
        messagingSenderId: firebaseConfig.messagingSenderId,
        appId: firebaseConfig.appId,
      });
    }
    return app;
  } catch (err) {
    console.error('⚠️ Error initializing Firebase App:', err);
    return null;
  }
}

export function getFirestoreClient(): Firestore | null {
  if (firestoreDb) return firestoreDb;
  const firebaseApp = getFirestoreApp();
  if (!firebaseApp) return null;

  try {
    const dbId = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
      ? firebaseConfig.firestoreDatabaseId
      : undefined;

    if (dbId) {
      firestoreDb = getFirestore(firebaseApp, dbId);
    } else {
      firestoreDb = getFirestore(firebaseApp);
    }
    return firestoreDb;
  } catch (err) {
    console.error('⚠️ Error initializing Firestore client:', err);
    return null;
  }
}

function handleOperationSuccess() {
  consecutiveErrors = 0;
  circuitBreakerOpen = false;
}

function handleOperationError(err: any, opName: string) {
  consecutiveErrors++;
  lastSyncStatus = 'ERROR';
  lastSyncError = err?.message || String(err);
  console.warn(`⚠️ [Firestore ${opName}] notice:`, err?.message || err);

  if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    circuitBreakerOpen = true;
    circuitBreakerTrippedAt = Date.now();
    console.warn(`🛑 [Firestore Circuit Breaker] Activated for 45s due to ${consecutiveErrors} consecutive errors.`);
  }
}

function isCircuitOpen(): boolean {
  if (!circuitBreakerOpen) return false;
  if (Date.now() - circuitBreakerTrippedAt > CIRCUIT_RESET_MS) {
    circuitBreakerOpen = false;
    consecutiveErrors = 0;
    console.log('🔄 [Firestore Circuit Breaker] Resetting and probing connection...');
    return false;
  }
  return true;
}

// ----------------- PUSH TO FIRESTORE (WRITE-THROUGH & FULL SYNC) -----------------

export async function syncAllToFirestore(): Promise<{
  success: boolean;
  message: string;
  syncedCounts?: {
    students: number;
    records: number;
    sites: number;
    holidays: number;
  };
}> {
  if (!isFirestoreConfigured()) {
    return { success: false, message: 'Firebase Firestore no está configurado.' };
  }
  if (isCircuitOpen()) {
    return { success: false, message: 'Protección activa temporalmente para evitar saturación de red.' };
  }

  const dbClient = getFirestoreClient();
  if (!dbClient) {
    return { success: false, message: 'No se pudo inicializar el cliente de Firestore.' };
  }

  // Import locally to avoid circular dependencies
  const { getAllDataSnapshot } = await import('./db');
  const snapshot = getAllDataSnapshot();

  lastSyncStatus = 'SYNCING';
  try {
    let studentCount = 0;
    let recordCount = 0;
    let siteCount = 0;
    let holidayCount = 0;

    // 1. Sync Sites in batches
    if (snapshot.sites && snapshot.sites.length > 0) {
      const siteBatch = writeBatch(dbClient);
      for (const site of snapshot.sites) {
        if (!site || !site.id) continue;
        const ref = doc(dbClient, 'sites', String(site.id));
        siteBatch.set(ref, {
          ...site,
          _updatedAt: new Date().toISOString(),
        }, { merge: true });
        siteCount++;
      }
      await siteBatch.commit();
    }

    // 2. Sync Holidays
    if (snapshot.holidays && snapshot.holidays.length > 0) {
      const holBatch = writeBatch(dbClient);
      for (const hol of snapshot.holidays) {
        if (!hol || !hol.fecha) continue;
        const ref = doc(dbClient, 'holidays', String(hol.fecha));
        holBatch.set(ref, {
          ...hol,
          _updatedAt: new Date().toISOString(),
        }, { merge: true });
        holidayCount++;
      }
      await holBatch.commit();
    }

    // 3. Sync Students in chunks of 400 (Firestore batch limit is 500)
    if (snapshot.students && snapshot.students.length > 0) {
      const CHUNK_SIZE = 400;
      for (let i = 0; i < snapshot.students.length; i += CHUNK_SIZE) {
        const chunk = snapshot.students.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(dbClient);
        for (const st of chunk) {
          if (!st || !st.matricula) continue;
          const docId = String(st.id || `std-${st.matricula}`);
          const ref = doc(dbClient, 'students', docId);
          batch.set(ref, {
            ...st,
            _updatedAt: new Date().toISOString(),
          }, { merge: true });
          studentCount++;
        }
        await batch.commit();
      }
    }

    // 4. Sync Records in chunks of 400
    if (snapshot.records && snapshot.records.length > 0) {
      const CHUNK_SIZE = 400;
      for (let i = 0; i < snapshot.records.length; i += CHUNK_SIZE) {
        const chunk = snapshot.records.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(dbClient);
        for (const rec of chunk) {
          if (!rec || !rec.id) continue;
          const ref = doc(dbClient, 'attendance_records', String(rec.id));
          batch.set(ref, {
            ...rec,
            _updatedAt: new Date().toISOString(),
          }, { merge: true });
          recordCount++;
        }
        await batch.commit();
      }
    }

    // 5. Sync System Config
    if (snapshot.hospitalZone || snapshot.masterConfig) {
      const configRef = doc(dbClient, 'system_config', 'main');
      await setDoc(configRef, {
        hospitalZone: snapshot.hospitalZone || null,
        masterConfig: snapshot.masterConfig || null,
        _lastSync: new Date().toISOString(),
      }, { merge: true });
    }

    lastSyncTimestamp = Date.now();
    lastSyncStatus = 'SUCCESS';
    lastSyncError = null;
    handleOperationSuccess();

    return {
      success: true,
      message: `Sincronización a Firestore completada con éxito: ${studentCount} alumnos, ${recordCount} checadas, ${siteCount} sedes, ${holidayCount} días inhábiles.`,
      syncedCounts: {
        students: studentCount,
        records: recordCount,
        sites: siteCount,
        holidays: holidayCount,
      },
    };
  } catch (err: any) {
    handleOperationError(err, 'syncAllToFirestore');
    return {
      success: false,
      message: `Error al sincronizar con Firestore: ${err?.message || err}`,
    };
  }
}

// ----------------- PULL FROM FIRESTORE TO LOCAL CACHE -----------------

export async function pullFromFirestoreToCache(forceFull = false): Promise<{
  success: boolean;
  message: string;
  changed?: boolean;
  details?: {
    studentsCount: number;
    recordsCount: number;
    sitesCount: number;
    holidaysCount: number;
  };
}> {
  if (!isFirestoreConfigured()) {
    return { success: false, message: 'Firebase Firestore no configurado.' };
  }
  if (isCircuitOpen()) {
    return { success: false, message: 'Protección activa temporalmente.' };
  }

  const dbClient = getFirestoreClient();
  if (!dbClient) {
    return { success: false, message: 'No se pudo inicializar Firestore.' };
  }

  try {
    // 1. Fetch Students
    const studentsSnap = await getDocs(collection(dbClient, 'students'));
    const students: any[] = [];
    studentsSnap.forEach((docSnap) => {
      const data = docSnap.data();
      if (data && data.matricula) {
        students.push(data);
      }
    });

    // 2. Fetch Sites
    const sitesSnap = await getDocs(collection(dbClient, 'sites'));
    const sites: any[] = [];
    sitesSnap.forEach((docSnap) => {
      const data = docSnap.data();
      if (data && data.id) {
        sites.push(data);
      }
    });

    // 3. Fetch Records
    const recordsSnap = await getDocs(collection(dbClient, 'attendance_records'));
    const records: any[] = [];
    recordsSnap.forEach((docSnap) => {
      const data = docSnap.data();
      if (data && data.id) {
        records.push(data);
      }
    });

    // 4. Fetch Holidays
    const holidaysSnap = await getDocs(collection(dbClient, 'holidays'));
    const holidays: any[] = [];
    holidaysSnap.forEach((docSnap) => {
      const data = docSnap.data();
      if (data && data.fecha) {
        holidays.push(data);
      }
    });

    // 5. Fetch System Config
    let masterConfig: any = null;
    let hospitalZone: any = null;
    try {
      const configSnap = await getDoc(doc(dbClient, 'system_config', 'main'));
      if (configSnap.exists()) {
        const cData = configSnap.data();
        if (cData.masterConfig) masterConfig = cData.masterConfig;
        if (cData.hospitalZone) hospitalZone = cData.hospitalZone;
      }
    } catch {
      // Non-fatal
    }

    // Only import if we found valid data
    if (students.length > 0 || sites.length > 0 || records.length > 0) {
      const { importFullSnapshotToSqlite, persistDatabase } = await import('./db');
      importFullSnapshotToSqlite({
        students,
        sites,
        records,
        holidays,
        masterConfig,
        hospitalZone,
      }, forceFull ? 'replace' : 'merge');
      persistDatabase(true);
    }

    lastSyncTimestamp = Date.now();
    lastSyncStatus = 'SUCCESS';
    lastSyncError = null;
    handleOperationSuccess();

    return {
      success: true,
      message: `Datos recuperados de Firestore: ${students.length} alumnos, ${records.length} checadas, ${sites.length} sedes, ${holidays.length} días inhábiles.`,
      changed: true,
      details: {
        studentsCount: students.length,
        recordsCount: records.length,
        sitesCount: sites.length,
        holidaysCount: holidays.length,
      },
    };
  } catch (err: any) {
    handleOperationError(err, 'pullFromFirestoreToCache');
    return {
      success: false,
      message: `Error al leer de Firestore: ${err?.message || err}`,
    };
  }
}

// ----------------- GRANULAR WRITE-THROUGH OPERATIONS -----------------

export async function syncStudentToFirestore(student: any): Promise<void> {
  if (!isFirestoreConfigured() || isCircuitOpen() || !student || !student.matricula) return;
  const dbClient = getFirestoreClient();
  if (!dbClient) return;

  try {
    const docId = String(student.id || `std-${student.matricula}`);
    const ref = doc(dbClient, 'students', docId);
    await setDoc(ref, {
      ...student,
      _updatedAt: new Date().toISOString(),
    }, { merge: true });
    handleOperationSuccess();
  } catch (err) {
    handleOperationError(err, 'syncStudentToFirestore');
  }
}

export async function deleteStudentFromFirestore(studentId: string): Promise<void> {
  if (!isFirestoreConfigured() || isCircuitOpen() || !studentId) return;
  const dbClient = getFirestoreClient();
  if (!dbClient) return;

  try {
    const ref = doc(dbClient, 'students', String(studentId));
    await deleteDoc(ref);
    handleOperationSuccess();
  } catch (err) {
    handleOperationError(err, 'deleteStudentFromFirestore');
  }
}

export async function syncRecordToFirestore(record: any): Promise<void> {
  if (!isFirestoreConfigured() || isCircuitOpen() || !record || !record.id) return;
  const dbClient = getFirestoreClient();
  if (!dbClient) return;

  try {
    const ref = doc(dbClient, 'attendance_records', String(record.id));
    await setDoc(ref, {
      ...record,
      _updatedAt: new Date().toISOString(),
    }, { merge: true });
    handleOperationSuccess();
  } catch (err) {
    handleOperationError(err, 'syncRecordToFirestore');
  }
}

export async function deleteRecordFromFirestore(recordId: string): Promise<void> {
  if (!isFirestoreConfigured() || isCircuitOpen() || !recordId) return;
  const dbClient = getFirestoreClient();
  if (!dbClient) return;

  try {
    const ref = doc(dbClient, 'attendance_records', String(recordId));
    await deleteDoc(ref);
    handleOperationSuccess();
  } catch (err) {
    handleOperationError(err, 'deleteRecordFromFirestore');
  }
}

export async function syncSiteToFirestore(site: any): Promise<void> {
  if (!isFirestoreConfigured() || isCircuitOpen() || !site || !site.id) return;
  const dbClient = getFirestoreClient();
  if (!dbClient) return;

  try {
    const ref = doc(dbClient, 'sites', String(site.id));
    await setDoc(ref, {
      ...site,
      _updatedAt: new Date().toISOString(),
    }, { merge: true });
    handleOperationSuccess();
  } catch (err) {
    handleOperationError(err, 'syncSiteToFirestore');
  }
}

export async function deleteSiteFromFirestore(siteId: string): Promise<void> {
  if (!isFirestoreConfigured() || isCircuitOpen() || !siteId) return;
  const dbClient = getFirestoreClient();
  if (!dbClient) return;

  try {
    const ref = doc(dbClient, 'sites', String(siteId));
    await deleteDoc(ref);
    handleOperationSuccess();
  } catch (err) {
    handleOperationError(err, 'deleteSiteFromFirestore');
  }
}

export async function syncHolidayToFirestore(holiday: any): Promise<void> {
  if (!isFirestoreConfigured() || isCircuitOpen() || !holiday || !holiday.fecha) return;
  const dbClient = getFirestoreClient();
  if (!dbClient) return;

  try {
    const ref = doc(dbClient, 'holidays', String(holiday.fecha));
    await setDoc(ref, {
      ...holiday,
      _updatedAt: new Date().toISOString(),
    }, { merge: true });
    handleOperationSuccess();
  } catch (err) {
    handleOperationError(err, 'syncHolidayToFirestore');
  }
}

export async function deleteHolidayFromFirestore(fecha: string): Promise<void> {
  if (!isFirestoreConfigured() || isCircuitOpen() || !fecha) return;
  const dbClient = getFirestoreClient();
  if (!dbClient) return;

  try {
    const ref = doc(dbClient, 'holidays', String(fecha));
    await deleteDoc(ref);
    handleOperationSuccess();
  } catch (err) {
    handleOperationError(err, 'deleteHolidayFromFirestore');
  }
}

export async function syncConfigToFirestore(key: string, value: any): Promise<void> {
  if (!isFirestoreConfigured() || isCircuitOpen() || !key) return;
  const dbClient = getFirestoreClient();
  if (!dbClient) return;

  try {
    const ref = doc(dbClient, 'system_config', 'main');
    await setDoc(ref, {
      [key]: value,
      _updatedAt: new Date().toISOString(),
    }, { merge: true });
    handleOperationSuccess();
  } catch (err) {
    handleOperationError(err, 'syncConfigToFirestore');
  }
}

// ----------------- DIAGNOSTICS & STATUS -----------------

export function getFirestoreStatusInfo() {
  return {
    configured: isFirestoreConfigured(),
    projectId: firebaseConfig?.projectId || 'trans-reporter-4gtt6',
    databaseId: firebaseConfig?.firestoreDatabaseId || '(default)',
    status: isCircuitOpen() ? 'CIRCUIT_BREAKER_ACTIVE' : (lastSyncStatus === 'ERROR' ? 'WARNING' : 'HEALTHY'),
    circuitBreakerOpen: isCircuitOpen(),
    lastSyncTimestamp,
    lastSyncIso: lastSyncTimestamp > 0 ? new Date(lastSyncTimestamp).toISOString() : null,
  };
}

export async function getFirestoreDiagnostics(): Promise<{
  configured: boolean;
  projectId: string | null;
  databaseId: string | null;
  status: string;
  circuitBreakerOpen: boolean;
  lastSyncTimestamp: number;
  lastSyncIso: string | null;
  lastSyncStatus: string;
  lastSyncError: string | null;
  localCounts: {
    students: number;
    records: number;
    sites: number;
    holidays: number;
  };
  firestoreCounts?: {
    students: number;
    records: number;
    sites: number;
    holidays: number;
  };
}> {
  const { getAllDataSnapshot } = await import('./db');
  const snapshot = getAllDataSnapshot();

  const localCounts = {
    students: snapshot.students.length,
    records: snapshot.records.length,
    sites: snapshot.sites.length,
    holidays: snapshot.holidays.length,
  };

  if (!isFirestoreConfigured()) {
    return {
      configured: false,
      projectId: null,
      databaseId: null,
      status: 'NOT_CONFIGURED',
      circuitBreakerOpen: false,
      lastSyncTimestamp: 0,
      lastSyncIso: null,
      lastSyncStatus: 'IDLE',
      lastSyncError: 'Firebase Firestore no configurado',
      localCounts,
    };
  }

  const dbClient = getFirestoreClient();
  let firestoreCounts: any = undefined;

  if (dbClient && !isCircuitOpen()) {
    try {
      // Use aggregate count query (costs only 1 read per query or zero document body transfer)
      const [sSnap, rSnap, stSnap, hSnap] = await Promise.all([
        getCountFromServer(collection(dbClient, 'students')),
        getCountFromServer(collection(dbClient, 'attendance_records')),
        getCountFromServer(collection(dbClient, 'sites')),
        getCountFromServer(collection(dbClient, 'holidays')),
      ]);

      firestoreCounts = {
        students: sSnap.data().count,
        records: rSnap.data().count,
        sites: stSnap.data().count,
        holidays: hSnap.data().count,
      };
    } catch (err: any) {
      console.warn('Diagnostics counts probe notice:', err?.message || err);
    }
  }

  return {
    configured: true,
    projectId: firebaseConfig.projectId || 'Google Cloud Firestore',
    databaseId: firebaseConfig.firestoreDatabaseId || '(default)',
    status: isCircuitOpen() ? 'CIRCUIT_BREAKER_ACTIVE' : (lastSyncStatus === 'ERROR' ? 'WARNING' : 'HEALTHY'),
    circuitBreakerOpen: isCircuitOpen(),
    lastSyncTimestamp,
    lastSyncIso: lastSyncTimestamp > 0 ? new Date(lastSyncTimestamp).toISOString() : null,
    lastSyncStatus,
    lastSyncError,
    localCounts,
    firestoreCounts,
  };
}
