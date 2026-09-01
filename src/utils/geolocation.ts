/**
  Calculates the distance in meters between two geographical points using the Haversine formula.
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return Math.round(distance);
}

/**
 * Fast, deterministic FNV-1a non-cryptographic hash (32-bit hex)
 */
function hashString(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

/**
 * Creates a deterministic canvas rendering signature.
 */
function getCanvasFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'nocanvas';

    ctx.textBaseline = 'top';
    ctx.font = "14px 'Arial'";
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('ClinicasTrack,iOS#1!', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('ClinicasTrack,iOS#1!', 4, 17);

    return canvas.toDataURL();
  } catch {
    return 'canvaserr';
  }
}

/**
 * Reads WebGL Vendor and Renderer details
 */
function getWebGLFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl || !(gl instanceof WebGLRenderingContext)) return 'nowebgl';
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (!debugInfo) return 'nodebug';
    const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '';
    const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
    return `${vendor}~${renderer}`;
  } catch {
    return 'webglerr';
  }
}

/**
 * Generates a high-entropy random seed for unique physical device differentiation.
 */
function getRandomDeviceSeed(): string {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    const array = new Uint8Array(4);
    window.crypto.getRandomValues(array);
    return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase().substring(0, 6);
  }
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/**
 * Generates a device ID based on hardware & browser characteristics + unique device seed.
 * This ensures that even two identical physical devices (e.g. two iPhone 14s) have distinct, unrepeatable IDs.
 */
export function generateHardwareDeviceSignature(customSeed?: string): { id: string; name: string } {
  if (typeof window === 'undefined') {
    return { id: 'DEV-SERVER', name: 'Servidor' };
  }

  const nav = navigator;
  const userAgent = nav.userAgent || '';

  let deviceType = 'Teléfono Móvil';
  let devicePrefix = 'DEV';
  if (/iPhone/i.test(userAgent)) {
    deviceType = 'Apple iPhone';
    devicePrefix = 'DEV-iPH';
  } else if (/iPad/i.test(userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)) {
    deviceType = 'Apple iPad';
    devicePrefix = 'DEV-iPAD';
  } else if (/Android/i.test(userAgent)) {
    deviceType = 'Smartphone Android';
    devicePrefix = 'DEV-AND';
  } else if (/Macintosh/i.test(userAgent)) {
    deviceType = 'MacBook / macOS';
    devicePrefix = 'DEV-MAC';
  } else if (/Windows/i.test(userAgent)) {
    deviceType = 'PC Windows';
    devicePrefix = 'DEV-WIN';
  }

  // Collect hardware + screen + webgl + canvas traits
  const screenTraits = `${window.screen?.width || 0}x${window.screen?.height || 0}x${window.screen?.colorDepth || 0}x${window.devicePixelRatio || 1}`;
  const navTraits = `${nav.platform || ''}_${nav.hardwareConcurrency || 0}_${nav.maxTouchPoints || 0}_${nav.language || ''}`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const canvasTraits = getCanvasFingerprint();
  const webglTraits = getWebGLFingerprint();

  // Combine into a hardware fingerprint seed
  const rawSeed = `CT_HW_v3|${userAgent}|${screenTraits}|${navTraits}|${tz}|${canvasTraits}|${webglTraits}`;
  const hwHash = hashString(rawSeed).substring(0, 5);

  const deviceSeed = customSeed || getRandomDeviceSeed();

  const id = `${devicePrefix}-${hwHash}-${deviceSeed}`;
  const name = `${deviceType} (${id})`;

  return { id, name };
}

// Cookie Helpers
const COOKIE_NAME = 'ct_device_sig';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

function setCookie(name: string, value: string) {
  if (typeof document === 'undefined') return;
  const maxAge = 10 * 365 * 24 * 60 * 60; // 10 years
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; SameSite=Lax`;
}

// IndexedDB Helper
function saveToIndexedDB(data: { id: string; name: string }) {
  if (typeof window === 'undefined' || !window.indexedDB) return;
  try {
    const request = indexedDB.open('ClinicasTrackDB', 1);
    request.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('deviceStore')) {
        db.createObjectStore('deviceStore', { keyPath: 'key' });
      }
    };
    request.onsuccess = (e: any) => {
      const db = e.target.result;
      const tx = db.transaction('deviceStore', 'readwrite');
      const store = tx.objectStore('deviceStore');
      store.put({ key: 'device_sig', value: data });
    };
  } catch (e) {
    console.warn('IndexedDB write error:', e);
  }
}

/**
 * Generates or retrieves a unique device fingerprint stored across
 * localStorage, Cookies, IndexedDB, and backed by a deterministic hardware signature.
 */
export function getOrCreateDeviceFingerprint(): { id: string; name: string } {
  const STORAGE_KEY = 'hosp_attendance_device_signature';

  if (typeof window === 'undefined') {
    return { id: 'DEV-SERVER', name: 'Servidor' };
  }

  // 1. Check localStorage
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && parsed.id && parsed.name) {
        // Refresh backup cookie and IndexedDB
        setCookie(COOKIE_NAME, JSON.stringify(parsed));
        saveToIndexedDB(parsed);
        return parsed;
      }
    }
  } catch {
    // Continue to fallback
  }

  // 2. Check Cookie fallback
  try {
    const cookieVal = getCookie(COOKIE_NAME);
    if (cookieVal) {
      const parsed = JSON.parse(cookieVal);
      if (parsed && parsed.id && parsed.name) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        saveToIndexedDB(parsed);
        return parsed;
      }
    }
  } catch {
    // Continue to hardware signature
  }

  // 3. Fallback to deterministic hardware signature
  // Guarantee: The same physical device will generate the EXACT SAME ID every time
  const signature = generateHardwareDeviceSignature();

  // Persist across all 3 layers
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(signature));
  } catch {
    // ignore
  }
  setCookie(COOKIE_NAME, JSON.stringify(signature));
  saveToIndexedDB(signature);

  return signature;
}

export function formatTimeDisplay(isoString: string | null): string {
  if (!isoString) return '--:--';
  const date = new Date(isoString);
  return date.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

export function formatDateDisplay(dateStr: string): string {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  if (!year || !month || !day) return dateStr;
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  return date.toLocaleDateString('es-MX', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function getTodayDateString(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Checks if current browser device is an Apple iOS device (iPhone/iPad/iPod).
 */
export function isIOSDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const userAgent = navigator.userAgent || '';
  return (
    /iPhone|iPad|iPod/i.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export interface GPSCheckResult {
  success: boolean;
  lat?: number;
  lng?: number;
  error?: string;
  permissionDenied?: boolean;
}

/**
 * Robustly requests or verifies GPS location with iPhone/iOS fallback for indoors/weak signal.
 */
export async function checkOrRequestGPS(): Promise<GPSCheckResult> {
  if (typeof window === 'undefined' || !navigator.geolocation) {
    return {
      success: false,
      error: 'Tu dispositivo o navegador no soporta geolocalización GPS.',
      permissionDenied: false,
    };
  }

  return new Promise((resolve) => {
    let handled = false;

    const tryGetPos = (highAccuracy: boolean) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (handled) return;
          handled = true;
          resolve({
            success: true,
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (err) => {
          if (handled) return;

          // On iOS Safari indoors, high accuracy may time out. Retry with standard accuracy.
          if (highAccuracy && err.code === err.TIMEOUT) {
            console.warn('GPS High accuracy timed out on iOS, retrying with standard accuracy...');
            tryGetPos(false);
            return;
          }

          handled = true;
          const isDenied = err.code === err.PERMISSION_DENIED;
          let msg = 'No se pudo obtener la ubicación GPS de tu dispositivo.';
          if (isDenied) {
            msg = 'Permiso de ubicación denegado por el usuario o navegador.';
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            msg = 'Ubicación GPS no disponible. Asegúrate de tener activada la Localización en tu dispositivo.';
          } else if (err.code === err.TIMEOUT) {
            msg = 'Tiempo de espera agotado al consultar el GPS. Intenta en una zona abierta.';
          }

          resolve({
            success: false,
            error: msg,
            permissionDenied: isDenied,
          });
        },
        {
          enableHighAccuracy: highAccuracy,
          timeout: highAccuracy ? 8000 : 15000,
          maximumAge: 5000,
        }
      );
    };

    tryGetPos(true);
  });
}

/**
 * Queries standard browser permissions status for geolocation if supported.
 */
export async function getGPSPermissionStatus(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  if (typeof window !== 'undefined' && navigator.permissions && navigator.permissions.query) {
    try {
      const res = await navigator.permissions.query({ name: 'geolocation' });
      return res.state as 'granted' | 'denied' | 'prompt';
    } catch {
      return 'unknown';
    }
  }
  return 'unknown';
}

