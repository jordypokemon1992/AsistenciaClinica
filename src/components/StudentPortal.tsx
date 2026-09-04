import React, { useState, useEffect } from 'react';
import { Student, HospitalZone, AttendanceRecord, CheckInStatus } from '../types';
import { MapPicker } from './MapPicker';
import { LocationPermissionModal } from './LocationPermissionModal';
import {
  calculateDistanceMeters,
  getOrCreateDeviceFingerprint,
  formatTimeDisplay,
  formatDateDisplay,
  getTodayDateString,
  checkOrRequestGPS,
} from '../utils/geolocation';
import {
  saveAttendanceRecord,
  getRecordsByStudentId,
  fetchStudentRecordsFromServer,
  linkStudentDevice,
  getStudentByMatricula,
  getStudentByMatriculaAsync,
  getHospitalSiteById,
  getStudents,
  isMatriculaMatch,
} from '../services/storage';
import { sortDaysArray, sortDaySchedules } from '../utils/dayUtils';
import {
  MapPin,
  Smartphone,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  UserCheck,
  ShieldAlert,
  ArrowRight,
  RefreshCw,
  Calendar,
  LogOut,
  Info,
  Building2,
} from 'lucide-react';

interface StudentPortalProps {
  activeStudent: Student | null;
  hospitalZone: HospitalZone;
  onLoginStudent: (student: Student) => void;
  onLogoutStudent: () => void;
  onRefreshData: () => void;
}

export const StudentPortal: React.FC<StudentPortalProps> = ({
  activeStudent,
  hospitalZone,
  onLoginStudent,
  onLogoutStudent,
  onRefreshData,
}) => {
  // Login State
  const [inputMatricula, setInputMatricula] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [pendingLinkStudent, setPendingLinkStudent] = useState<Student | null>(null);

  // Active student primary and optional secondary hospital / clinic site
  const primarySite = activeStudent ? getHospitalSiteById(activeStudent.sedeId) : hospitalZone;
  const secondarySite = activeStudent && activeStudent.secondarySedeId ? getHospitalSiteById(activeStudent.secondarySedeId) : null;

  // Resolve today's specific schedule based on activeStudent.horariosPorDia or fallbacks
  const daysMap = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const todayIndex = new Date().getDay();
  const todayDayName = daysMap[todayIndex];
  const todayNormName = todayDayName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const todayCustomSchedule = activeStudent?.horariosPorDia?.find((hs) => {
    const hsNorm = hs.dia.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return hsNorm.includes(todayNormName);
  });

  // Active student schedule for current day
  const effectiveEntrada = todayCustomSchedule?.horaEntrada || activeStudent?.horaEntrada || primarySite.horaEntrada || '07:00';
  const effectiveSalida = todayCustomSchedule?.horaSalida || activeStudent?.horaSalida || primarySite.horaSalida || '15:00';
  const effectiveTolerancia = todayCustomSchedule?.toleranciaMinutos ?? activeStudent?.toleranciaMinutos ?? primarySite.toleranciaMinutos ?? 15;

  const rawTodayTurnos = todayCustomSchedule?.turnos && todayCustomSchedule.turnos.length > 0
    ? todayCustomSchedule.turnos
    : [{ horaEntrada: effectiveEntrada, horaSalida: effectiveSalida }];

  const parseTurnosFromRaw = (
    rawTurnos: { horaEntrada: string; horaSalida: string }[],
    defaultSalida = '15:00'
  ) => {
    const result: { horaEntrada: string; horaSalida: string }[] = [];
    rawTurnos.forEach((t) => {
      const entMatches = String(t.horaEntrada || '').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g) || ['07:00'];
      const salMatches = String(t.horaSalida || '').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g);

      entMatches.forEach((ent, idx) => {
        let sal = salMatches && salMatches[idx] ? salMatches[idx] : (salMatches && salMatches[0] ? salMatches[0] : defaultSalida);
        if (!sal || sal === 'No especificada') {
          const [h, m] = ent.split(':').map(Number);
          const endH = (h + 8) % 24;
          sal = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        }
        result.push({ horaEntrada: ent, horaSalida: sal });
      });
    });
    return result.length > 0 ? result : [{ horaEntrada: '07:00', horaSalida: defaultSalida }];
  };

  const todayTurnos = parseTurnosFromRaw(rawTodayTurnos, effectiveSalida);

  const todayTurnosFormatted = todayTurnos
    .map((t) => `${t.horaEntrada} - ${t.horaSalida}`)
    .join(' | ');

  // Check if today corresponds to any assigned day in horariosPorDia or diasAsistencia
  const hasHorariosPorDia = Boolean(activeStudent?.horariosPorDia && activeStudent.horariosPorDia.length > 0);
  const hasDiasAsistencia = Boolean(activeStudent?.diasAsistencia && activeStudent.diasAsistencia.length > 0);
  const hasConfiguredDays = hasHorariosPorDia || hasDiasAsistencia;

  const isAssignedTodayInHorarios = hasHorariosPorDia
    ? activeStudent!.horariosPorDia!.some((hs) => {
        const hsNorm = hs.dia.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return hsNorm.includes(todayNormName);
      })
    : false;

  const isAssignedTodayInDias = hasDiasAsistencia
    ? activeStudent!.diasAsistencia!.some((d) => {
        const dNorm = d.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return dNorm.includes(todayNormName);
      })
    : false;

  const hasGuardiaToday = hasConfiguredDays ? (isAssignedTodayInHorarios || isAssignedTodayInDias) : true;

  // Device Info
  const device = getOrCreateDeviceFingerprint();

  // Geolocation state
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [isLoadingGeo, setIsLoadingGeo] = useState<boolean>(false);
  const [distanceMeters, setDistanceMeters] = useState<number | null>(null);
  const [showLocationModal, setShowLocationModal] = useState<boolean>(false);

  // Check-in / Out Action Feedback
  const [actionMessage, setActionMessage] = useState<{
    type: 'success' | 'error' | 'warning';
    text: string;
  } | null>(null);

  // Student Attendance Records
  const [studentRecords, setStudentRecords] = useState<AttendanceRecord[]>([]);

  // Request real user GPS location from device against assigned hospital site(s)
  const requestGPS = async () => {
    setIsLoadingGeo(true);
    setGeoError(null);

    const result = await checkOrRequestGPS();
    if (result.success && result.lat !== undefined && result.lng !== undefined) {
      setUserLat(result.lat);
      setUserLng(result.lng);
      const distP = calculateDistanceMeters(
        result.lat,
        result.lng,
        primarySite.latitude,
        primarySite.longitude
      );
      const distS = secondarySite
        ? calculateDistanceMeters(
            result.lat,
            result.lng,
            secondarySite.latitude,
            secondarySite.longitude
          )
        : null;

      const bestDist = distS !== null && distS < distP ? distS : distP;
      setDistanceMeters(bestDist);
      setIsLoadingGeo(false);
    } else {
      setGeoError(result.error || 'No se pudo obtener la ubicación GPS.');
      setIsLoadingGeo(false);
    }
  };

  // On component mount or activeStudent change, load student records & GPS
  useEffect(() => {
    if (activeStudent) {
      const records = getRecordsByStudentId(activeStudent.id || activeStudent.matricula);
      setStudentRecords(records);

      // Async background lightweight fetch of only this student's records
      fetchStudentRecordsFromServer(activeStudent.matricula || activeStudent.id).then((serverRecs) => {
        if (serverRecs && serverRecs.length > 0) {
          setStudentRecords(serverRecs);
        }
      });

      requestGPS();
    }
  }, [activeStudent, primarySite.id, secondarySite?.id]);

  // Handle Login by Matricula
  const handleStudentLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    const cleanMat = inputMatricula.trim();
    if (!cleanMat) {
      setLoginError('Por favor ingresa tu matrícula de alumno.');
      return;
    }

    let student = getStudentByMatricula(cleanMat);
    if (!student) {
      student = await getStudentByMatriculaAsync(cleanMat);
    }

    if (!student) {
      setLoginError(
        `La matrícula "${inputMatricula}" no se encuentra registrada en ClinicasTrack. Solicita a tu profesor que te agregue.`
      );
      return;
    }

    // Security Check: Single Device Binding Validation
    if (student.linkedDeviceId && student.linkedDeviceId !== device.id) {
      const allStudents = getStudents();
      const isClaimedByOther = allStudents.some(
        (s) => s.id !== student.id && !isMatriculaMatch(s.matricula, student.matricula) && s.linkedDeviceId === device.id
      );

      if (isClaimedByOther) {
        const claimingOwner = allStudents.find(
          (s) => s.id !== student.id && !isMatriculaMatch(s.matricula, student.matricula) && s.linkedDeviceId === device.id
        );
        setLoginError(
          `⛔ ACCESO DENEGADO: Este teléfono ("${device.name}") se encuentra vinculado a la matrícula de otro alumno (${claimingOwner?.nombre || 'Otro Alumno'} - Matrícula: ${claimingOwner?.matricula}). No está permitido compartir dispositivos. Si cambiaste de equipo, solicita a tu docente desvincular el dispositivo.`
        );
        return;
      }

      // Automatically offer device migration confirmation modal for student's personal device
      setPendingLinkStudent(student);
      return;
    }

    // If student not linked yet, require confirmation pop-up modal first
    if (!student.linkedDeviceId) {
      const allStudents = getStudents();
      const existingStudentWithDevice = allStudents.find(
        (s) => s.id !== student.id && s.linkedDeviceId === device.id
      );

      if (existingStudentWithDevice) {
        setLoginError(
          `⛔ DISPOSITIVO YA REGISTRADO: Este teléfono ("${device.name}") ya está vinculado a la matrícula de otro alumno (${existingStudentWithDevice.nombre} - Matrícula: ${existingStudentWithDevice.matricula}). No se permite que dos alumnos compartan el mismo dispositivo. Si cambiaste de equipo, solicita a tu docente desvincular el dispositivo previo.`
        );
        return;
      }

      // Show security confirmation modal before linking!
      setPendingLinkStudent(student);
      return;
    }

    onLoginStudent(student);
    setInputMatricula('');
  };

  // Confirm Link Student Handler (when student accepts in security popup modal)
  const handleConfirmLinkStudent = async () => {
    if (!pendingLinkStudent) return;
    const linked = linkStudentDevice(pendingLinkStudent.id, device.id, device.name);
    if (!linked) {
      setLoginError(
        '⛔ ERROR DE VINCULACIÓN: No se pudo vincular este teléfono a tu matrícula porque ya está registrado en otra cuenta.'
      );
      setPendingLinkStudent(null);
      return;
    }

    pendingLinkStudent.linkedDeviceId = device.id;
    pendingLinkStudent.linkedDeviceName = device.name;
    onLoginStudent(pendingLinkStudent);
    setPendingLinkStudent(null);
    setInputMatricula('');
  };

  // Today's attendance records for active student
  const todayStr = getTodayDateString();
  const todayRecords = studentRecords.filter((r) => r.fecha === todayStr);
  const todayRecord = todayRecords.length > 0 ? todayRecords[todayRecords.length - 1] : undefined;

  // Evaluate Geofence for both sites
  const distP = userLat !== null && userLng !== null
    ? calculateDistanceMeters(userLat, userLng, primarySite.latitude, primarySite.longitude)
    : null;
  const distS = userLat !== null && userLng !== null && secondarySite
    ? calculateDistanceMeters(userLat, userLng, secondarySite.latitude, secondarySite.longitude)
    : null;

  const isInsidePrimary = distP !== null && distP <= primarySite.radiusMeters;
  const isInsideSecondary = distS !== null && secondarySite ? distS <= secondarySite.radiusMeters : false;
  const isInsideGeofence = isInsidePrimary || isInsideSecondary;

  // Determine active site and active distance
  let activeSite = primarySite;
  let activeDistance = distP;

  if (secondarySite && distS !== null && distP !== null) {
    if (isInsidePrimary && isInsideSecondary) {
      if (distS < distP) {
        activeSite = secondarySite;
        activeDistance = distS;
      } else {
        activeSite = primarySite;
        activeDistance = distP;
      }
    } else if (isInsideSecondary) {
      activeSite = secondarySite;
      activeDistance = distS;
    } else if (isInsidePrimary) {
      activeSite = primarySite;
      activeDistance = distP;
    } else {
      if (distS < distP) {
        activeSite = secondarySite;
        activeDistance = distS;
      } else {
        activeSite = primarySite;
        activeDistance = distP;
      }
    }
  }

  // Helper: Check if today is an assigned duty/guard day for student
  const checkDutyDay = (): { isDutyDay: boolean; dayName: string } => {
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const todayIndex = new Date().getDay();
    const currentDayName = days[todayIndex];

    if (!hasConfiguredDays) {
      return { isDutyDay: true, dayName: currentDayName };
    }

    return { isDutyDay: hasGuardiaToday, dayName: currentDayName };
  };

  // Helper: Calculate time window (5 min before, 15 min tolerance/after)
  const getTimeWindow = (timeStr: string, minutesBefore = 5, minutesAfter = 15) => {
    const matches = String(timeStr || '').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g);
    const timeToUse = matches && matches.length > 0 ? matches[0] : '07:00';
    const [rawH, rawM] = timeToUse.split(':').map(Number);
    const h = isNaN(rawH) ? 7 : rawH;
    const m = isNaN(rawM) ? 0 : rawM;

    const scheduled = new Date();
    scheduled.setHours(h, m, 0, 0);

    const start = new Date();
    start.setHours(h, m - minutesBefore, 0, 0);

    const end = new Date();
    end.setHours(h, m + minutesAfter, 0, 0);

    return { start, scheduled, end };
  };

  const formatWindowTime = (d: Date) =>
    d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true });

  // Handle Check-In (Marcar Entrada)
  const handleCheckIn = () => {
    if (!activeStudent) return;
    setActionMessage(null);

    // 1. Strict Device Binding Check
    if (activeStudent.linkedDeviceId) {
      if (activeStudent.linkedDeviceId !== device.id) {
        const msg = `⛔ ACCESO DENEGADO: Tu matrícula (${activeStudent.nombre}) está vinculada exclusivamente a otro equipo ("${activeStudent.linkedDeviceName || 'Teléfono registrado'}"). No puedes checar entrada desde un dispositivo diferente ("${device.name}").`;
        setActionMessage({ type: 'error', text: msg });
        alert(msg);
        return;
      }
    } else {
      // Student has no linked device yet -> Ensure this device isn't already claimed by another student
      const allStudents = getStudents();
      const existingOwner = allStudents.find(
        (s) => !isMatriculaMatch(s.matricula, activeStudent.matricula) && s.linkedDeviceId === device.id
      );

      if (existingOwner) {
        const msg = `⛔ DISPOSITIVO YA REGISTRADO: Este teléfono ("${device.name}") ya se encuentra vinculado a la matrícula de otro alumno (${existingOwner.nombre} - Matrícula: ${existingOwner.matricula}). No se permite realizar checadas compartidas.`;
        setActionMessage({ type: 'error', text: msg });
        alert(msg);
        return;
      }

      // Automatically link device to student now!
      const linked = linkStudentDevice(activeStudent.id, device.id, device.name);
      if (linked) {
        activeStudent.linkedDeviceId = device.id;
        activeStudent.linkedDeviceName = device.name;
        activeStudent.linkedAt = new Date().toISOString();
      } else {
        const msg = '⛔ ERROR DE VINCULACIÓN: No se pudo vincular este teléfono a tu matrícula.';
        setActionMessage({ type: 'error', text: msg });
        alert(msg);
        return;
      }
    }

    // 2. Duty Day Check
    const { isDutyDay, dayName } = checkDutyDay();
    if (!isDutyDay) {
      const assignedDays = activeStudent.diasAsistencia ? sortDaysArray(activeStudent.diasAsistencia).join(', ') : 'Días asignados';
      const msg = `📅 DÍA NO AUTORIZADO: Hoy (${dayName}) no te corresponde guardia/asistencia según tu programa (${assignedDays}). No es posible checar hoy.`;
      setActionMessage({ type: 'error', text: msg });
      alert(msg);
      return;
    }

    // 3. Time Window Validation for Entry (5 min before to 15 min tolerance)
    const now = new Date();
    const matchingTurno = todayTurnos.find((t) => {
      const w = getTimeWindow(t.horaEntrada, 5, effectiveTolerancia);
      return now >= w.start && now <= w.end;
    });

    const windowEntrada = matchingTurno
      ? getTimeWindow(matchingTurno.horaEntrada, 5, effectiveTolerancia)
      : getTimeWindow(todayTurnos[0].horaEntrada, 5, effectiveTolerancia);

    if (!matchingTurno) {
      const validWindowsMsg = todayTurnos.map((t) => `${t.horaEntrada} (${effectiveTolerancia}m tol)`).join(' o ');
      const msg = `⏰ FUERA DE HORARIO: Tu(s) horario(s) de entrada hoy son: ${validWindowsMsg}. Solo puedes checar 5 min antes y hasta ${effectiveTolerancia} min después.`;
      setActionMessage({ type: 'error', text: msg });
      alert(msg);
      return;
    }

    const turnoIdx = todayTurnos.indexOf(matchingTurno);
    const turnoLabel = todayTurnos.length > 1
      ? `Turno ${turnoIdx + 1} (${matchingTurno.horaEntrada} - ${matchingTurno.horaSalida})`
      : `Turno (${matchingTurno.horaEntrada} - ${matchingTurno.horaSalida})`;

    // Identify if a record for this specific shift/turno already exists
    const existingTurnoRecord = todayRecords.find(
      (r) => r.turnoIndex === turnoIdx || r.horaEntradaProgramada === matchingTurno.horaEntrada
    ) || (todayTurnos.length === 1 ? todayRecords[0] : undefined);

    // 4. GPS & Geofence
    if (userLat === null || userLng === null || activeDistance === null) {
      const msg = 'Se requiere ubicación GPS para realizar el chequeo.';
      setActionMessage({ type: 'error', text: msg });
      alert(`⚠️ ${msg}`);
      return;
    }

    if (!isInsideGeofence) {
      const msg = secondarySite
        ? `📍 FUERA DE RANGO: Te encuentras fuera del área geográfica de tus 2 sedes autorizadas (${primarySite.nombre}: ${distP}m / límite ${primarySite.radiusMeters}m | ${secondarySite.nombre}: ${distS}m / límite ${secondarySite.radiusMeters}m). Debes estar dentro de la geocerca de cualquiera de tus 2 sedes para checar entrada.`
        : `📍 FUERA DE RANGO: Te encuentras a ${activeDistance}m de tu sede (${activeSite.nombre}). El límite permitido es de ${activeSite.radiusMeters}m. No es posible generar la checada fuera del rango geográfico.`;
      setActionMessage({ type: 'error', text: msg });
      alert(msg);
      return;
    }

    const nowIso = now.toISOString();
    // 5 minutos después de la hora programada se cuenta como 'A_TIEMPO'
    // Después de 5 minutos y hasta el límite de tolerancia (15 min) se cuenta como 'RETARDO'
    const onTimeLimit = new Date(windowEntrada.scheduled.getTime() + 5 * 60 * 1000);
    const isLate = now > onTimeLimit;
    const status: CheckInStatus = isLate ? 'RETARDO' : 'A_TIEMPO';

    const newRecord: AttendanceRecord = {
      id: existingTurnoRecord ? existingTurnoRecord.id : `att-${Date.now()}-${turnoIdx}`,
      studentId: activeStudent.id,
      matricula: activeStudent.matricula,
      fecha: todayStr,
      checkInTime: nowIso,
      checkInLat: userLat,
      checkInLng: userLng,
      checkInDistanceMeters: activeDistance,
      checkInStatus: status,
      checkOutTime: existingTurnoRecord ? existingTurnoRecord.checkOutTime : null,
      checkOutLat: existingTurnoRecord ? existingTurnoRecord.checkOutLat : null,
      checkOutLng: existingTurnoRecord ? existingTurnoRecord.checkOutLng : null,
      checkOutDistanceMeters: existingTurnoRecord ? existingTurnoRecord.checkOutDistanceMeters : null,
      checkOutStatus: existingTurnoRecord ? existingTurnoRecord.checkOutStatus : 'SIN_SALIDA',
      deviceIdUsed: device.id,
      deviceNameUsed: device.name,
      turnoIndex: turnoIdx,
      turnoLabel: turnoLabel,
      horaEntradaProgramada: matchingTurno.horaEntrada,
      horaSalidaProgramada: matchingTurno.horaSalida,
    };

    saveAttendanceRecord(newRecord);
    setStudentRecords(getRecordsByStudentId(activeStudent.id));
    onRefreshData();

    setActionMessage({
      type: 'success',
      text: `✅ ENTRADA REGISTRADA para ${turnoLabel} en ${activeSite.nombre} a las ${now.toLocaleTimeString(
        'es-MX'
      )} (${status === 'RETARDO' ? 'Con Retardo' : 'A Tiempo'}). Distancia GPS: ${activeDistance}m.`,
    });
  };

  // Handle Check-Out (Marcar Salida)
  const handleCheckOut = () => {
    if (!activeStudent) return;

    // 0. Device check validation
    if (activeStudent.linkedDeviceId && activeStudent.linkedDeviceId !== device.id) {
      const msg = `⛔ ACCESO DENEGADO: Tu matrícula (${activeStudent.nombre}) está vinculada exclusivamente a otro equipo ("${activeStudent.linkedDeviceName || 'Teléfono registrado'}"). No puedes checar salida desde un dispositivo diferente ("${device.name}").`;
      setActionMessage({ type: 'error', text: msg });
      alert(msg);
      return;
    }

    // 1. Duty Day Check
    const { isDutyDay, dayName } = checkDutyDay();
    if (!isDutyDay) {
      const assignedDays = activeStudent.diasAsistencia ? sortDaysArray(activeStudent.diasAsistencia).join(', ') : 'Días asignados';
      const msg = `📅 DÍA NO AUTORIZADO: Hoy (${dayName}) no te corresponde guardia/asistencia según tu programa (${assignedDays}).`;
      setActionMessage({ type: 'error', text: msg });
      alert(msg);
      return;
    }

    // 2. Time Window Validation for Exit (5 min before to 15 min tolerance/after)
    const now = new Date();
    const matchingSalidaTurno = todayTurnos.find((t) => {
      const w = getTimeWindow(t.horaSalida, 5, 15);
      return now >= w.start && now <= w.end;
    });

    if (!matchingSalidaTurno) {
      const validSalidaMsg = todayTurnos.map((t) => t.horaSalida).join(' o ');
      const msg = `⏰ FUERA DE HORARIO DE SALIDA: Tu(s) hora(s) de salida hoy son: ${validSalidaMsg}. Solo puedes checar salida en la ventana correspondiente.`;
      setActionMessage({ type: 'error', text: msg });
      alert(msg);
      return;
    }

    const salidaTurnoIdx = todayTurnos.indexOf(matchingSalidaTurno);

    // Find entry record for this specific shift
    const recordToUpdate = todayRecords.find(
      (r) =>
        (r.turnoIndex === salidaTurnoIdx || r.horaEntradaProgramada === matchingSalidaTurno.horaEntrada) &&
        r.checkInTime !== null
    ) || todayRecords.find((r) => r.checkInTime !== null && !r.checkOutTime);

    if (!recordToUpdate || !recordToUpdate.checkInTime) {
      const msg = `Debes registrar la ENTRADA para el Turno ${salidaTurnoIdx + 1} (${matchingSalidaTurno.horaEntrada} - ${matchingSalidaTurno.horaSalida}) antes de marcar la salida.`;
      setActionMessage({ type: 'error', text: msg });
      alert(`⚠️ ${msg}`);
      return;
    }

    // 3. GPS & Geofence
    if (userLat === null || userLng === null || activeDistance === null) {
      const msg = 'Se requiere ubicación GPS para realizar el chequeo.';
      setActionMessage({ type: 'error', text: msg });
      alert(`⚠️ ${msg}`);
      return;
    }

    if (!isInsideGeofence) {
      const msg = secondarySite
        ? `📍 FUERA DE RANGO: Te encuentras fuera del área geográfica de tus 2 sedes autorizadas (${primarySite.nombre}: ${distP}m / límite ${primarySite.radiusMeters}m | ${secondarySite.nombre}: ${distS}m / límite ${secondarySite.radiusMeters}m). Debes estar dentro de la geocerca de cualquiera de tus 2 sedes para checar salida.`
        : `📍 FUERA DE RANGO: Te encuentras a ${activeDistance}m de tu sede hospitalaria (${activeSite.nombre}). Para registrar tu salida debes encontrarte dentro del límite de geolocalización (${activeSite.radiusMeters}m).`;
      setActionMessage({ type: 'error', text: msg });
      alert(msg);
      return;
    }

    const nowIso = now.toISOString();

    const updatedRecord: AttendanceRecord = {
      ...recordToUpdate,
      checkOutTime: nowIso,
      checkOutLat: userLat,
      checkOutLng: userLng,
      checkOutDistanceMeters: activeDistance,
      checkOutStatus: 'COMPLETADO',
    };

    saveAttendanceRecord(updatedRecord);
    setStudentRecords(getRecordsByStudentId(activeStudent.id));
    onRefreshData();

    setActionMessage({
      type: 'success',
      text: `🏁 SALIDA REGISTRADA para Turno ${salidaTurnoIdx + 1} (${matchingSalidaTurno.horaEntrada} - ${matchingSalidaTurno.horaSalida}) en ${activeSite.nombre} a las ${now.toLocaleTimeString(
        'es-MX'
      )} (Turno Completado).`,
    });
  };

  // Device validation guard
  if (activeStudent && activeStudent.linkedDeviceId && activeStudent.linkedDeviceId !== device.id) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12">
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 border border-rose-300 dark:border-rose-900 shadow-2xl text-center space-y-4">
          <div className="w-16 h-16 bg-rose-100 dark:bg-rose-950/80 text-rose-600 dark:text-rose-400 rounded-full flex items-center justify-center mx-auto">
            <ShieldAlert className="w-8 h-8" />
          </div>

          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
            Acceso Denegado por Dispositivo No Autorizado
          </h2>

          <div className="p-4 bg-rose-50 dark:bg-rose-950/50 rounded-2xl border border-rose-200 dark:border-rose-900 text-xs text-rose-900 dark:text-rose-200 space-y-2 text-left">
            <p>
              <strong>Matrícula:</strong> {activeStudent.matricula} — {activeStudent.nombre}
            </p>
            <p>
              <strong>Dispositivo Autorizado:</strong>{' '}
              <span className="font-mono font-bold text-rose-700 dark:text-rose-300">
                {activeStudent.linkedDeviceName || 'Dispositivo registrado en 1er login'}
              </span>
            </p>
            <p>
              <strong>Dispositivo Actual:</strong>{' '}
              <span className="font-mono text-slate-700 dark:text-slate-300">
                {device.name}
              </span>
            </p>
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-400">
            No se permite acceder ni registrar checadas desde un equipo distinto al vinculado la primera vez que ingresaste. Si cambiaste de equipo, solicita a tu docente desvincular tu dispositivo.
          </p>

          <button
            type="button"
            onClick={onLogoutStudent}
            className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-2xl text-xs transition-all shadow-md"
          >
            Cerrar Sesión y Volver al Inicio
          </button>
        </div>
      </div>
    );
  }

  // If NO active student logged in, show Login Screen
  if (!activeStudent) {
    return (
      <div className="max-w-md mx-auto px-4 py-8 sm:py-12">
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-xl text-center">
          <div className="w-16 h-16 bg-red-500/10 text-red-600 dark:text-red-400 rounded-2xl border border-red-500/20 flex items-center justify-center mx-auto mb-4">
            <UserCheck className="w-8 h-8" />
          </div>

          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Portal ClinicasTrack
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-6">
            Inicia sesión con tu matrícula para registrar asistencia GPS en tu sede clínica asignada.
          </p>

          <form onSubmit={handleStudentLogin} className="space-y-4 text-left">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Matrícula de Alumno
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={inputMatricula}
                  onChange={(e) => setInputMatricula(e.target.value)}
                  placeholder="Ej. 20241001"
                  className="w-full pl-4 pr-10 py-3 rounded-xl border border-slate-300 bg-slate-50 text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 font-mono tracking-wider text-sm"
                  autoFocus
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <Smartphone className="w-4 h-4" />
                </div>
              </div>
            </div>

            {loginError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{loginError}</span>
              </div>
            )}

            {/* Device Binding Security Notice */}
            <div className="p-3 bg-red-50/80 border border-red-200 rounded-xl text-xs text-red-900 flex items-start gap-2">
              <Smartphone className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <strong className="block text-red-950 font-bold">
                  Seguridad de Dispositivo Único
                </strong>
                Tu matrícula quedará enlazada automáticamente a este teléfono ({device.name}) para evitar suplantaciones.
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3.5 px-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 text-sm"
            >
              <span>Acceder al Portal</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Quick Demo Matricula Chips for easy testing */}
          <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800 text-left">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Matrículas de Prueba Disponibles:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[
                { mat: '723053105', name: 'Airam Elena (HGLM)' },
                { mat: '723053018', name: 'Edel Emilio (HGLM 7 A)' },
                { mat: '722053254', name: 'María Itzamna' },
                { mat: '722053106', name: 'Brayan Josué' },
              ].map((s) => (
                <button
                  key={s.mat}
                  onClick={() => setInputMatricula(s.mat)}
                  className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-900/30 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-mono border border-slate-200 dark:border-slate-700 transition-colors"
                >
                  {s.mat} ({s.name})
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Security Confirmation Modal for New Device Binding */}
        {pendingLinkStudent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/75 backdrop-blur-sm animate-fadeIn">
            <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-5 transform transition-all animate-scaleUp text-left">
              
              {/* Header */}
              <div className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
                <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base leading-tight">
                    Confirmar Vinculación de Alumno
                  </h3>
                  <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                    Capa de Seguridad y Verificación de Identidad
                  </p>
                </div>
              </div>

              {/* Instruction */}
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Estás a punto de vincular este dispositivo a la siguiente matrícula. Por favor verifica que tus datos sean correctos para evitar registrar asistencias a nombre de otra persona:
              </p>

              {/* Student Info Verification Card */}
              <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 space-y-2.5">
                <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-700/60 pb-2">
                  <span className="text-[11px] font-bold uppercase text-slate-400">Matrícula</span>
                  <span className="text-sm font-mono font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 px-2.5 py-0.5 rounded-lg border border-blue-200 dark:border-blue-800">
                    {pendingLinkStudent.matricula}
                  </span>
                </div>

                <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-700/60 pb-2">
                  <span className="text-[11px] font-bold uppercase text-slate-400">Nombre Completo</span>
                  <span className="text-xs font-bold text-slate-900 dark:text-white text-right truncate max-w-[200px]">
                    {pendingLinkStudent.nombre}
                  </span>
                </div>

                {pendingLinkStudent.grupo && (
                  <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-700/60 pb-2">
                    <span className="text-[11px] font-bold uppercase text-slate-400">Grupo</span>
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {pendingLinkStudent.grupo}
                    </span>
                  </div>
                )}

                {pendingLinkStudent.sedeId && (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase text-slate-400">Sede Principal</span>
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate max-w-[200px]">
                      {getHospitalSiteById(pendingLinkStudent.sedeId)?.nombre || pendingLinkStudent.sedeId}
                    </span>
                  </div>
                )}
              </div>

              {/* Warning Box */}
              <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-xl border border-amber-200 dark:border-amber-800/80 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <strong className="block font-bold">Asegúrate de que seas tú</strong>
                  <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-snug">
                    Este teléfono celular quedará registrado como el dispositivo oficial de esta matrícula para marcar asistencias.
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPendingLinkStudent(null)}
                  className="w-full py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  onClick={handleConfirmLinkStudent}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>Sí, Es Mi Matrícula</span>
                </button>
              </div>

            </div>
          </div>
        )}
      </div>
    );
  }

  // Active Student View
  return (
    <div className="w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6 overflow-hidden min-w-0">
      {/* Student Welcome Header & Phone Binding Card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 w-full min-w-0 break-words">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-red-600 to-rose-800 text-white rounded-2xl flex items-center justify-center font-bold text-xl shadow-md">
            {activeStudent.nombre.substring(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {activeStudent.nombre}
              </h2>
              <span className="px-2 py-0.5 text-xs font-mono font-semibold bg-slate-100 text-slate-700 rounded-md border border-slate-200">
                Matrícula: {activeStudent.matricula}
              </span>
              <span className="px-2.5 py-0.5 text-xs font-bold bg-red-50 text-red-800 rounded-md border border-red-200">
                Grupo {activeStudent.grupo || '10 A'} - {activeStudent.equipo || 'Equipo 1'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 mt-1 flex-wrap">
              <span className="flex items-center gap-1 font-semibold text-red-700 dark:text-red-400">
                <Building2 className="w-3.5 h-3.5 text-red-600" />
                Sede Principal: <strong>{primarySite.nombre}</strong>
              </span>
              {secondarySite && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-1 font-semibold text-blue-700 dark:text-blue-400">
                    <Building2 className="w-3.5 h-3.5 text-blue-600" />
                    Sede Secundaria: <strong>{secondarySite.nombre}</strong>
                  </span>
                </>
              )}
              <span>•</span>
              <span className="flex items-center gap-1 text-slate-800 dark:text-slate-200 font-medium">
                <Clock className="w-3.5 h-3.5 text-red-600" />
                Horario Hoy ({todayDayName}):{' '}
                {hasGuardiaToday ? (
                  <>
                    <strong className="text-red-700 dark:text-red-400 font-mono bg-red-50 dark:bg-red-950/50 px-1.5 py-0.5 rounded border border-red-100 dark:border-red-900">
                      {todayTurnosFormatted}
                    </strong>{' '}
                    ({effectiveTolerancia}m tol)
                  </>
                ) : (
                  <strong className="text-amber-800 dark:text-amber-300 font-sans font-bold bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                    Hoy no tienes guardia asignada
                  </strong>
                )}
              </span>
              <span>•</span>
              <span>Especialidad / Rotación: <strong className="text-slate-900 dark:text-white">{activeStudent.especialidad || activeStudent.rotacion}</strong></span>
              <span>•</span>
              <span className="flex items-center gap-1">
                Días y Horarios Asignados:
                <span className="font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-100">
                  {activeStudent.horariosPorDia && activeStudent.horariosPorDia.length > 0
                    ? sortDaySchedules(activeStudent.horariosPorDia).map((h) => {
                        const turnosStr = h.turnos && h.turnos.length > 0
                          ? h.turnos.map((t) => `${t.horaEntrada}-${t.horaSalida}`).join(', ')
                          : `${h.horaEntrada}-${h.horaSalida}`;
                        return `${h.dia}: ${turnosStr}`;
                      }).join(' | ')
                    : activeStudent.diasAsistencia && activeStudent.diasAsistencia.length > 0
                    ? `${sortDaysArray(activeStudent.diasAsistencia).join(', ')} (${todayTurnosFormatted})`
                    : 'Sin días asignados'}
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* Security / Linked Device Status */}
        <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200 dark:border-slate-700/60 text-xs">
          <Smartphone className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div>
            <div className="font-semibold text-slate-800 dark:text-slate-200">
              Teléfono Vinculado
            </div>
            <div className="text-slate-500 dark:text-slate-400 text-[11px] truncate max-w-[200px]">
              {activeStudent.linkedDeviceName || device.name}
            </div>
          </div>
          <span className="ml-auto px-2 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 rounded font-bold text-[10px]">
            PROTEGIDO
          </span>
        </div>
      </div>

      {/* Main Check-In Console & Geofence Map */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: GPS Geofence Map & Controls */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-red-600 dark:text-red-400" />
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  Geolocalización GPS en Tiempo Real
                </h3>
                <p className="text-xs text-slate-500">
                  {secondarySite ? (
                    <>
                      Sedes Habilitadas:{' '}
                      <strong className="text-red-600 dark:text-red-400">{primarySite.nombre}</strong> y{' '}
                      <strong className="text-blue-600 dark:text-blue-400">{secondarySite.nombre}</strong>
                    </>
                  ) : (
                    <>
                      Sede: <strong className="text-red-600 dark:text-red-400">{primarySite.nombre}</strong>
                    </>
                  )}
                </p>
              </div>
            </div>

            <button
              onClick={requestGPS}
              disabled={isLoadingGeo}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingGeo ? 'animate-spin' : ''}`} />
              <span>Actualizar GPS</span>
            </button>
          </div>

          {/* GPS Distance Status Banner */}
          {geoError && (
            <button
              type="button"
              onClick={() => setShowLocationModal(true)}
              className="w-full p-3.5 bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 rounded-xl text-left flex items-center justify-between gap-3 text-rose-900 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors shadow-sm"
            >
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
                <div>
                  <div className="text-xs font-bold">{geoError}</div>
                  <div className="text-[11px] text-rose-700 dark:text-rose-300 underline font-semibold">
                    Toca aquí para ver cómo activar el GPS en tu dispositivo (iPhone / Android)
                  </div>
                </div>
              </div>
              <span className="px-2.5 py-1 bg-rose-600 text-white font-bold text-xs rounded-lg shrink-0 shadow">
                Otorgar Permiso GPS
              </span>
            </button>
          )}

          <div
            className={`p-4 rounded-xl border flex items-center justify-between text-xs sm:text-sm ${
              isInsideGeofence
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-900/50 dark:text-emerald-200'
                : 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-900/50 dark:text-amber-200'
            }`}
          >
            <div className="flex items-center gap-3">
              {isInsideGeofence ? (
                <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400 shrink-0" />
              )}
              <div>
                <div className="font-bold">
                  {isInsideGeofence
                    ? `DENTRO DE SEDE AUTORIZADA: ${activeSite.nombre}`
                    : secondarySite
                    ? `FUERA DE RANGO EN AMBAS SEDES`
                    : `FUERA DE LA SEDE ASIGNADA`}
                </div>
                <div className="text-xs opacity-90">
                  {activeDistance !== null
                    ? secondarySite
                      ? isInsideGeofence
                        ? `Te encuentras dentro del perímetro de ${activeSite.nombre} (${activeDistance}m / límite ${activeSite.radiusMeters}m).`
                        : `Distancias: ${primarySite.nombre} (${distP}m) | ${secondarySite.nombre} (${distS}m)`
                      : `Distancia a tu sede: ${activeDistance} metros (Límite: ${activeSite.radiusMeters}m)`
                    : 'Obteniendo señal GPS...'}
                </div>
              </div>
            </div>

            <div className="font-mono font-bold text-base px-3 py-1 rounded-lg bg-white/60 dark:bg-slate-900/60 shadow-inner">
              {activeDistance !== null ? `${activeDistance} m` : '--'}
            </div>
          </div>

          {/* Interactive Map */}
          <MapPicker
            hospitalLat={primarySite.latitude}
            hospitalLng={primarySite.longitude}
            radiusMeters={primarySite.radiusMeters}
            hospitalName={primarySite.nombre}
            secondaryHospitalLat={secondarySite?.latitude}
            secondaryHospitalLng={secondarySite?.longitude}
            secondaryRadiusMeters={secondarySite?.radiusMeters}
            secondaryHospitalName={secondarySite?.nombre}
            userLat={userLat}
            userLng={userLng}
            isInsideGeofence={isInsideGeofence}
            distanceMeters={activeDistance}
            heightClass="h-64 sm:h-80"
          />

          {/* Real GPS Device Hardware Notice */}
          <div className="p-3 bg-emerald-50/60 dark:bg-emerald-950/30 rounded-xl border border-emerald-200 dark:border-emerald-900/50 flex items-center justify-between text-xs text-emerald-900 dark:text-emerald-200">
            <span className="flex items-center gap-2 font-medium">
              <ShieldAlert className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>
                <strong>GPS Real del Dispositivo Activado:</strong> La ubicación se valida directamente mediante el sensor GPS de tu teléfono.
              </span>
            </span>
            <span className="px-2 py-0.5 bg-emerald-600 text-white rounded font-bold text-[10px] uppercase">
              GPS Físico
            </span>
          </div>
        </div>

        {/* Right Column: Check-In & Check-Out Buttons + Today's Status */}
        <div className="lg:col-span-5 space-y-6">
          {/* Action Card */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
                <Clock className="w-5 h-5 text-red-600 dark:text-red-400" />
                Checada de hoy ({formatDateDisplay(todayStr)})
              </h3>
              <span className="text-xs text-red-700 dark:text-red-400 font-mono font-bold bg-red-50 dark:bg-red-950/40 px-2 py-0.5 rounded border border-red-200 dark:border-red-900">
                Horario Alumno: {effectiveEntrada} - {effectiveSalida}
              </span>
            </div>

            {/* Action Feedback Banner */}
            {actionMessage && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                  actionMessage.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-900'
                    : 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/40 dark:border-rose-900'
                }`}
              >
                {actionMessage.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                )}
                <span>{actionMessage.text}</span>
              </div>
            )}

            {/* Today's Registration Summary */}
            {todayTurnos.length > 1 ? (
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                  Turnos Programados para Hoy ({todayTurnos.length} Turnos)
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {todayTurnos.map((t, idx) => {
                    const rec = todayRecords.find(
                      (r) => r.turnoIndex === idx || r.horaEntradaProgramada === t.horaEntrada
                    );
                    return (
                      <div
                        key={idx}
                        className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between font-bold text-slate-800 dark:text-slate-200">
                          <span>Turno {idx + 1}</span>
                          <span className="font-mono text-blue-600 dark:text-blue-400">
                            {t.horaEntrada} - {t.horaSalida}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
                          <span>Entrada: <strong className="font-mono">{rec?.checkInTime ? formatTimeDisplay(rec.checkInTime) : '--:--'}</strong></span>
                          {rec?.checkInStatus && (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              rec.checkInStatus === 'A_TIEMPO' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            }`}>
                              {rec.checkInStatus === 'A_TIEMPO' ? 'A TIEMPO' : 'RETARDO'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
                          <span>Salida: <strong className="font-mono">{rec?.checkOutTime ? formatTimeDisplay(rec.checkOutTime) : '--:--'}</strong></span>
                          {rec?.checkOutStatus && (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              rec.checkOutStatus === 'COMPLETADO' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}>
                              {rec.checkOutStatus === 'COMPLETADO' ? 'COMPLETADO' : rec.checkOutStatus === 'SIN_SALIDA' ? 'EN TURNO' : 'ANTICIPADA'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 text-center">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                    Entrada Registrada
                  </span>
                  <span className="text-base font-bold font-mono text-slate-800 dark:text-slate-100 mt-1 block">
                    {todayRecord?.checkInTime
                      ? formatTimeDisplay(todayRecord.checkInTime)
                      : '--:--'}
                  </span>
                  {todayRecord?.checkInStatus && (
                    <span
                      className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                        todayRecord.checkInStatus === 'A_TIEMPO'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                      }`}
                    >
                      {todayRecord.checkInStatus === 'A_TIEMPO' ? 'A TIEMPO' : 'RETARDO'}
                    </span>
                  )}
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 text-center">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                    Salida Registrada
                  </span>
                  <span className="text-base font-bold font-mono text-slate-800 dark:text-slate-100 mt-1 block">
                    {todayRecord?.checkOutTime
                      ? formatTimeDisplay(todayRecord.checkOutTime)
                      : '--:--'}
                  </span>
                  {todayRecord?.checkOutStatus && (
                    <span
                      className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                        todayRecord.checkOutStatus === 'COMPLETADO'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {todayRecord.checkOutStatus === 'COMPLETADO'
                        ? 'COMPLETADO'
                        : todayRecord.checkOutStatus === 'SIN_SALIDA'
                        ? 'EN TURNO'
                        : 'ANTICIPADA'}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Check-In / Check-Out Buttons */}
            <div className="space-y-3 pt-2">
              <button
                onClick={handleCheckIn}
                className="w-full py-4 px-4 rounded-xl font-bold transition-all shadow-md flex items-center justify-center gap-2 text-sm bg-red-600 hover:bg-red-700 text-white shadow-red-600/20 active:scale-[0.99] cursor-pointer"
              >
                <CheckCircle2 className="w-5 h-5" />
                <span>
                  {todayRecord?.checkInTime
                    ? 'MARCAR ENTRADA (GPS) • [Registrada]'
                    : 'MARCAR ENTRADA (GPS)'}
                </span>
              </button>

              <button
                onClick={handleCheckOut}
                className="w-full py-3.5 px-4 rounded-xl font-bold transition-all shadow-md flex items-center justify-center gap-2 text-sm bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white shadow-slate-900/20 active:scale-[0.99] cursor-pointer"
              >
                <LogOut className="w-5 h-5" />
                <span>
                  {todayRecord?.checkOutTime
                    ? 'MARCAR SALIDA (GPS) • [Registrada]'
                    : 'MARCAR SALIDA (GPS)'}
                </span>
              </button>
            </div>
          </div>

          {/* Student Personal Attendance History */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
            <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
              <Calendar className="w-4 h-4 text-red-600 dark:text-red-400" />
              Historial Personal de Checadas
            </h3>

            {studentRecords.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                Aún no tienes registros de asistencia acumulados.
              </p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {studentRecords.map((r) => (
                  <div
                    key={r.id}
                    className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800/80 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 flex-wrap">
                        <span>{formatDateDisplay(r.fecha)}</span>
                        {(r.turnoLabel || r.horaEntradaProgramada) && (
                          <span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 rounded text-[10px] font-mono">
                            {r.turnoLabel || `Turno (${r.horaEntradaProgramada})`}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                        <span>Entrada: {formatTimeDisplay(r.checkInTime)}</span>
                        <span>•</span>
                        <span>Salida: {formatTimeDisplay(r.checkOutTime)}</span>
                      </div>
                    </div>

                    <div className="text-right space-y-1">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          r.checkInStatus === 'A_TIEMPO'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : r.checkInStatus === 'RETARDO'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                        }`}
                      >
                        {r.checkInStatus}
                      </span>
                      {r.checkInDistanceMeters !== null && (
                        <div className="text-[10px] font-mono text-slate-400">
                          {r.checkInDistanceMeters}m dist.
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Location Permission Modal */}
      <LocationPermissionModal
        isOpen={showLocationModal}
        onClose={() => setShowLocationModal(false)}
        onPermissionGranted={(lat, lng) => {
          setUserLat(lat);
          setUserLng(lng);
          requestGPS();
        }}
        studentName={activeStudent?.nombre}
      />
    </div>
  );
};
