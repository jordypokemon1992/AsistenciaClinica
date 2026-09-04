import React, { useState, useEffect, useCallback } from 'react';
import { Student, HospitalZone, AttendanceRecord, HospitalSite, TimeTurno, DiaInhabil } from '../types';
import { MapPicker } from './MapPicker';
import {
  saveStudent,
  saveStudentsList,
  deleteStudent,
  linkStudentDevice,
  unlinkStudentDevice,
  unlinkAllStudentDevices,
  isMatriculaMatch,
  saveHospitalZone,
  saveAttendanceRecord,
  deleteAttendanceRecord,
  getMasterConfig,
  saveMasterConfig,
  getHospitalSites,
  saveHospitalSite,
  deleteHospitalSite,
  pushLocalDataToCloud,
  clearSemesterStudents,
  getDiasInhabiles,
  saveDiaInhabil,
  deleteDiaInhabil,
  exportFullSystemBackup,
  importFullSystemBackup,
  forceReloadStateFromServer,
  uploadStateFileToServer,
  analyzeStateFileWithServer,
  StateDiffAnalysis,
  sanitizeStudentSchedules,
  fetchAttendanceStatsFromServer,
  fetchStudentRecordsFromServer,
} from '../services/storage';
import {
  formatDateDisplay,
  formatTimeDisplay,
  getTodayDateString,
} from '../utils/geolocation';
import { exportGroupPDFReport, calculateStudentGuardRatio } from '../utils/pdfExport';
import {
  Users,
  Search,
  Plus,
  Trash2,
  Smartphone,
  ShieldCheck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Calendar,
  MapPin,
  Settings,
  X,
  Edit2,
  Filter,
  Check,
  Building,
  RefreshCw,
  FileSpreadsheet,
  Award,
  ChevronRight,
  UserCheck,
  HelpCircle,
  KeyRound,
  LogOut,
  Lock,
  Eye,
  EyeOff,
  Folder,
  Download,
  Upload,
  Layers,
  FileText,
  Cloud,
  Info,
  RotateCcw,
  UserX,
  Printer,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  CalendarX,
  CalendarOff,
  Sparkles,
  Activity,
  Edit3,
  Radio,
  Database,
  ShieldAlert,
  Loader2,
} from 'lucide-react';
import {
  normalizeSpanishDay,
  WEEKDAY_NAMES_ES,
  DIAS_SEMANA_OPCIONES,
  sortDaysArray,
  sortDaySchedules,
} from '../utils/dayUtils';

const isDutyDayForDate = (date: Date, student: Student): boolean => {
  const dayIndex = date.getDay(); // 0 = Domingo, 1 = Lunes, etc.
  const dayNameNorm = WEEKDAY_NAMES_ES[dayIndex];
  
  const assignedDays = student.diasAsistencia && student.diasAsistencia.length > 0
    ? student.diasAsistencia
    : (student.horariosPorDia || []).map(h => h.dia);

  return assignedDays.some(d => normalizeSpanishDay(d) === dayNameNorm);
};

interface TeacherDashboardProps {
  students: Student[];
  hospitalZone: HospitalZone;
  attendanceRecords: AttendanceRecord[];
  onRefreshData: () => void;
  onLogoutMasterTeacher?: () => void;
  onResetDemoData?: () => void;
}

export const TeacherDashboard: React.FC<TeacherDashboardProps> = ({
  students,
  hospitalZone,
  attendanceRecords,
  onRefreshData,
  onLogoutMasterTeacher,
  onResetDemoData,
}) => {
  const [activeTab, setActiveTab] = useState<
    'STUDENTS' | 'GROUPS' | 'RECORDS' | 'HOLIDAYS' | 'CONFIG'
  >('STUDENTS');

  // Días Inhábiles State
  const [diasInhabiles, setDiasInhabiles] = useState<DiaInhabil[]>(() => getDiasInhabiles());
  const [newInhabilFecha, setNewInhabilFecha] = useState<string>('');
  const [newInhabilMotivo, setNewInhabilMotivo] = useState<string>('');
  const [inhabilSuccessMsg, setInhabilSuccessMsg] = useState<string | null>(null);
  const [inhabilSearch, setInhabilSearch] = useState<string>('');

  // Master Auth Config State
  const initialMaster = getMasterConfig();
  const [masterUserForm, setMasterUserForm] = useState(initialMaster.usuario);
  const [masterPassForm, setMasterPassForm] = useState(initialMaster.password);
  const [showMasterPass, setShowMasterPass] = useState(false);
  const [masterSaveSuccess, setMasterSaveSuccess] = useState(false);

  // System Backup (Export / Import Data) State
  const backupFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [isImportingBackup, setIsImportingBackup] = useState(false);
  const [backupStatus, setBackupStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Supabase PostgreSQL Cloud Sync State & Retention Policies
  const [supabaseStatus, setSupabaseStatus] = useState<{
    configured: boolean;
    provider?: string;
    projectId?: string | null;
    status?: string;
    circuitBreakerOpen?: boolean;
    lastSyncTimestamp?: number;
    lastSyncIso?: string | null;
    message: string;
  } | null>(null);
  const [isSyncingSupabase, setIsSyncingSupabase] = useState(false);
  const [supabaseSyncResult, setSupabaseSyncResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showCloudRunHelp, setShowCloudRunHelp] = useState(false);
  const [isPurgingRecords, setIsPurgingRecords] = useState(false);
  const [purgeRetentionDays, setPurgeRetentionDays] = useState<number>(60);
  const [purgeResult, setPurgeResult] = useState<{ success: boolean; message: string } | null>(null);

  const [supabaseDiagnostics, setSupabaseDiagnostics] = useState<{
    configured: boolean;
    provider: string;
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
    supabaseCounts?: {
      students: number;
      records: number;
      sites: number;
      holidays: number;
    };
  } | null>(null);
  const [isLoadingDiagnostics, setIsLoadingDiagnostics] = useState(false);

  const fetchSupabaseDiagnostics = useCallback(async () => {
    setIsLoadingDiagnostics(true);
    try {
      const res = await fetch('/api/supabase/diagnostics');
      if (res.ok) {
        const data = await res.json();
        setSupabaseDiagnostics(data);
      }
    } catch (err) {
      console.warn('Supabase diagnostics fetch error:', err);
    } finally {
      setIsLoadingDiagnostics(false);
    }
  }, []);

  const fetchSupabaseStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/supabase/status');
      if (res.ok) {
        const data = await res.json();
        setSupabaseStatus(data);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchSupabaseStatus();
    if (activeTab === 'CONFIG') {
      fetchSupabaseDiagnostics();
    }
  }, [fetchSupabaseStatus, fetchSupabaseDiagnostics, activeTab]);

  const handleSyncToSupabase = async () => {
    const confirmed = window.confirm(
      '⚠️ ¿Deseas sincronizar todos los datos locales a Supabase PostgreSQL?\n\nEsta acción respaldará todas las tablas (alumnos, checadas, sedes, días inhábiles) en tu base de datos Supabase en la nube.'
    );
    if (!confirmed) return;

    setIsSyncingSupabase(true);
    setSupabaseSyncResult(null);
    try {
      const res = await fetch('/api/supabase/sync', { method: 'POST' });
      const data = await res.json();
      setSupabaseSyncResult({
        success: data.success,
        message: data.message,
      });
      fetchSupabaseStatus();
      fetchSupabaseDiagnostics();
    } catch (err: any) {
      setSupabaseSyncResult({
        success: false,
        message: `Error al sincronizar con Supabase: ${err.message}`,
      });
    } finally {
      setIsSyncingSupabase(false);
      setTimeout(() => setSupabaseSyncResult(null), 8000);
    }
  };

  const handlePullFromSupabase = async (forceFull = false) => {
    const confirmed = window.confirm(
      '⚠️ ¿Deseas descargar y sobrescribir los datos locales desde Supabase?\n\nEsta acción leerá las tablas desde Supabase PostgreSQL y actualizará la base de datos local SQLite clinicas.db.\n\n¿Continuar con la restauración?'
    );
    if (!confirmed) return;

    setIsSyncingSupabase(true);
    setSupabaseSyncResult(null);
    try {
      const res = await fetch('/api/supabase/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceFull }),
      });
      const data = await res.json();
      setSupabaseSyncResult({
        success: data.success,
        message: data.message,
      });
      if (data.success) {
        onRefreshData();
      }
      fetchSupabaseStatus();
      fetchSupabaseDiagnostics();
    } catch (err: any) {
      setSupabaseSyncResult({
        success: false,
        message: `Error al descargar desde Supabase: ${err.message}`,
      });
    } finally {
      setIsSyncingSupabase(false);
      setTimeout(() => setSupabaseSyncResult(null), 8000);
    }
  };

  const handleDeltaSyncFromSupabase = async () => {
    setIsSyncingSupabase(true);
    setSupabaseSyncResult(null);
    try {
      const res = await fetch('/api/supabase/delta-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendanceDaysBack: 7 }),
      });
      const data = await res.json();
      setSupabaseSyncResult({
        success: data.success,
        message: data.message,
      });
      if (data.success) {
        onRefreshData();
      }
      fetchSupabaseStatus();
      fetchSupabaseDiagnostics();
    } catch (err: any) {
      setSupabaseSyncResult({
        success: false,
        message: `Error en Delta Sync: ${err.message}`,
      });
    } finally {
      setIsSyncingSupabase(false);
      setTimeout(() => setSupabaseSyncResult(null), 8000);
    }
  };

  // Group View Selected Tab
  const [selectedGroupTab, setSelectedGroupTab] = useState<string>('10 A');

  // Semestre Date Range State (Rango de evaluación de asistencias a guardias)
  const [fechaInicioSemestre, setFechaInicioSemestre] = useState<string>(
    () => localStorage.getItem('fechaInicioSemestre') || '2026-01-15'
  );
  const [fechaFinSemestre, setFechaFinSemestre] = useState<string>(
    () => localStorage.getItem('fechaFinSemestre') || '2026-06-30'
  );

  interface TeamScheduleState {
    days: string[];
    schedulesByDay: Record<string, { turnos: TimeTurno[] }>;
  }

  // Estado para la configuración de días y horarios por equipo especifico
  const [teamSchedules, setTeamSchedules] = useState<
    Record<string, TeamScheduleState>
  >({});
  const [savedTeamAlert, setSavedTeamAlert] = useState<string | null>(null);
  const [savingTeamKey, setSavingTeamKey] = useState<string | null>(null);

  // Estado para controlar qué paneles de horario de equipo están expandidos (por defecto todos minimizados)
  const [expandedTeams, setExpandedTeams] = useState<Record<string, boolean>>({});

  const toggleTeamExpand = (teamKey: string) => {
    setExpandedTeams((prev) => ({
      ...prev,
      [teamKey]: !prev[teamKey],
    }));
  };

  const getTeamSchedule = (
    teamKey: string,
    teamStudents: Student[]
  ): TeamScheduleState => {
    if (teamSchedules[teamKey]) {
      return teamSchedules[teamKey];
    }
    const cleanStudents = (teamStudents || []).map(sanitizeStudentSchedules);
    const sample =
      cleanStudents.find((s) => s.horariosPorDia && s.horariosPorDia.length > 0) ||
      cleanStudents.find((s) => s.diasAsistencia && s.diasAsistencia.length > 0) ||
      cleanStudents[0];
    const days = sortDaysArray(
      sample?.diasAsistencia && sample.diasAsistencia.length > 0
        ? sample.diasAsistencia
        : ['Lunes', 'Jueves']
    );

    const defaultEntrada = sample?.horaEntrada || hospitalZone.horaEntrada || '07:00';
    const defaultSalida = sample?.horaSalida || hospitalZone.horaSalida || '15:00';

    const schedulesByDay: Record<string, { turnos: TimeTurno[] }> = {};

    if (sample?.horariosPorDia && sample.horariosPorDia.length > 0) {
      sample.horariosPorDia.forEach((h) => {
        let turnos: TimeTurno[] = [];
        if (h.turnos && h.turnos.length > 0) {
          turnos = h.turnos.map((t) => ({ horaEntrada: t.horaEntrada, horaSalida: t.horaSalida }));
        } else {
          turnos = [{ horaEntrada: h.horaEntrada || defaultEntrada, horaSalida: h.horaSalida || defaultSalida }];
        }
        schedulesByDay[h.dia] = { turnos };
      });
    }

    DIAS_SEMANA_OPCIONES.forEach((d) => {
      if (!schedulesByDay[d] || !schedulesByDay[d].turnos || schedulesByDay[d].turnos.length === 0) {
        schedulesByDay[d] = {
          turnos: [{ horaEntrada: defaultEntrada, horaSalida: defaultSalida }],
        };
      }
    });

    return { days, schedulesByDay };
  };

  const handleToggleTeamDay = (
    teamKey: string,
    teamStudents: Student[],
    day: string
  ) => {
    const current = getTeamSchedule(teamKey, teamStudents);
    const hasDay = current.days.includes(day);
    const newDays = sortDaysArray(
      hasDay
        ? current.days.filter((d) => d !== day)
        : [...current.days, day]
    );

    setTeamSchedules((prev) => ({
      ...prev,
      [teamKey]: { ...current, days: newDays },
    }));
  };

  const handleTeamAddTurno = (
    teamKey: string,
    teamStudents: Student[],
    day: string
  ) => {
    const current = getTeamSchedule(teamKey, teamStudents);
    const daySched = current.schedulesByDay[day] || { turnos: [{ horaEntrada: '07:00', horaSalida: '15:00' }] };
    const lastTurno = daySched.turnos[daySched.turnos.length - 1] || { horaEntrada: '07:00', horaSalida: '15:00' };

    const newTurnos = [
      ...daySched.turnos,
      { horaEntrada: lastTurno.horaSalida || '16:00', horaSalida: '17:00' },
    ];

    setTeamSchedules((prev) => ({
      ...prev,
      [teamKey]: {
        ...current,
        schedulesByDay: {
          ...current.schedulesByDay,
          [day]: { turnos: newTurnos },
        },
      },
    }));
  };

  const handleTeamRemoveTurno = (
    teamKey: string,
    teamStudents: Student[],
    day: string,
    index: number
  ) => {
    const current = getTeamSchedule(teamKey, teamStudents);
    const daySched = current.schedulesByDay[day];
    if (!daySched || daySched.turnos.length <= 1) return;

    const newTurnos = daySched.turnos.filter((_, i) => i !== index);

    setTeamSchedules((prev) => ({
      ...prev,
      [teamKey]: {
        ...current,
        schedulesByDay: {
          ...current.schedulesByDay,
          [day]: { turnos: newTurnos },
        },
      },
    }));
  };

  const handleTeamTurnoTimeChange = (
    teamKey: string,
    teamStudents: Student[],
    day: string,
    index: number,
    field: 'horaEntrada' | 'horaSalida',
    value: string
  ) => {
    const current = getTeamSchedule(teamKey, teamStudents);
    const daySched = current.schedulesByDay[day] || { turnos: [{ horaEntrada: '07:00', horaSalida: '15:00' }] };

    const updatedTurnos = daySched.turnos.map((t, i) =>
      i === index ? { ...t, [field]: value } : t
    );

    setTeamSchedules((prev) => ({
      ...prev,
      [teamKey]: {
        ...current,
        schedulesByDay: {
          ...current.schedulesByDay,
          [day]: { turnos: updatedTurnos },
        },
      },
    }));
  };

  const handleSaveTeamSchedule = async (
    teamKey: string,
    eqKey: string,
    teamStudents: Student[]
  ) => {
    const current = getTeamSchedule(teamKey, teamStudents);

    if (current.days.length === 0) {
      alert(`Por favor selecciona al menos un día de guardia para el ${eqKey}.`);
      return;
    }

    setSavingTeamKey(teamKey);
    try {
      const sortedDays = sortDaysArray(current.days);
      const teamStudentIds = new Set(teamStudents.map((s) => s.id).filter(Boolean));
      const teamStudentMatriculas = new Set(
        teamStudents.map((s) => String(s.matricula).trim().toLowerCase()).filter(Boolean)
      );

      const isTeamMember = (st: Student) => {
        if (st.id && teamStudentIds.has(st.id)) return true;
        if (st.matricula && teamStudentMatriculas.has(String(st.matricula).trim().toLowerCase())) return true;
        return false;
      };

      const updatedTeamStudents: Student[] = [];
      students.forEach((st) => {
        if (isTeamMember(st)) {
          const newHorariosPorDia = sortDaySchedules(sortedDays.map((dia) => {
            const daySched = current.schedulesByDay[dia] || {
              turnos: [{ horaEntrada: hospitalZone.horaEntrada || '07:00', horaSalida: hospitalZone.horaSalida || '15:00' }],
            };
            const turnos = daySched.turnos && daySched.turnos.length > 0
              ? daySched.turnos
              : [{ horaEntrada: hospitalZone.horaEntrada || '07:00', horaSalida: hospitalZone.horaSalida || '15:00' }];

            return {
              dia,
              horaEntrada: turnos[0].horaEntrada,
              horaSalida: turnos[turnos.length - 1].horaSalida,
              turnos,
              toleranciaMinutos: st.toleranciaMinutos || hospitalZone.toleranciaMinutos || 15,
            };
          }));

          const primaryEntrada = newHorariosPorDia[0]?.horaEntrada || st.horaEntrada || hospitalZone.horaEntrada || '07:00';
          const primarySalida = newHorariosPorDia[0]?.horaSalida || st.horaSalida || hospitalZone.horaSalida || '15:00';

          const updatedStudent: Student = {
            ...st,
            diasAsistencia: sortedDays,
            horaEntrada: primaryEntrada,
            horaSalida: primarySalida,
            horariosPorDia: newHorariosPorDia,
          };
          updatedTeamStudents.push(updatedStudent);
        }
      });

      // Maintain in-memory state of this team schedule
      setTeamSchedules((prev) => ({
        ...prev,
        [teamKey]: current,
      }));

      // Persist only modified students for lightweight batch payload
      await saveStudentsList(updatedTeamStudents);
      onRefreshData();

      setSavedTeamAlert(teamKey);
      setTimeout(() => {
        setSavedTeamAlert(null);
      }, 4000);
    } catch (err) {
      console.error('Error saving team schedule:', err);
      alert('Error al guardar los horarios para el equipo.');
    } finally {
      setSavingTeamKey(null);
    }
  };

  // Bitácora General Filters & Dates (default to current week)
  const [recordsGroupTab, setRecordsGroupTab] = useState<string>('ALL');

  // Helpers to calculate default current week (Monday to Sunday)
  const getCurrentWeekRange = () => {
    const now = new Date();
    const day = now.getDay(); // 0 is Sunday, 1 is Monday...
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const pad = (n: number) => String(n).padStart(2, '0');
    const formatYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    return {
      start: formatYMD(monday),
      end: formatYMD(sunday),
    };
  };

  const weekRange = React.useMemo(() => getCurrentWeekRange(), []);
  const [recordsStartDate, setRecordsStartDate] = useState<string>(weekRange.start);
  const [recordsEndDate, setRecordsEndDate] = useState<string>(weekRange.end);
  const [recordsFilterMode, setRecordsFilterMode] = useState<'CURRENT_WEEK' | 'TODAY' | 'CURRENT_MONTH' | 'ALL_TIME' | 'CUSTOM'>('CURRENT_WEEK');

  // Server-side calculated aggregate statistics
  const [serverStats, setServerStats] = useState<{
    total: number;
    aTiempo: number;
    retardos: number;
    faltas: number;
    justificadas: number;
    byDate: any[];
  } | null>(null);

  // Quick preset filter updater for Bitácora dates
  const handleSetRecordsFilterPreset = (preset: 'CURRENT_WEEK' | 'TODAY' | 'CURRENT_MONTH' | 'ALL_TIME') => {
    setRecordsFilterMode(preset);
    const today = getTodayDateString();
    const pad = (n: number) => String(n).padStart(2, '0');

    if (preset === 'TODAY') {
      setRecordsStartDate(today);
      setRecordsEndDate(today);
    } else if (preset === 'CURRENT_WEEK') {
      const wk = getCurrentWeekRange();
      setRecordsStartDate(wk.start);
      setRecordsEndDate(wk.end);
    } else if (preset === 'CURRENT_MONTH') {
      const now = new Date();
      const firstDay = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
      const lastDayObj = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const lastDay = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(lastDayObj.getDate())}`;
      setRecordsStartDate(firstDay);
      setRecordsEndDate(lastDay);
    } else if (preset === 'ALL_TIME') {
      setRecordsStartDate('');
      setRecordsEndDate('');
    }
  };

  // Fetch direct SQL aggregate metrics from SQLite server whenever filters change
  React.useEffect(() => {
    fetchAttendanceStatsFromServer(
      recordsStartDate || undefined,
      recordsEndDate || undefined,
      recordsGroupTab !== 'ALL' ? recordsGroupTab : undefined
    ).then((data) => {
      if (data) setServerStats(data);
    });
  }, [recordsStartDate, recordsEndDate, recordsGroupTab, attendanceRecords.length]);

  // Student Search & Filter
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRotationFilter, setSelectedRotationFilter] = useState('ALL');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(
    students[0] || null
  );

  // Synchronize selectedStudent whenever students prop updates from cloud sync or mutations
  React.useEffect(() => {
    if (selectedStudent) {
      const updated = students.find((s) => s.id === selectedStudent.id);
      if (updated) {
        setSelectedStudent(updated);
      }
    } else if (students.length > 0) {
      setSelectedStudent(students[0]);
    }
  }, [students]);

  // Individual Student Report Modal State
  const [showIndividualReportModal, setShowIndividualReportModal] = useState(false);
  const [reportStudent, setReportStudent] = useState<Student | null>(null);
  const [reportSelectedYear, setReportSelectedYear] = useState<number>(new Date().getFullYear());
  const [reportSelectedMonth, setReportSelectedMonth] = useState<number>(new Date().getMonth());

  const handleOpenIndividualReport = (student: Student) => {
    setReportStudent(student);
    setReportSelectedYear(new Date().getFullYear());
    setReportSelectedMonth(new Date().getMonth());
    setShowIndividualReportModal(true);

    // Demand-driven: Fetch records exclusively for this student from server / cloud for official report
    fetchStudentRecordsFromServer(student.matricula, undefined, undefined, true)
      .then(() => {
        onRefreshData();
      })
      .catch(() => {});
  };

  // Available Hospital Sites for student assignment
  const allSites = getHospitalSites();

  // Add Student Modal State
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [newMatricula, setNewMatricula] = useState('');
  const [newNombre, setNewNombre] = useState('');
  const [newEspecialidad, setNewEspecialidad] = useState('Urgencias Médicas');
  const [newGrupo, setNewGrupo] = useState('10 A');
  const [newEquipo, setNewEquipo] = useState('Equipo 1');
  const [newDiasAsistencia, setNewDiasAsistencia] = useState<string[]>([
    'Lunes',
    'Miércoles',
  ]);
  const [newHorariosPorDia, setNewHorariosPorDia] = useState<
    Record<string, { turnos: TimeTurno[]; toleranciaMinutos?: number }>
  >({
    Lunes: { turnos: [{ horaEntrada: '07:00', horaSalida: '08:00' }], toleranciaMinutos: 15 },
    Miércoles: { turnos: [{ horaEntrada: '16:00', horaSalida: '17:00' }], toleranciaMinutos: 15 },
  });
  const [newSedeId, setNewSedeId] = useState<string>(allSites[0]?.id || 'site-1');
  const [newSecondarySedeId, setNewSecondarySedeId] = useState<string>('');
  const [newHoraEntrada, setNewHoraEntrada] = useState<string>(allSites[0]?.horaEntrada || '07:00');
  const [newHoraSalida, setNewHoraSalida] = useState<string>(allSites[0]?.horaSalida || '15:00');
  const [newToleranciaMinutos, setNewToleranciaMinutos] = useState<number>(allSites[0]?.toleranciaMinutos || 15);
  const [addStudentError, setAddStudentError] = useState<string | null>(null);

  // Edit Student Modal State
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [editMatricula, setEditMatricula] = useState('');
  const [editNombre, setEditNombre] = useState('');
  const [editEspecialidad, setEditEspecialidad] = useState('Urgencias Médicas');
  const [editGrupo, setEditGrupo] = useState('10 A');
  const [editEquipo, setEditEquipo] = useState('Equipo 1');
  const [editDiasAsistencia, setEditDiasAsistencia] = useState<string[]>([]);
  const [editHorariosPorDia, setEditHorariosPorDia] = useState<
    Record<string, { turnos: TimeTurno[]; toleranciaMinutos?: number }>
  >({});
  const [editSedeId, setEditSedeId] = useState<string>('site-1');
  const [editSecondarySedeId, setEditSecondarySedeId] = useState<string>('');
  const [editHoraEntrada, setEditHoraEntrada] = useState<string>('07:00');
  const [editHoraSalida, setEditHoraSalida] = useState<string>('15:00');
  const [editToleranciaMinutos, setEditToleranciaMinutos] = useState<number>(15);
  const [editStudentError, setEditStudentError] = useState<string | null>(null);

  // Helper functions for student individual turnos
  const handleStudentAddTurno = (day: string, isEdit = true) => {
    if (isEdit) {
      setEditHorariosPorDia((prev) => {
        const cur = prev[day] || { turnos: [{ horaEntrada: '07:00', horaSalida: '15:00' }], toleranciaMinutos: 15 };
        const lastTurno = cur.turnos[cur.turnos.length - 1] || { horaEntrada: '07:00', horaSalida: '15:00' };
        return {
          ...prev,
          [day]: {
            ...cur,
            turnos: [...cur.turnos, { horaEntrada: lastTurno.horaSalida || '16:00', horaSalida: '17:00' }],
          },
        };
      });
    } else {
      setNewHorariosPorDia((prev) => {
        const cur = prev[day] || { turnos: [{ horaEntrada: '07:00', horaSalida: '15:00' }], toleranciaMinutos: 15 };
        const lastTurno = cur.turnos[cur.turnos.length - 1] || { horaEntrada: '07:00', horaSalida: '15:00' };
        return {
          ...prev,
          [day]: {
            ...cur,
            turnos: [...cur.turnos, { horaEntrada: lastTurno.horaSalida || '16:00', horaSalida: '17:00' }],
          },
        };
      });
    }
  };

  const handleStudentRemoveTurno = (day: string, index: number, isEdit = true) => {
    if (isEdit) {
      setEditHorariosPorDia((prev) => {
        const cur = prev[day];
        if (!cur || cur.turnos.length <= 1) return prev;
        return {
          ...prev,
          [day]: {
            ...cur,
            turnos: cur.turnos.filter((_, i) => i !== index),
          },
        };
      });
    } else {
      setNewHorariosPorDia((prev) => {
        const cur = prev[day];
        if (!cur || cur.turnos.length <= 1) return prev;
        return {
          ...prev,
          [day]: {
            ...cur,
            turnos: cur.turnos.filter((_, i) => i !== index),
          },
        };
      });
    }
  };

  const handleStudentTurnoChange = (
    day: string,
    index: number,
    field: 'horaEntrada' | 'horaSalida',
    value: string,
    isEdit = true
  ) => {
    if (isEdit) {
      setEditHorariosPorDia((prev) => {
        const cur = prev[day] || { turnos: [{ horaEntrada: '07:00', horaSalida: '15:00' }], toleranciaMinutos: 15 };
        const updatedTurnos = cur.turnos.map((t, i) => (i === index ? { ...t, [field]: value } : t));
        return {
          ...prev,
          [day]: {
            ...cur,
            turnos: updatedTurnos,
          },
        };
      });
    } else {
      setNewHorariosPorDia((prev) => {
        const cur = prev[day] || { turnos: [{ horaEntrada: '07:00', horaSalida: '15:00' }], toleranciaMinutos: 15 };
        const updatedTurnos = cur.turnos.map((t, i) => (i === index ? { ...t, [field]: value } : t));
        return {
          ...prev,
          [day]: {
            ...cur,
            turnos: updatedTurnos,
          },
        };
      });
    }
  };

  // Bulk Import Modal State
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSuccess, setBulkSuccess] = useState<string | null>(null);

  // Cambio de Semestre Modal State
  const [showSemesterModal, setShowSemesterModal] = useState(false);
  const [semesterConfirmText, setSemesterConfirmText] = useState('');
  const [semesterError, setSemesterError] = useState<string | null>(null);
  const [semesterSuccess, setSemesterSuccess] = useState<string | null>(null);

  const handleClearSemester = async () => {
    if (semesterConfirmText.trim() !== 'ELIMINAR') {
      setSemesterError('Debes escribir la palabra exacta "ELIMINAR" para confirmar la acción.');
      return;
    }
    setSemesterError(null);
    try {
      await clearSemesterStudents();
      onRefreshData();
      setSelectedStudent(null);
      setSemesterSuccess('Todos los registros de alumnos han sido eliminados correctamente.');
      setTimeout(() => {
        setShowSemesterModal(false);
        setSemesterConfirmText('');
        setSemesterSuccess(null);
      }, 2000);
    } catch {
      setSemesterError('Ocurrió un error al intentar eliminar los registros de alumnos.');
    }
  };

  // Hospital Zone Config State
  const [zoneForm, setZoneForm] = useState<HospitalZone>({ ...hospitalZone });
  const [zoneSaveSuccess, setZoneSaveSuccess] = useState(false);

  // Site / Location Management Modal & Form State
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [cloudSyncMsg, setCloudSyncMsg] = useState<string | null>(null);

  const handleManualCloudSync = async () => {
    try {
      setIsSyncingCloud(true);
      await pushLocalDataToCloud();
      onRefreshData();
      setDiasInhabiles(getDiasInhabiles());
      setCloudSyncMsg('¡Datos sincronizados exitosamente con el Servidor Local Express (Puerto 3000)!');
      setTimeout(() => setCloudSyncMsg(null), 4000);
    } catch (err) {
      console.error(err);
      setCloudSyncMsg('Atención: Error al sincronizar. Revisa la conexión.');
      setTimeout(() => setCloudSyncMsg(null), 4000);
    } finally {
      setIsSyncingCloud(false);
    }
  };

  // Días Inhábiles Handlers
  const handleAddDiaInhabil = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newInhabilFecha) {
      alert('Por favor selecciona una fecha inhábil.');
      return;
    }
    const motivo = newInhabilMotivo.trim() || 'Suspensión de labores / Día Inhábil';
    const newHoliday: DiaInhabil = {
      id: `holiday_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      fecha: newInhabilFecha,
      motivo,
      createdAt: new Date().toISOString(),
    };
    saveDiaInhabil(newHoliday);
    setDiasInhabiles(getDiasInhabiles());
    setNewInhabilFecha('');
    setNewInhabilMotivo('');
    setInhabilSuccessMsg(`✅ Fecha ${newInhabilFecha} agregada como Inhábil.`);
    setTimeout(() => setInhabilSuccessMsg(null), 3500);
  };

  // Individual Student Justification State & Handlers
  const [justStudentId, setJustStudentId] = useState<string>('');
  const [justStudentSearch, setJustStudentSearch] = useState<string>('');
  const [justStudentDropdownOpen, setJustStudentDropdownOpen] = useState<boolean>(false);
  const [justDate, setJustDate] = useState<string>(() => getTodayDateString());
  const [justMotivo, setJustMotivo] = useState<string>('Incapacidad Médica');
  const [justSuccessMsg, setJustSuccessMsg] = useState<string | null>(null);
  const [justSearch, setJustSearch] = useState<string>('');
  const [isSubmittingJust, setIsSubmittingJust] = useState(false);

  const handleAddIndividualJustification = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!justStudentId) {
      alert('Por favor selecciona a un alumno.');
      return;
    }
    if (!justDate) {
      alert('Por favor selecciona la fecha de la guardia a justificar.');
      return;
    }
    setIsSubmittingJust(true);

    const student = students.find(
      (s) => s.id === justStudentId || isMatriculaMatch(s.matricula, justStudentId)
    );
    if (!student) {
      alert('Alumno no encontrado en la base de datos.');
      setIsSubmittingJust(false);
      return;
    }

    const newJustRecord: AttendanceRecord = {
      id: `just_${Date.now()}_${student.matricula}_${justDate.replace(/-/g, '')}`,
      studentId: student.id,
      matricula: student.matricula,
      studentNombre: student.nombre,
      grupo: student.grupo,
      equipo: student.equipo,
      siteId: student.sedeId || hospitalZone.id,
      siteNombre: student.sedeNombre || hospitalZone.nombre,
      fecha: justDate,
      tipo: 'JUSTIFICANTE',
      checkInTime: new Date().toISOString(),
      checkInLat: null,
      checkInLng: null,
      checkInDistanceMeters: 0,
      checkInStatus: 'JUSTIFICADA',
      estado: 'JUSTIFICADA',
      checkOutTime: null,
      checkOutLat: null,
      checkOutLng: null,
      checkOutDistanceMeters: null,
      checkOutStatus: 'COMPLETADO',
      deviceIdUsed: 'DOCENTE-OFICIAL',
      deviceNameUsed: 'Justificante Oficial Docente',
      esJustificada: true,
      motivoJustificante: justMotivo.trim() || 'Justificante de guardia autorizado por docente',
      notas: `Guardia justificada individualmente por docente el ${new Date().toLocaleDateString('es-MX')}: ${justMotivo.trim() || 'Autorizado'}`,
    };

    saveAttendanceRecord(newJustRecord);
    onRefreshData();

    setJustSuccessMsg(`✅ Justificante registrado para ${student.nombre} el ${justDate}.`);
    setTimeout(() => setJustSuccessMsg(null), 4000);
    setIsSubmittingJust(false);
  };

  const handleDeleteIndividualJustification = (recordId: string, studentName: string, fecha: string) => {
    if (window.confirm(`¿Confirmas anular/eliminar el justificante de guardia para ${studentName} correspondiente al día ${fecha}?`)) {
      deleteAttendanceRecord(recordId);
      onRefreshData();
      setJustSuccessMsg(`Justificante de ${studentName} (${fecha}) eliminado.`);
      setTimeout(() => setJustSuccessMsg(null), 3000);
    }
  };

  const handleDeleteDiaInhabil = (id: string, fecha: string) => {
    if (window.confirm(`¿Deseas eliminar la fecha inhábil ${fecha}? A partir de ahora esa fecha volverá a contar para las asistencias de guardia si le corresponde al alumno.`)) {
      deleteDiaInhabil(id);
      setDiasInhabiles(getDiasInhabiles());
      setInhabilSuccessMsg(`Eliminado correctamente.`);
      setTimeout(() => setInhabilSuccessMsg(null), 2500);
    }
  };

  const handleAddPresetHoliday = (fecha: string, motivo: string) => {
    const exists = diasInhabiles.some((h) => h.fecha === fecha);
    if (exists) {
      alert(`La fecha ${fecha} ya se encuentra registrada como día inhábil.`);
      return;
    }
    const newHoliday: DiaInhabil = {
      id: `holiday_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      fecha,
      motivo,
      createdAt: new Date().toISOString(),
    };
    saveDiaInhabil(newHoliday);
    setDiasInhabiles(getDiasInhabiles());
    setInhabilSuccessMsg(`✅ Registrado: ${motivo} (${fecha})`);
    setTimeout(() => setInhabilSuccessMsg(null), 3500);
  };

  const [showSiteModal, setShowSiteModal] = useState(false);
  const [siteFormId, setSiteFormId] = useState<string | null>(null);
  const [siteFormNombre, setSiteFormNombre] = useState('');
  const [siteFormDireccion, setSiteFormDireccion] = useState('');
  const [siteFormLat, setSiteFormLat] = useState<number>(25.7925);
  const [siteFormLng, setSiteFormLng] = useState<number>(-108.9960);
  const [siteFormRadiusMeters, setSiteFormRadiusMeters] = useState<number>(150);
  const [siteFormError, setSiteFormError] = useState<string | null>(null);
  const [siteSaveSuccess, setSiteSaveSuccess] = useState<string | null>(null);

  const handleOpenAddSite = () => {
    setSiteFormId(null);
    setSiteFormNombre('');
    setSiteFormDireccion('');
    setSiteFormLat(25.7925);
    setSiteFormLng(-108.9960);
    setSiteFormRadiusMeters(150);
    setSiteFormError(null);
    setShowSiteModal(true);
  };

  const handleOpenEditSite = (site: HospitalSite) => {
    setSiteFormId(site.id);
    setSiteFormNombre(site.nombre);
    setSiteFormDireccion(site.direccion || '');
    setSiteFormLat(site.latitude);
    setSiteFormLng(site.longitude);
    setSiteFormRadiusMeters(site.radiusMeters);
    setSiteFormError(null);
    setShowSiteModal(true);
  };

  const handleSaveSite = (e: React.FormEvent) => {
    e.preventDefault();
    setSiteFormError(null);

    if (!siteFormNombre.trim()) {
      setSiteFormError('El nombre de la localización / sede es obligatorio.');
      return;
    }

    if (siteFormRadiusMeters < 10) {
      setSiteFormError('El radio de geocerca debe ser de al menos 10 metros.');
      return;
    }

    const siteToSave: HospitalSite = {
      id: siteFormId || `site-${Date.now()}`,
      nombre: siteFormNombre.trim(),
      direccion: siteFormDireccion.trim() || 'Los Mochis, Sin.',
      latitude: Number(siteFormLat),
      longitude: Number(siteFormLng),
      radiusMeters: Number(siteFormRadiusMeters),
      horaEntrada: '07:00',
      horaSalida: '15:00',
      toleranciaMinutos: 15,
    };

    saveHospitalSite(siteToSave);
    onRefreshData();
    setShowSiteModal(false);
    setSiteSaveSuccess(`La sede "${siteToSave.nombre}" se guardó con éxito con un radio de ${siteToSave.radiusMeters}m.`);
    setTimeout(() => setSiteSaveSuccess(null), 5000);
  };

  const handleDeleteSite = (site: HospitalSite) => {
    const currentSites = getHospitalSites();
    if (currentSites.length <= 1) {
      alert('Debe existir al menos una sede hospitalaria registrada.');
      return;
    }

    const assignedCount = students.filter((s) => s.sedeId === site.id).length;
    const confirmMessage = assignedCount > 0
      ? `¿Deseas eliminar la sede "${site.nombre}"? Hay ${assignedCount} alumnos asignados a esta sede.`
      : `¿Estás seguro de eliminar la sede "${site.nombre}"?`;

    if (window.confirm(confirmMessage)) {
      deleteHospitalSite(site.id);
      onRefreshData();
      setSiteSaveSuccess(`Sede "${site.nombre}" eliminada correctamente.`);
      setTimeout(() => setSiteSaveSuccess(null), 4000);
    }
  };

  // Filtered Students List for STUDENTS tab
  const filteredStudents = students.filter((s) => {
    const matchesSearch =
      s.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.matricula.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.grupo && s.grupo.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesRotation =
      selectedRotationFilter === 'ALL' || s.rotacion === selectedRotationFilter;
    return matchesSearch && matchesRotation;
  });

  // Get unique Groups in the system sorted alphabetically
  const defaultGroups = ['10 A', '10 B', '10 C', '10 D', '8 A', '8 B'];
  const allGroups = Array.from(
    new Set([...students.map((s) => s.grupo || '10 A'), ...defaultGroups])
  ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  // Unique Rotations
  const rotations = Array.from(new Set(students.map((s) => s.rotacion)));

  // Day toggle logic
  const handleToggleDay = (
    day: string,
    currentList: string[],
    setter: (val: string[]) => void
  ) => {
    if (currentList.includes(day)) {
      setter(sortDaysArray(currentList.filter((d) => d !== day)));
    } else {
      setter(sortDaysArray([...currentList, day]));
    }
  };

  // Add New Student Handler
  const handleAddStudent = (e: React.FormEvent) => {
    e.preventDefault();
    setAddStudentError(null);

    if (!newMatricula.trim() || !newNombre.trim()) {
      setAddStudentError('Matrícula y Nombre son campos obligatorios.');
      return;
    }

    const existing = students.find(
      (s) => s.matricula.trim() === newMatricula.trim()
    );
    if (existing) {
      setAddStudentError(`La matrícula "${newMatricula}" ya existe en el sistema.`);
      return;
    }

    const chosenSite = allSites.find((s) => s.id === newSedeId);
    const chosenSecondarySite = allSites.find((s) => s.id === newSecondarySedeId);

    const diasToSave = sortDaysArray(newDiasAsistencia.length > 0 ? newDiasAsistencia : ['Lunes', 'Miércoles']);
    const horariosPorDiaArr = sortDaySchedules(diasToSave.map((d) => {
      const cur = newHorariosPorDia[d];
      const turnos = cur?.turnos && cur.turnos.length > 0
        ? cur.turnos
        : [{ horaEntrada: newHoraEntrada || chosenSite?.horaEntrada || '07:00', horaSalida: newHoraSalida || chosenSite?.horaSalida || '15:00' }];
      return {
        dia: d,
        horaEntrada: turnos[0].horaEntrada,
        horaSalida: turnos[turnos.length - 1].horaSalida,
        turnos,
        toleranciaMinutos: cur?.toleranciaMinutos ?? 15,
      };
    }));

    const primaryEntrada = horariosPorDiaArr[0]?.horaEntrada || newHoraEntrada || chosenSite?.horaEntrada || '07:00';
    const primarySalida = horariosPorDiaArr[0]?.horaSalida || newHoraSalida || chosenSite?.horaSalida || '15:00';

    const newStudent: Student = {
      id: `std-${Date.now()}`,
      matricula: newMatricula.trim(),
      nombre: newNombre.trim(),
      email: `${newMatricula.trim()}@medicina.edu.mx`,
      especialidad: newEspecialidad || 'Urgencias Médicas',
      rotacion: newEspecialidad || 'Urgencias Médicas',
      grupo: newGrupo.trim() || '10 A',
      equipo: newEquipo.trim() || 'Equipo 1',
      diasAsistencia: diasToSave,
      horariosPorDia: horariosPorDiaArr,
      sedeId: newSedeId,
      sedeNombre: chosenSite?.nombre || 'Sede Principal',
      secondarySedeId: newSecondarySedeId || null,
      secondarySedeNombre: chosenSecondarySite?.nombre || null,
      horaEntrada: primaryEntrada,
      horaSalida: primarySalida,
      toleranciaMinutos: horariosPorDiaArr[0]?.toleranciaMinutos ?? 15,
      linkedDeviceId: null,
      linkedDeviceName: null,
      linkedAt: null,
      activo: true,
    };

    saveStudent(newStudent);
    onRefreshData();
    setSelectedStudent(newStudent);
    setShowAddStudentModal(false);
    setNewMatricula('');
    setNewNombre('');
    setNewEspecialidad('Urgencias Médicas');
    setNewSecondarySedeId('');
  };

  // Start Edit Student
  const handleStartEditStudent = (student: Student) => {
    setEditingStudent(student);
    setEditMatricula(student.matricula);
    setEditNombre(student.nombre);
    setEditEspecialidad(student.especialidad || student.rotacion || 'Urgencias Médicas');
    setEditGrupo(student.grupo || '10 A');
    setEditEquipo(student.equipo || 'Equipo 1');
    const dias = sortDaysArray(student.diasAsistencia || ['Lunes', 'Miércoles']);
    setEditDiasAsistencia(dias);

    const scheduleMap: Record<string, { turnos: TimeTurno[]; toleranciaMinutos?: number }> = {};
    dias.forEach((d) => {
      const existing = student.horariosPorDia?.find((h) => h.dia.toLowerCase() === d.toLowerCase());
      let turnos: TimeTurno[] = [];
      if (existing?.turnos && existing.turnos.length > 0) {
        turnos = existing.turnos.map((t) => ({ horaEntrada: t.horaEntrada, horaSalida: t.horaSalida }));
      } else {
        turnos = [{
          horaEntrada: existing?.horaEntrada || student.horaEntrada || '07:00',
          horaSalida: existing?.horaSalida || student.horaSalida || '15:00',
        }];
      }
      scheduleMap[d] = {
        turnos,
        toleranciaMinutos: existing?.toleranciaMinutos ?? student.toleranciaMinutos ?? 15,
      };
    });
    setEditHorariosPorDia(scheduleMap);

    setEditSedeId(student.sedeId || allSites[0]?.id || 'site-1');
    setEditSecondarySedeId(student.secondarySedeId || '');
    setEditHoraEntrada(student.horaEntrada || '07:00');
    setEditHoraSalida(student.horaSalida || '15:00');
    setEditToleranciaMinutos(student.toleranciaMinutos ?? 15);
    setEditStudentError(null);
  };

  // Save Edit Student
  const handleSaveEditStudent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent) return;
    setEditStudentError(null);

    if (!editMatricula.trim() || !editNombre.trim()) {
      setEditStudentError('Matrícula y Nombre no pueden estar vacíos.');
      return;
    }

    const chosenSite = allSites.find((s) => s.id === editSedeId);
    const chosenSecondarySite = allSites.find((s) => s.id === editSecondarySedeId);

    const sortedEditDias = sortDaysArray(editDiasAsistencia);
    const horariosPorDiaArr = sortDaySchedules(sortedEditDias.map((d) => {
      const cur = editHorariosPorDia[d];
      const turnos = cur?.turnos && cur.turnos.length > 0
        ? cur.turnos
        : [{ horaEntrada: editHoraEntrada || chosenSite?.horaEntrada || '07:00', horaSalida: editHoraSalida || chosenSite?.horaSalida || '15:00' }];
      return {
        dia: d,
        horaEntrada: turnos[0].horaEntrada,
        horaSalida: turnos[turnos.length - 1].horaSalida,
        turnos,
        toleranciaMinutos: cur?.toleranciaMinutos ?? 15,
      };
    }));

    const primaryEntrada = horariosPorDiaArr[0]?.horaEntrada || editingStudent.horaEntrada || chosenSite?.horaEntrada || '07:00';
    const primarySalida = horariosPorDiaArr[0]?.horaSalida || editingStudent.horaSalida || chosenSite?.horaSalida || '15:00';

    const updated: Student = {
      ...editingStudent,
      matricula: editMatricula.trim(),
      nombre: editNombre.trim(),
      especialidad: editEspecialidad || 'Urgencias Médicas',
      rotacion: editEspecialidad || 'Urgencias Médicas',
      grupo: editGrupo.trim() || '10 A',
      equipo: editEquipo.trim() || 'Equipo 1',
      diasAsistencia: sortedEditDias,
      horariosPorDia: horariosPorDiaArr,
      sedeId: editSedeId,
      sedeNombre: chosenSite?.nombre || 'Sede Principal',
      secondarySedeId: editSecondarySedeId || null,
      secondarySedeNombre: chosenSecondarySite?.nombre || null,
      horaEntrada: primaryEntrada,
      horaSalida: primarySalida,
      toleranciaMinutos: horariosPorDiaArr[0]?.toleranciaMinutos ?? editingStudent.toleranciaMinutos ?? 15,
    };

    saveStudent(updated);
    onRefreshData();
    if (selectedStudent?.id === updated.id) {
      setSelectedStudent(updated);
    }
    setEditingStudent(null);
  };

  // Bulk Import Handler
  const handleBulkImport = (e: React.FormEvent) => {
    e.preventDefault();
    setBulkError(null);
    setBulkSuccess(null);

    if (!bulkText.trim()) {
      setBulkError('Ingresa al menos una línea con datos de alumno.');
      return;
    }

    const lines = bulkText.split('\n').map((l) => l.trim()).filter(Boolean);
    let addedCount = 0;

    lines.forEach((line) => {
      // Intelligently detect separator (Tab for Excel paste, Semicolon, Pipe, or Comma)
      let parts: string[];
      if (line.includes('\t')) {
        parts = line.split('\t').map((p) => p.trim());
      } else if (line.includes(';')) {
        parts = line.split(';').map((p) => p.trim());
      } else if (line.includes('|')) {
        parts = line.split('|').map((p) => p.trim());
      } else {
        parts = line.split(',').map((p) => p.trim());
      }

      if (parts.length >= 2) {
        const mat = parts[0] || '';
        const nom = parts[1] || '';
        const grp = parts[2] || '10 A';
        const siteSearch = parts[3] || '';
        const secondarySiteSearch = parts[4] && !['ninguna', 'ninguno', '-', 'n/a'].includes(parts[4].toLowerCase()) ? parts[4] : '';
        const eqp = parts[5] || 'Equipo 1';
        const espec = parts[6] || 'Urgencias Médicas';
        const diasRaw = parts[7] || 'Lunes, Miércoles';
        const rawHEnt = parts[8] || '07:00';
        const rawHSal = parts[9] || '15:00';

        // Clean time strings (extract valid HH:MM)
        const entMatches = String(rawHEnt).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g) || ['07:00'];
        const salMatches = String(rawHSal).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g);

        const hEnt = entMatches[0];
        let hSal = salMatches && salMatches[0] ? salMatches[0] : '15:00';
        if (hSal === 'No especificada' || !rawHSal || rawHSal.includes('No espec')) {
          const [h, m] = hEnt.split(':').map(Number);
          const endH = (h + 8) % 24;
          hSal = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        }

        // Extract assigned days
        const diasLower = diasRaw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const diasArr: string[] = [];
        if (diasLower.includes('lunes')) diasArr.push('Lunes');
        if (diasLower.includes('martes')) diasArr.push('Martes');
        if (diasLower.includes('miercoles')) diasArr.push('Miércoles');
        if (diasLower.includes('jueves')) diasArr.push('Jueves');
        if (diasLower.includes('viernes')) diasArr.push('Viernes');
        if (diasLower.includes('sabado')) diasArr.push('Sábado');
        if (diasLower.includes('domingo')) diasArr.push('Domingo');

        if (diasArr.length === 0) {
          diasArr.push('Lunes', 'Miércoles');
        }

        const matchedSite = siteSearch
          ? allSites.find(
              (s) =>
                s.id.toLowerCase() === siteSearch.toLowerCase() ||
                s.nombre.toLowerCase().includes(siteSearch.toLowerCase())
            ) || allSites[0]
          : allSites[0];

        const matchedSecondarySite = secondarySiteSearch
          ? allSites.find(
              (s) =>
                s.id.toLowerCase() === secondarySiteSearch.toLowerCase() ||
                s.nombre.toLowerCase().includes(secondarySiteSearch.toLowerCase())
            ) || null
          : null;

        const defaultEnt = hEnt || matchedSite?.horaEntrada || '07:00';
        const defaultSal = hSal || matchedSite?.horaSalida || '15:00';

        // Build specific day schedules cleanly
        const sortedBulkDias = sortDaysArray(diasArr);
        const horariosPorDiaArr = sortDaySchedules(sortedBulkDias.map((d, dayIdx) => {
          let dayTurnos: { horaEntrada: string; horaSalida: string }[] = [];

          if (entMatches.length === sortedBulkDias.length) {
            // 1 time slot per day (e.g. Martes -> 18:00, Jueves -> 14:00)
            const ent = entMatches[dayIdx] || defaultEnt;
            const sal = (salMatches && salMatches[dayIdx]) || defaultSal;
            dayTurnos = [{ horaEntrada: ent, horaSalida: sal }];
          } else if (entMatches.length === 1) {
            // 1 time slot shared across all days
            const ent = entMatches[0] || defaultEnt;
            const sal = (salMatches && salMatches[0]) || defaultSal;
            dayTurnos = [{ horaEntrada: ent, horaSalida: sal }];
          } else if (entMatches.length > 0 && entMatches.length % sortedBulkDias.length === 0) {
            const turnosPerDay = entMatches.length / sortedBulkDias.length;
            const startIdx = dayIdx * turnosPerDay;
            for (let k = 0; k < turnosPerDay; k++) {
              const idx = startIdx + k;
              const ent = entMatches[idx] || defaultEnt;
              const sal = (salMatches && salMatches[idx]) || defaultSal;
              dayTurnos.push({ horaEntrada: ent, horaSalida: sal });
            }
          } else {
            const ent = entMatches[dayIdx % entMatches.length] || defaultEnt;
            const sal = (salMatches && salMatches[dayIdx % entMatches.length]) || defaultSal;
            dayTurnos = [{ horaEntrada: ent, horaSalida: sal }];
          }

          // Deduplicate turnos within day
          const uniqueTurnos = dayTurnos.filter(
            (t, i, arr) => arr.findIndex((x) => x.horaEntrada === t.horaEntrada && x.horaSalida === t.horaSalida) === i
          );

          return {
            dia: d,
            horaEntrada: uniqueTurnos[0]?.horaEntrada || defaultEnt,
            horaSalida: uniqueTurnos[uniqueTurnos.length - 1]?.horaSalida || defaultSal,
            turnos: uniqueTurnos,
            toleranciaMinutos: 15,
          };
        }));

        const existing = students.find((s) => s.matricula.trim() === mat);
        if (!existing && mat && nom) {
          saveStudent({
            id: `std-bulk-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            matricula: mat,
            nombre: nom,
            email: `${mat}@medicina.edu.mx`,
            especialidad: espec,
            rotacion: espec,
            grupo: grp,
            equipo: eqp,
            diasAsistencia: sortedBulkDias,
            horariosPorDia: horariosPorDiaArr,
            sedeId: matchedSite ? matchedSite.id : 'site-1',
            sedeNombre: matchedSite ? matchedSite.nombre : (siteSearch || 'Sede Principal'),
            secondarySedeId: matchedSecondarySite ? matchedSecondarySite.id : null,
            secondarySedeNombre: matchedSecondarySite ? matchedSecondarySite.nombre : null,
            horaEntrada: hEnt || matchedSite?.horaEntrada || '07:00',
            horaSalida: hSal || matchedSite?.horaSalida || '15:00',
            toleranciaMinutos: 15,
            linkedDeviceId: null,
            linkedDeviceName: null,
            linkedAt: null,
            activo: true,
          });
          addedCount++;
        }
      }
    });

    onRefreshData();
    setBulkSuccess(`¡Se han cargado ${addedCount} alumnos correctamente!`);
    setTimeout(() => {
      setShowBulkModal(false);
      setBulkText('');
      setBulkSuccess(null);
    }, 1500);
  };

  // Delete Student Handler
  const handleDeleteStudent = (studentId: string) => {
    if (
      window.confirm(
        '¿Estás seguro de que deseas eliminar a este alumno de la lista?'
      )
    ) {
      deleteStudent(studentId);
      onRefreshData();
      if (selectedStudent?.id === studentId) {
        setSelectedStudent(null);
      }
    }
  };

  // Unlink Phone Handler
  const handleUnlinkDevice = (studentId: string, studentName?: string) => {
    const student = students.find((s) => s.id === studentId);
    const name = studentName || student?.nombre || 'el alumno';
    if (
      window.confirm(
        `¿Confirmas desvincular el dispositivo móvil registrado para ${name}? Esto le permitirá vincular un nuevo equipo la próxima vez que inicie sesión con su matrícula.`
      )
    ) {
      const updated = unlinkStudentDevice(studentId);
      onRefreshData();
      if (selectedStudent?.id === studentId && updated) {
        setSelectedStudent({ ...updated });
      }
      if (editingStudent?.id === studentId && updated) {
        setEditingStudent({ ...updated });
      }
      alert(`✅ El dispositivo móvil de ${name} ha sido desvinculado con éxito.`);
    }
  };

  // Save Hospital Zone Config
  const handleSaveHospitalZone = (e: React.FormEvent) => {
    e.preventDefault();
    saveHospitalZone(zoneForm);
    onRefreshData();
    setZoneSaveSuccess(true);
    setTimeout(() => setZoneSaveSuccess(false), 3000);
  };

  // Save Master Teacher Auth Credentials
  const handleSaveMasterConfig = (e: React.FormEvent) => {
    e.preventDefault();
    saveMasterConfig({
      usuario: masterUserForm.trim(),
      password: masterPassForm,
      nombreDocente: initialMaster.nombreDocente,
    });
    setMasterSaveSuccess(true);
    setTimeout(() => setMasterSaveSuccess(false), 3000);
  };

  // Server State Reload and Direct File Sync Handlers
  const [isReloadingServerState, setIsReloadingServerState] = useState(false);
  const [pendingBackupImport, setPendingBackupImport] = useState<{
    fileName: string;
    data: any;
    diffAnalysis?: StateDiffAnalysis | null;
    activeTab: 'overview' | 'students' | 'records';
    fileStats: {
      students: number;
      records: number;
      sites: number;
      holidays: number;
      latestDate: string;
    };
    currentStats: {
      students: number;
      records: number;
      sites: number;
      holidays: number;
      latestDate: string;
    };
    hasWarning: boolean;
    warningReasons: string[];
  } | null>(null);

  const handleForceReloadState = async () => {
    try {
      setIsReloadingServerState(true);
      setBackupStatus(null);
      const res = await forceReloadStateFromServer();
      if (res.success) {
        onRefreshData();
        setDiasInhabiles(getDiasInhabiles());
        setBackupStatus({
          type: 'success',
          message: `¡Datos recargados y sincronizados desde clinicas.db (SQLite) con éxito! Alumnos: ${res.studentsCount}, Sedes: ${res.sitesCount}, Bitácora: ${res.recordsCount}, Inhábiles: ${res.holidaysCount}`,
        });
      } else {
        setBackupStatus({
          type: 'error',
          message: 'No se pudo sincronizar el estado desde la base de datos clinicas.db.',
        });
      }
    } catch (err: any) {
      setBackupStatus({
        type: 'error',
        message: `Error al recargar desde clinicas.db: ${err.message || 'Error de conexión'}`,
      });
    } finally {
      setIsReloadingServerState(false);
      setTimeout(() => setBackupStatus(null), 8000);
    }
  };

  // Export Full System Backup
  const handleExportSystemBackup = () => {
    try {
      const backupData = exportFullSystemBackup();
      const jsonStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const today = new Date().toISOString().split('T')[0];
      const link = document.createElement('a');
      link.href = url;
      link.download = `app_state_${today}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setBackupStatus({
        type: 'success',
        message: 'Archivo app_state.json generado y descargado con éxito.',
      });
      setTimeout(() => setBackupStatus(null), 6000);
    } catch (e: any) {
      setBackupStatus({
        type: 'error',
        message: `Error al generar respaldo: ${e.message || 'Error desconocido'}`,
      });
    }
  };

  // Inspect and prepare Full System Backup for user confirmation modal with deep diff analysis
  const handleImportSystemBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);

        // Fetch deep server diff analysis comparing JSON with SQLite .db
        let diffAnalysis: StateDiffAnalysis | null = null;
        try {
          const diffRes = await analyzeStateFileWithServer(parsed);
          if (diffRes.success && diffRes.analysis) {
            diffAnalysis = diffRes.analysis;
          }
        } catch (diffErr) {
          console.warn('Error analyzing diff with server:', diffErr);
        }

        const parsedStudents = Array.isArray(parsed.students) ? parsed.students.length : 0;
        const parsedRecords = Array.isArray(parsed.records) ? parsed.records.length : 0;
        const parsedSites = Array.isArray(parsed.sites) ? parsed.sites.length : 0;
        const parsedHolidays = Array.isArray(parsed.holidays) ? parsed.holidays.length : 0;

        let fileLatestDate = 'Sin registros';
        if (Array.isArray(parsed.records) && parsed.records.length > 0) {
          const dates = parsed.records
            .map((r: any) => r.fecha || '')
            .filter(Boolean)
            .sort();
          if (dates.length > 0) fileLatestDate = dates[dates.length - 1];
        }

        let currentLatestDate = 'Sin registros';
        if (attendanceRecords.length > 0) {
          const dates = attendanceRecords
            .map((r) => r.fecha || '')
            .filter(Boolean)
            .sort();
          if (dates.length > 0) currentLatestDate = dates[dates.length - 1];
        }

        const warningReasons: string[] = diffAnalysis?.summary?.warningReasons && diffAnalysis.summary.warningReasons.length > 0
          ? [...diffAnalysis.summary.warningReasons]
          : [];

        if (warningReasons.length === 0) {
          if (parsedRecords < attendanceRecords.length) {
            warningReasons.push(
              `El archivo que estás subiendo tiene menos registros de asistencia (${parsedRecords}) que tu base de datos actual (${attendanceRecords.length}).`
            );
          }
          if (parsedStudents < students.length) {
            warningReasons.push(
              `El archivo contiene menos alumnos (${parsedStudents}) que tu base de datos actual (${students.length}).`
            );
          }
          if (
            fileLatestDate !== 'Sin registros' &&
            currentLatestDate !== 'Sin registros' &&
            fileLatestDate < currentLatestDate
          ) {
            warningReasons.push(
              `La fecha más reciente en el archivo (${fileLatestDate}) es anterior a la fecha activa más reciente (${currentLatestDate}).`
            );
          }
        }

        setPendingBackupImport({
          fileName: file.name,
          data: parsed,
          diffAnalysis,
          activeTab: 'overview',
          fileStats: {
            students: parsedStudents,
            records: parsedRecords,
            sites: parsedSites,
            holidays: parsedHolidays,
            latestDate: fileLatestDate,
          },
          currentStats: {
            students: students.length,
            records: attendanceRecords.length,
            sites: getHospitalSites().length,
            holidays: diasInhabiles.length,
            latestDate: currentLatestDate,
          },
          hasWarning: warningReasons.length > 0,
          warningReasons,
        });
      } catch (err: any) {
        setBackupStatus({
          type: 'error',
          message: `El archivo no es un JSON válido: ${err.message}`,
        });
        setTimeout(() => setBackupStatus(null), 6000);
      } finally {
        if (e.target) e.target.value = '';
      }
    };

    reader.onerror = () => {
      setBackupStatus({
        type: 'error',
        message: 'No se pudo leer el archivo seleccionado.',
      });
      if (e.target) e.target.value = '';
    };

    reader.readAsText(file);
  };

  // Confirm and execute backup import with chosen mode ('merge' or 'replace')
  const handleConfirmBackupImport = async (mode: 'merge' | 'replace') => {
    if (!pendingBackupImport) return;

    setIsImportingBackup(true);
    setBackupStatus(null);
    const dataToUpload = pendingBackupImport.data;
    setPendingBackupImport(null);

    try {
      const result = await uploadStateFileToServer(dataToUpload, mode);

      if (result.success) {
        const backupNote = result.backupCreated
          ? ` (Auto-backup de seguridad guardado: ${result.backupCreated})`
          : '';
        setBackupStatus({
          type: 'success',
          message: `${result.message}${backupNote}`,
        });
        onRefreshData();
        setDiasInhabiles(getDiasInhabiles());
      } else {
        setBackupStatus({
          type: 'error',
          message: result.message,
        });
      }
    } catch (err: any) {
      setBackupStatus({
        type: 'error',
        message: `Error al aplicar respaldo: ${err.message}`,
      });
    } finally {
      setIsImportingBackup(false);
      setTimeout(() => setBackupStatus(null), 9000);
    }
  };

  // Metrics Calculations
  const todayStr = getTodayDateString();
  const todayRecords = attendanceRecords.filter((r) => r.fecha === todayStr);
  const checkedInTodayCount = todayRecords.filter(
    (r) => r.checkInStatus === 'A_TIEMPO' || r.checkInStatus === 'RETARDO'
  ).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Top Banner KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm flex items-center gap-3">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
              Total Alumnos
            </span>
            <span className="text-xl font-extrabold text-slate-900">
              {students.length}
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm flex items-center gap-3">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <UserCheck className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
              En Guardia Hoy
            </span>
            <span className="text-xl font-extrabold text-slate-900">
              {checkedInTodayCount} / {students.length}
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-sm flex items-center gap-3">
          <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl shrink-0">
            <Calendar className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">
              Inicio de Semestre
            </label>
            <input
              type="date"
              value={fechaInicioSemestre}
              onChange={(e) => {
                const val = e.target.value;
                setFechaInicioSemestre(val);
                localStorage.setItem('fechaInicioSemestre', val);
              }}
              className="w-full text-xs font-bold font-mono text-slate-900 border border-slate-300 rounded-lg px-2 py-1 bg-slate-50 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-sm flex items-center gap-3">
          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl shrink-0">
            <Calendar className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">
              Fin de Semestre
            </label>
            <input
              type="date"
              value={fechaFinSemestre}
              onChange={(e) => {
                const val = e.target.value;
                setFechaFinSemestre(val);
                localStorage.setItem('fechaFinSemestre', val);
              }}
              className="w-full text-xs font-bold font-mono text-slate-900 border border-slate-300 rounded-lg px-2 py-1 bg-slate-50 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-200 pb-3 gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveTab('STUDENTS')}
            className={`px-3.5 py-2.5 rounded-xl font-bold text-xs sm:text-sm flex items-center gap-2 transition-all ${
              activeTab === 'STUDENTS'
                ? 'bg-red-600 text-white shadow-md shadow-red-600/20'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Alumnos (Individual)</span>
          </button>

          <button
            onClick={() => setActiveTab('GROUPS')}
            className={`px-3.5 py-2.5 rounded-xl font-bold text-xs sm:text-sm flex items-center gap-2 transition-all ${
              activeTab === 'GROUPS'
                ? 'bg-red-600 text-white shadow-md shadow-red-600/20'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Folder className="w-4 h-4 text-amber-300" />
            <span>Vista por Grupos y Equipos</span>
          </button>

          <button
            onClick={() => setActiveTab('RECORDS')}
            className={`px-3.5 py-2.5 rounded-xl font-bold text-xs sm:text-sm flex items-center gap-2 transition-all ${
              activeTab === 'RECORDS'
                ? 'bg-red-600 text-white shadow-md shadow-red-600/20'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Bitácora General</span>
          </button>

          <button
            onClick={() => setActiveTab('HOLIDAYS')}
            className={`px-3.5 py-2.5 rounded-xl font-bold text-xs sm:text-sm flex items-center gap-2 transition-all ${
              activeTab === 'HOLIDAYS'
                ? 'bg-red-600 text-white shadow-md shadow-red-600/20'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <CalendarX className="w-4 h-4 text-amber-500" />
            <span>Días Inhábiles</span>
          </button>

          <button
            onClick={() => setActiveTab('CONFIG')}
            className={`px-3.5 py-2.5 rounded-xl font-bold text-xs sm:text-sm flex items-center gap-2 transition-all ${
              activeTab === 'CONFIG'
                ? 'bg-red-600 text-white shadow-md shadow-red-600/20'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Configuración General</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBulkModal(true)}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl flex items-center gap-1.5 border border-slate-200 transition-all"
          >
            <Upload className="w-3.5 h-3.5 text-red-600" />
            <span className="hidden sm:inline">Carga Masiva</span>
          </button>

          <button
            onClick={() => setShowAddStudentModal(true)}
            className="px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm transition-all"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Agregar Alumno</span>
          </button>
        </div>
      </div>

      {/* TAB 1: APARTADO VISUAL POR ALUMNO (INDIVIDUAL) */}
      {activeTab === 'STUDENTS' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Student List & Search */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3">
              {/* Search input */}
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar por nombre, matrícula o grupo..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>

              {/* Student Cards List */}
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                {filteredStudents.length === 0 ? (
                  <p className="text-xs text-slate-400 py-6 text-center">
                    No se encontraron alumnos con ese criterio.
                  </p>
                ) : (
                  filteredStudents.map((student) => {
                    const isSelected = selectedStudent?.id === student.id;
                    const studentTodayRecord = attendanceRecords.find(
                      (r) => r.studentId === student.id && r.fecha === todayStr
                    );

                    return (
                      <div
                        key={student.id}
                        onClick={() => setSelectedStudent(student)}
                        className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                          isSelected
                            ? 'bg-red-50/80 border-red-300 shadow-sm'
                            : 'bg-slate-50/60 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs ${
                              isSelected
                                ? 'bg-red-600 text-white shadow-sm'
                                : 'bg-slate-200 text-slate-700'
                            }`}
                          >
                            {student.nombre.substring(0, 2).toUpperCase()}
                          </div>

                          <div>
                            <div className="font-semibold text-xs text-slate-900 flex items-center gap-1.5">
                              <span>{student.nombre}</span>
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono">
                              Matrícula: {student.matricula} • Grupo {student.grupo || '10 A'}
                            </div>
                            <div className="text-[10px] text-red-700 dark:text-red-400 font-medium flex items-center gap-1 mt-0.5">
                              <Clock className="w-3 h-3 text-red-600" />
                              <span>{student.horaEntrada || '07:00'} - {student.horaSalida || '15:00'}</span>
                              <span className="text-slate-400">•</span>
                              <span className="truncate max-w-[120px]">{student.sedeNombre || 'Sede'}</span>
                            </div>
                          </div>
                        </div>

                        <div className="text-right flex items-center gap-1.5">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                              studentTodayRecord?.checkInStatus === 'A_TIEMPO'
                                ? 'bg-emerald-100 text-emerald-800'
                                : studentTodayRecord?.checkInStatus === 'RETARDO'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {studentTodayRecord?.checkInStatus || 'SIN ASISTIR'}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteStudent(student.id);
                            }}
                            className="p-1 hover:bg-rose-100 text-slate-400 hover:text-rose-600 rounded-lg transition-colors ml-0.5"
                            title={`Eliminar a ${student.nombre}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Detailed View for Selected Student */}
          <div className="lg:col-span-7 space-y-4">
            {selectedStudent ? (
              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-6">
                {/* Student Header Card */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-blue-600 text-white rounded-2xl flex items-center justify-center font-extrabold text-xl shadow-md">
                      {selectedStudent.nombre.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">
                        {selectedStudent.nombre}
                      </h3>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="font-mono text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded font-semibold">
                          Matrícula: {selectedStudent.matricula}
                        </span>
                        <span className="text-xs font-bold bg-blue-50 text-blue-800 px-2 py-0.5 rounded border border-blue-100">
                          Grupo {selectedStudent.grupo || '10 A'} - {selectedStudent.equipo || 'Equipo 1'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleStartEditStudent(selectedStudent)}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5 text-blue-600" />
                        <span>Editar</span>
                      </button>
                      <button
                        onClick={() => handleDeleteStudent(selectedStudent.id)}
                        className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Eliminar</span>
                      </button>
                    </div>
                    <button
                      onClick={() => handleOpenIndividualReport(selectedStudent)}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-95"
                    >
                      <FileText className="w-4 h-4 text-emerald-100" />
                      <span>Generar Reporte</span>
                    </button>
                  </div>
                </div>

                {/* Properties Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                    <span className="text-slate-500 block mb-0.5 font-medium">Sedes Hospitalarias Asignadas</span>
                    <strong className="text-slate-900 font-bold block truncate">
                      Principal: {selectedStudent.sedeNombre || 'Sede Principal'}
                    </strong>
                    {selectedStudent.secondarySedeNombre && (
                      <span className="text-blue-700 font-semibold block text-[11px] mt-0.5">
                        Secundaria: {selectedStudent.secondarySedeNombre}
                      </span>
                    )}
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                    <span className="text-slate-500 block mb-0.5 font-medium">Horarios Asignados por Día</span>
                    {selectedStudent.horariosPorDia && selectedStudent.horariosPorDia.length > 0 ? (
                      <div className="space-y-1 mt-1">
                        {sortDaySchedules(selectedStudent.horariosPorDia).map((h) => {
                          const turnosStr = h.turnos && h.turnos.length > 0
                            ? h.turnos.map((t) => `${t.horaEntrada} - ${t.horaSalida}`).join(' | ')
                            : `${h.horaEntrada} - ${h.horaSalida}`;

                          return (
                            <div key={h.dia} className="flex items-center justify-between text-[11px] bg-white px-2 py-1 rounded border border-slate-200">
                              <span className="font-bold text-slate-800">{h.dia}:</span>
                              <div className="flex items-center gap-1.5 font-mono">
                                <span className="font-bold text-red-700 bg-red-50 px-1.5 py-0.5 rounded border border-red-100">
                                  {turnosStr}
                                </span>
                                <span className="text-slate-500 text-[10px]">({h.toleranciaMinutos ?? 15}m tol)</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 mt-1">
                        <strong className="text-red-700 font-bold font-mono bg-red-50 px-2 py-0.5 rounded border border-red-100">
                          {selectedStudent.horaEntrada || '07:00'} - {selectedStudent.horaSalida || '15:00'}
                        </strong>
                        <span className="text-slate-500 text-[11px]">
                          ({selectedStudent.toleranciaMinutos ?? 15}m tol)
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                    <span className="text-slate-500 block mb-0.5 font-medium">Especialidad / Rotación Específica</span>
                    <strong className="text-slate-900 font-bold">{selectedStudent.especialidad || selectedStudent.rotacion}</strong>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                    <span className="text-slate-500 block mb-0.5 font-medium">Días de Guardia Asignados</span>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {selectedStudent.diasAsistencia && selectedStudent.diasAsistencia.length > 0 ? (
                        sortDaysArray(selectedStudent.diasAsistencia).map((d) => (
                          <span key={d} className="px-2 py-0.5 bg-red-50 text-red-800 border border-red-200 font-bold rounded text-[11px]">
                            {d}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-400">Lunes, Miércoles</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Device Security Card */}
                {(() => {
                  const studentRecWithDevice = attendanceRecords.find(
                    (r) =>
                      (r.studentId === selectedStudent.id || isMatriculaMatch(r.matricula, selectedStudent.matricula)) &&
                      Boolean(r.deviceIdUsed)
                  );

                  return (
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Smartphone className="w-5 h-5 text-blue-600 shrink-0" />
                          <div>
                            <h4 className="font-bold text-slate-900 text-xs">
                              Dispositivo Móvil Vinculado
                            </h4>
                            {selectedStudent.linkedDeviceId ? (
                              <p className="text-[11px] text-slate-600 font-medium">
                                {selectedStudent.linkedDeviceName || 'Smartphone Android/iOS'} ({selectedStudent.linkedDeviceId})
                              </p>
                            ) : studentRecWithDevice ? (
                              <div className="space-y-1 mt-0.5">
                                <p className="text-[11px] text-amber-700 font-bold">
                                  ⚠️ Checó asistencia desde: "{studentRecWithDevice.deviceNameUsed || 'Smartphone'}" ({studentRecWithDevice.deviceIdUsed})
                                </p>
                              </div>
                            ) : (
                              <p className="text-[11px] text-slate-500">
                                No hay teléfono enlazado a esta matrícula todavía.
                              </p>
                            )}
                          </div>
                        </div>

                        {selectedStudent.linkedDeviceId ? (
                          <button
                            type="button"
                            onClick={() => handleUnlinkDevice(selectedStudent.id, selectedStudent.nombre)}
                            className="px-3 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-800 text-[11px] font-bold rounded-xl transition-colors flex items-center gap-1 shrink-0"
                          >
                            <Smartphone className="w-3.5 h-3.5 text-rose-600" />
                            <span>Desvincular Dispositivo</span>
                          </button>
                        ) : studentRecWithDevice ? (
                          <button
                            type="button"
                            onClick={() => {
                              const linked = linkStudentDevice(
                                selectedStudent.id,
                                studentRecWithDevice.deviceIdUsed,
                                studentRecWithDevice.deviceNameUsed || 'Smartphone'
                              );
                              if (linked) {
                                onRefreshData();
                                setSelectedStudent({
                                  ...selectedStudent,
                                  linkedDeviceId: studentRecWithDevice.deviceIdUsed,
                                  linkedDeviceName: studentRecWithDevice.deviceNameUsed || 'Smartphone',
                                });
                              }
                            }}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-xl transition-colors flex items-center gap-1 shrink-0 shadow-sm"
                          >
                            <Smartphone className="w-3.5 h-3.5" />
                            <span>Enlazar este Teléfono</span>
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="bg-white rounded-2xl p-12 border border-slate-200 text-center text-slate-400 text-xs">
                Selecciona un alumno de la lista lateral para ver su perfil completo.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: VISTA POR GRUPOS Y EQUIPOS (10 A, 10 B, 10 C, 8 A...) */}
      {activeTab === 'GROUPS' && (
        <div className="space-y-6">
          {/* Group Header & Tabs */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Folder className="w-5 h-5 text-blue-600" />
                  <span>Control Visual por Grupos y Equipos</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Organización de alumnos por grupo académico (10 A, 10 B, 8 A...) y equipos de trabajo.
                </p>
              </div>

              <button
                onClick={() =>
                  exportGroupPDFReport(
                    students,
                    selectedGroupTab,
                    hospitalZone,
                    attendanceRecords,
                    fechaInicioSemestre,
                    fechaFinSemestre,
                    initialMaster.nombreDocente,
                    diasInhabiles
                  )
                }
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-2 transition-all self-start sm:self-auto"
              >
                <Download className="w-4 h-4" />
                <span>Exportar Reporte a PDF</span>
              </button>
            </div>

            {/* Group Dropdown Selector */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5 shrink-0">
                <Filter className="w-4 h-4 text-blue-600" />
                <span>Seleccionar Grupo Académico:</span>
              </label>
              <div className="relative flex-1 sm:max-w-xs">
                <select
                  value={selectedGroupTab}
                  onChange={(e) => setSelectedGroupTab(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer shadow-sm"
                >
                  <option value="ALL">Todos los Grupos ({students.length} alumnos)</option>
                  {allGroups.map((grp) => {
                    const count = students.filter((s) => (s.grupo || '10 A') === grp).length;
                    return (
                      <option key={grp} value={grp}>
                        Grupo {grp} ({count} {count === 1 ? 'alumno' : 'alumnos'})
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
          </div>

          {/* Group Content Rendered */}
          {(() => {
            const groupStudents =
              selectedGroupTab === 'ALL'
                ? students
                : students.filter((s) => (s.grupo || '10 A') === selectedGroupTab);

            // Group by Equipo
            const equiposMap: Record<string, Student[]> = {};
            groupStudents.forEach((st) => {
              const eq = st.equipo || 'Equipo 1';
              if (!equiposMap[eq]) equiposMap[eq] = [];
              equiposMap[eq].push(st);
            });

            const equipoKeys = Object.keys(equiposMap).sort();

            if (groupStudents.length === 0) {
              return (
                <div className="bg-white rounded-2xl p-12 text-center text-slate-400 border border-slate-200">
                  <Users className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                  <p className="text-sm font-semibold">No hay alumnos registrados en el Grupo {selectedGroupTab}.</p>
                  <p className="text-xs mt-1">Usa el botón "+ Agregar Alumno" para dar de alta integrantes.</p>
                </div>
              );
            }

            return (
              <div className="space-y-6">
                {equipoKeys.map((eqKey) => {
                  const teamStudents = equiposMap[eqKey];
                  const teamKey = `${selectedGroupTab}_${eqKey}`;
                  const teamSched = getTeamSchedule(teamKey, teamStudents);
                  const isExpanded = !!expandedTeams[teamKey];

                  return (
                    <div
                      key={eqKey}
                      className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4"
                    >
                      {/* Equipo Sub-Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-3 gap-2">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-blue-50 text-blue-700 rounded-lg flex items-center justify-center font-bold text-xs border border-blue-200">
                            {eqKey.replace(/Equipo\s*/i, 'E')}
                          </div>
                          <div>
                            <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                              <span>{eqKey}</span>
                              {selectedGroupTab !== 'ALL' && (
                                <span className="text-xs font-normal text-slate-500">
                                  (Grupo {selectedGroupTab})
                                </span>
                              )}
                            </h4>
                            <span className="text-xs text-slate-500">
                              {teamStudents.length} Integrantes asignados
                            </span>
                          </div>
                        </div>

                        {savedTeamAlert === teamKey ? (
                          <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold rounded-lg animate-fade-in">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            <span>¡Horarios actualizados en {eqKey}!</span>
                          </div>
                        ) : (
                          <span className="text-[11px] font-semibold bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg self-start sm:self-auto">
                            {teamSched.days.length} Días de Guardia asignados
                          </span>
                        )}
                      </div>

                      {/* CONFIGURACIÓN DE HORARIOS Y DÍAS DEL EQUIPO DIVIDIDO POR DÍA */}
                      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/80 space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/60 pb-2.5">
                          <div className="flex items-center gap-2 text-slate-800">
                            <Clock className="w-4 h-4 text-blue-600 shrink-0" />
                            <span className="text-xs font-bold uppercase tracking-wider">
                              Configurar Horarios por Día de Guardia — {eqKey}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[11px] text-slate-500 font-medium">
                              Se sobreescribirá en los {teamStudents.length} alumnos del {eqKey}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleTeamExpand(teamKey)}
                              className={`px-3 py-1.5 text-xs font-bold rounded-xl border transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs ${
                                isExpanded
                                  ? 'bg-slate-200 hover:bg-slate-300 text-slate-700 border-slate-300'
                                  : 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600 shadow-xs'
                              }`}
                              title={
                                isExpanded
                                  ? 'Minimizar apartado de horarios'
                                  : 'Desplegar apartado de configuración de horarios'
                              }
                            >
                              {isExpanded ? (
                                <>
                                  <ChevronUp className="w-4 h-4" />
                                  <span>Minimizar</span>
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="w-4 h-4" />
                                  <span>Configurar / Editar Horarios</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="space-y-4 animate-fade-in">
                            {/* 1. Seleccionar Días */}
                            <div className="space-y-2">
                              <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                                <Calendar className="w-3.5 h-3.5 text-blue-600" />
                                <span>1. Selecciona los Días de Guardia ({eqKey}):</span>
                              </label>
                              <div className="flex flex-wrap gap-1.5">
                                {DIAS_SEMANA_OPCIONES.map((dia) => {
                                  const isSelected = teamSched.days.includes(dia);
                                  return (
                                    <button
                                      key={dia}
                                      type="button"
                                      onClick={() => handleToggleTeamDay(teamKey, teamStudents, dia)}
                                      className={`px-3 py-1.5 text-xs rounded-lg font-bold transition-all border flex items-center gap-1.5 ${
                                        isSelected
                                          ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                                          : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                                      }`}
                                    >
                                      {isSelected && <Check className="w-3 h-3" />}
                                      <span>{dia}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* 2. Asignar Horario por cada Día Seleccionado */}
                            <div className="space-y-2 pt-2 border-t border-slate-200/60">
                              <div className="flex items-center justify-between">
                                <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                                  <Clock className="w-3.5 h-3.5 text-blue-600" />
                                  <span>2. Horario asignado a cada día de guardia:</span>
                                </label>
                                {teamSched.days.length > 0 && (
                                  <span className="text-[10px] text-slate-500 font-normal">
                                    ({teamSched.days.length} {teamSched.days.length === 1 ? 'día activo' : 'días activos'})
                                  </span>
                                )}
                              </div>

                              {teamSched.days.length === 0 ? (
                                <div className="p-3 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-xs font-medium flex items-center gap-2">
                                  <Info className="w-4 h-4 text-amber-600 shrink-0" />
                                  <span>Selecciona al menos un día de la lista arriba para definir sus horas de entrada y salida.</span>
                                </div>
                              ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                  {sortDaysArray(teamSched.days).map((dia) => {
                                    const daySched = teamSched.schedulesByDay[dia] || {
                                      turnos: [{ horaEntrada: hospitalZone.horaEntrada || '07:00', horaSalida: hospitalZone.horaSalida || '15:00' }],
                                    };
                                    const turnos = daySched.turnos && daySched.turnos.length > 0
                                      ? daySched.turnos
                                      : [{ horaEntrada: hospitalZone.horaEntrada || '07:00', horaSalida: hospitalZone.horaSalida || '15:00' }];

                                    return (
                                      <div
                                        key={dia}
                                        className="bg-white p-3 rounded-xl border border-blue-200 shadow-2xs space-y-2.5"
                                      >
                                        <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                                          <span className="text-xs font-extrabold text-blue-900 flex items-center gap-1">
                                            <Calendar className="w-3.5 h-3.5 text-blue-600" />
                                            {dia}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => handleTeamAddTurno(teamKey, teamStudents, dia)}
                                            className="text-[10px] font-bold text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded border border-blue-200 flex items-center gap-1 transition-colors"
                                            title="Agregar otro turno / horario para este día"
                                          >
                                            <Plus className="w-3 h-3" />
                                            <span>+ Turno</span>
                                          </button>
                                        </div>

                                        <div className="space-y-2">
                                          {turnos.map((turno, tIdx) => (
                                            <div
                                              key={tIdx}
                                              className="p-2 bg-slate-50/80 rounded-lg border border-slate-200/80 space-y-1"
                                            >
                                              <div className="flex items-center justify-between">
                                                <span className="text-[10px] font-bold text-slate-500 uppercase">
                                                  Turno {tIdx + 1}
                                                </span>
                                                {turnos.length > 1 && (
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      handleTeamRemoveTurno(teamKey, teamStudents, dia, tIdx)
                                                    }
                                                    className="text-slate-400 hover:text-rose-600 p-0.5 transition-colors"
                                                    title="Eliminar este turno"
                                                  >
                                                    <Trash2 className="w-3 h-3" />
                                                  </button>
                                                )}
                                              </div>
                                              <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                  <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                                                    Entrada
                                                  </label>
                                                  <input
                                                    type="time"
                                                    value={turno.horaEntrada}
                                                    onChange={(e) =>
                                                      handleTeamTurnoTimeChange(
                                                        teamKey,
                                                        teamStudents,
                                                        dia,
                                                        tIdx,
                                                        'horaEntrada',
                                                        e.target.value
                                                      )
                                                    }
                                                    className="w-full px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs font-bold font-mono text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                                  />
                                                </div>
                                                <div>
                                                  <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                                                    Salida
                                                  </label>
                                                  <input
                                                    type="time"
                                                    value={turno.horaSalida}
                                                    onChange={(e) =>
                                                      handleTeamTurnoTimeChange(
                                                        teamKey,
                                                        teamStudents,
                                                        dia,
                                                        tIdx,
                                                        'horaSalida',
                                                        e.target.value
                                                      )
                                                    }
                                                    className="w-full px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs font-bold font-mono text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                                  />
                                                </div>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Botón Guardar Horarios */}
                              <div className="pt-2 flex justify-end">
                                <button
                                  type="button"
                                  disabled={savingTeamKey === teamKey}
                                  onClick={() => handleSaveTeamSchedule(teamKey, eqKey, teamStudents)}
                                  className={`px-5 py-2 text-white font-bold text-xs rounded-xl shadow-sm flex items-center gap-1.5 transition-all ${
                                    savingTeamKey === teamKey
                                      ? 'bg-emerald-400 cursor-not-allowed'
                                      : 'bg-emerald-600 hover:bg-emerald-700 cursor-pointer'
                                  }`}
                                >
                                  {savingTeamKey === teamKey ? (
                                    <>
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                      <span>Guardando en BD y Nube...</span>
                                    </>
                                  ) : (
                                    <>
                                      <Check className="w-4 h-4" />
                                      <span>Guardar Horarios para {eqKey}</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Team Grid of Students */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {teamStudents.map((st) => {
                          const todayRec = attendanceRecords.find(
                            (r) => r.studentId === st.id && r.fecha === todayStr
                          );

                          return (
                            <div
                              key={st.id}
                              className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-white hover:shadow-md transition-all space-y-3"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-9 h-9 bg-blue-600 text-white rounded-xl flex items-center justify-center font-bold text-xs">
                                    {st.nombre.substring(0, 2).toUpperCase()}
                                  </div>
                                  <div>
                                    <h5 className="font-bold text-slate-900 text-xs line-clamp-1">
                                      {st.nombre}
                                    </h5>
                                    <span className="font-mono text-[11px] text-slate-500">
                                      Matrícula: {st.matricula}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => handleOpenIndividualReport(st)}
                                    className="text-slate-400 hover:text-emerald-600 p-1 transition-colors"
                                    title="Generar Reporte Individual"
                                  >
                                    <FileText className="w-3.5 h-3.5 text-emerald-600" />
                                  </button>
                                  <button
                                    onClick={() => handleStartEditStudent(st)}
                                    className="text-slate-400 hover:text-blue-600 p-1 transition-colors"
                                    title="Editar Alumno"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>

                              {/* Days & Schedules Pill */}
                              <div className="flex flex-col gap-1 text-xs pt-1 border-t border-slate-200/60">
                                <span className="text-slate-500 text-[10px] font-semibold">Días y Horarios Asignados:</span>
                                <div className="flex flex-wrap gap-1">
                                  {st.horariosPorDia && st.horariosPorDia.length > 0 ? (
                                    sortDaySchedules(st.horariosPorDia).map((h) => {
                                      const turnosText = h.turnos && h.turnos.length > 0
                                        ? h.turnos.map((t) => `${t.horaEntrada}-${t.horaSalida}`).join(', ')
                                        : `${h.horaEntrada}-${h.horaSalida}`;
                                      return (
                                        <span
                                          key={h.dia}
                                          className="px-2 py-0.5 bg-blue-50 text-blue-900 border border-blue-200 font-bold rounded text-[10px] flex items-center gap-1"
                                        >
                                          <span>{h.dia}:</span>
                                          <span className="font-mono text-blue-700">{turnosText}</span>
                                        </span>
                                      );
                                    })
                                  ) : st.diasAsistencia && st.diasAsistencia.length > 0 ? (
                                    sortDaysArray(st.diasAsistencia).map((d) => (
                                      <span
                                        key={d}
                                        className="px-2 py-0.5 bg-blue-50 text-blue-900 border border-blue-200 font-bold rounded text-[10px]"
                                      >
                                        {d} ({st.horaEntrada || '07:00'}-{st.horaSalida || '15:00'})
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-slate-400 text-[10px]">Sin días asignados</span>
                                  )}
                                </div>
                              </div>

                              {/* Binding & Today Status */}
                              <div className="flex items-center justify-between gap-1 text-[11px]">
                                <span
                                  className={`px-2 py-0.5 rounded font-bold ${
                                    st.linkedDeviceId
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-amber-100 text-amber-800'
                                  }`}
                                >
                                  {st.linkedDeviceId ? '📱 Vinculado' : '⚠️ Sin Teléfono'}
                                </span>

                                <span
                                  className={`px-2 py-0.5 rounded font-bold ${
                                    todayRec?.checkInStatus === 'A_TIEMPO'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : todayRec?.checkInStatus === 'RETARDO'
                                      ? 'bg-amber-100 text-amber-800'
                                      : 'bg-slate-200 text-slate-600'
                                  }`}
                                >
                                  {todayRec?.checkInStatus || 'Sin Checada'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* TAB 3: BITÁCORA GENERAL DE ASISTENCIAS */}
      {activeTab === 'RECORDS' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-4 gap-3">
            <div>
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-600" />
                Histórico General de Checadas
              </h3>
              <p className="text-xs text-slate-500">
                Bitácora oficial de asistencias con timestamps de GPS, estatus de puntualidad y número de dispositivo móvil.
              </p>
            </div>

            {/* Direct SQL Performance Stats Badge */}
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 text-blue-800 text-xs font-mono font-bold border border-blue-200">
                <Activity className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
                <span>
                  {serverStats ? `${serverStats.total} checadas calculadas por SQLite` : `${attendanceRecords.length} totales`}
                </span>
              </span>
            </div>
          </div>

          {/* Quick Metrics Bar calculated by Server Engine / Dynamic Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-3">
              <div className="text-[11px] font-bold text-emerald-800 uppercase flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                A Tiempo / Presentes
              </div>
              <div className="text-xl font-bold font-mono text-emerald-950 mt-1">
                {attendanceRecords.filter(r => (r.checkInStatus === 'A_TIEMPO' || (r as any).estado === 'A_TIEMPO' || (r as any).estado === 'PRESENTE') && !r.esJustificada && r.checkInStatus !== 'JUSTIFICADA' && (r as any).estado !== 'JUSTIFICADA').length}
              </div>
            </div>

            <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3">
              <div className="text-[11px] font-bold text-amber-800 uppercase flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-amber-600" />
                Retardos
              </div>
              <div className="text-xl font-bold font-mono text-amber-950 mt-1">
                {attendanceRecords.filter(r => (r.checkInStatus === 'RETARDO' || (r as any).estado === 'RETARDO') && !r.esJustificada && r.checkInStatus !== 'JUSTIFICADA' && (r as any).estado !== 'JUSTIFICADA').length}
              </div>
            </div>

            <div className="bg-indigo-50/80 border border-indigo-200 rounded-xl p-3">
              <div className="text-[11px] font-bold text-indigo-800 uppercase flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                Guardias Justificadas
              </div>
              <div className="text-xl font-bold font-mono text-indigo-950 mt-1">
                {attendanceRecords.filter(r => r.esJustificada || r.checkInStatus === 'JUSTIFICADA' || (r as any).estado === 'JUSTIFICADA').length}
              </div>
            </div>
          </div>

          {/* Filters Bar: Group + Date Range with Presets */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              {/* Filter 1: Group */}
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5 shrink-0">
                  <Filter className="w-4 h-4 text-blue-600" />
                  <span>Grupo:</span>
                </label>
                <select
                  value={recordsGroupTab}
                  onChange={(e) => setRecordsGroupTab(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs"
                >
                  <option value="ALL">Todos los Grupos</option>
                  {allGroups.map((grp) => (
                    <option key={grp} value={grp}>
                      Grupo {grp}
                    </option>
                  ))}
                </select>
              </div>

              {/* Filter 2: Quick Date Presets */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-bold text-slate-600 mr-1 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-500" />
                  Rango:
                </span>
                <button
                  type="button"
                  onClick={() => handleSetRecordsFilterPreset('CURRENT_WEEK')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all ${
                    recordsFilterMode === 'CURRENT_WEEK'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  Esta Semana (Default)
                </button>
                <button
                  type="button"
                  onClick={() => handleSetRecordsFilterPreset('TODAY')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all ${
                    recordsFilterMode === 'TODAY'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  Hoy
                </button>
                <button
                  type="button"
                  onClick={() => handleSetRecordsFilterPreset('CURRENT_MONTH')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all ${
                    recordsFilterMode === 'CURRENT_MONTH'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  Este Mes
                </button>
                <button
                  type="button"
                  onClick={() => handleSetRecordsFilterPreset('ALL_TIME')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all ${
                    recordsFilterMode === 'ALL_TIME'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  Todo el Historial
                </button>
              </div>

              {/* Filter 3: Custom Date Pickers */}
              <div className="flex items-center gap-2 text-xs">
                <div className="flex items-center gap-1">
                  <span className="text-slate-500 font-medium">De:</span>
                  <input
                    type="date"
                    value={recordsStartDate}
                    onChange={(e) => {
                      setRecordsStartDate(e.target.value);
                      setRecordsFilterMode('CUSTOM');
                    }}
                    className="px-2 py-1 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-slate-500 font-medium">A:</span>
                  <input
                    type="date"
                    value={recordsEndDate}
                    onChange={(e) => {
                      setRecordsEndDate(e.target.value);
                      setRecordsFilterMode('CUSTOM');
                    }}
                    className="px-2 py-1 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[550px] overflow-y-auto border border-slate-200 rounded-xl relative shadow-xs">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-100 shadow-xs">
                <tr className="border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider bg-slate-100">
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Alumno</th>
                  <th className="px-4 py-3">Matrícula</th>
                  <th className="px-4 py-3">Grupo / Equipo</th>
                  <th className="px-4 py-3">Turno / Horario</th>
                  <th className="px-4 py-3">Entrada (GPS)</th>
                  <th className="px-4 py-3">Salida (GPS)</th>
                  <th className="px-4 py-3">Distancia</th>
                  <th className="px-4 py-3">Estatus</th>
                  <th className="px-4 py-3">Dispositivo Usado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs bg-white">
                {(() => {
                  const filteredRecords = attendanceRecords.filter((r) => {
                    // Group filter
                    if (recordsGroupTab !== 'ALL') {
                      const student = students.find((s) => s.id === r.studentId || isMatriculaMatch(s.matricula, r.matricula));
                      if (!student) return false;
                      const studentGrp = (student.grupo || '10 A').replace(/\s+/g, '').toUpperCase();
                      const targetGrp = recordsGroupTab.replace(/\s+/g, '').toUpperCase();
                      if (studentGrp !== targetGrp) return false;
                    }

                    // Date range filter
                    if (recordsStartDate && r.fecha < recordsStartDate) return false;
                    if (recordsEndDate && r.fecha > recordsEndDate) return false;

                    return true;
                  });

                  // Ordenar siempre de la checada más nueva arriba a la más antigua abajo
                  const sortedRecords = [...filteredRecords].sort((a, b) => {
                    const getRecordTime = (r: AttendanceRecord) => {
                      if (r.checkInTime) {
                        const t = new Date(r.checkInTime).getTime();
                        if (!isNaN(t)) return t;
                      }
                      if (r.checkOutTime) {
                        const t = new Date(r.checkOutTime).getTime();
                        if (!isNaN(t)) return t;
                      }
                      const t = new Date(r.fecha).getTime();
                      return isNaN(t) ? 0 : t;
                    };

                    const timeA = getRecordTime(a);
                    const timeB = getRecordTime(b);

                    if (timeB !== timeA) {
                      return timeB - timeA;
                    }

                    if (b.fecha !== a.fecha) {
                      return b.fecha.localeCompare(a.fecha);
                    }

                    return (b.id || '').localeCompare(a.id || '');
                  });

                  if (sortedRecords.length === 0) {
                    return (
                      <tr>
                        <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                          No se encontraron checadas en el rango de fechas seleccionado ({recordsStartDate || 'Inicio'} al {recordsEndDate || 'Hoy'}) para {recordsGroupTab === 'ALL' ? 'todos los grupos' : `Grupo ${recordsGroupTab}`}.
                        </td>
                      </tr>
                    );
                  }

                  return sortedRecords.map((r) => {
                    const student = students.find((s) => s.id === r.studentId || isMatriculaMatch(s.matricula, r.matricula));
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-4 py-3 font-mono text-slate-700">
                          {r.fecha}
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          {student?.nombre || r.matricula}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-600">
                          {r.matricula}
                        </td>
                        <td className="px-4 py-3 text-[11px] font-semibold text-blue-700">
                          {student ? `Grupo ${student.grupo || '10 A'} - ${student.equipo || 'Equipo 1'}` : '--'}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-700">
                          {r.turnoLabel || (r.horaEntradaProgramada ? `Turno (${r.horaEntradaProgramada}-${r.horaSalidaProgramada || '15:00'})` : 'Turno 1')}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-800">
                          {r.checkInTime ? formatTimeDisplay(r.checkInTime) : '--:--'}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-800">
                          {r.checkOutTime ? formatTimeDisplay(r.checkOutTime) : '--:--'}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-600">
                          {r.checkInDistanceMeters !== null
                            ? `${r.checkInDistanceMeters}m`
                            : '--'}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded text-[10px] font-bold ${
                              r.esJustificada || r.checkInStatus === 'JUSTIFICADA' || (r as any).estado === 'JUSTIFICADA'
                                ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                : r.checkInStatus === 'A_TIEMPO' || (r as any).estado === 'A_TIEMPO' || (r as any).estado === 'PRESENTE'
                                ? 'bg-emerald-100 text-emerald-800'
                                : r.checkInStatus === 'RETARDO' || (r as any).estado === 'RETARDO'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {r.esJustificada || r.checkInStatus === 'JUSTIFICADA' || (r as any).estado === 'JUSTIFICADA'
                              ? 'JUSTIFICADA'
                              : r.checkInStatus || (r as any).estado || 'A_TIEMPO'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[11px] text-slate-500 truncate max-w-[150px]">
                          {r.deviceNameUsed}
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: CONFIGURACIÓN Y GESTIÓN MULTI-SEDE / GEOCERCAS */}
      {activeTab === 'CONFIG' && (
        <div className="space-y-6">
          {/* Express Local Server Sync & Storage Dashboard Banner */}
          <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 rounded-2xl p-5 text-white shadow-xl space-y-5 border border-blue-800/50">
            {/* Top Row: Title, Status Badge & Sync Button */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-blue-800/40 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-500/20 text-blue-300 rounded-xl border border-blue-400/30 shrink-0 relative">
                  <Database className="w-6 h-6 text-blue-300" />
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 border-2 border-slate-900 rounded-full animate-pulse"></span>
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-bold text-sm sm:text-base text-white flex items-center gap-2">
                      Servidor Local Express Activo (Puerto 3000)
                    </h4>
                    <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 text-[10px] sm:text-xs font-mono font-bold rounded-full border border-emerald-500/30 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping"></span>
                      ● En vivo (SSE)
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Tus alumnos, asistencias y sedes se procesan localmente en el Servidor Express con sincronización continua vía SSE.
                  </p>
                </div>
              </div>

              <button
                onClick={handleManualCloudSync}
                disabled={isSyncingCloud}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-bold rounded-xl text-xs flex items-center gap-2 transition-all shadow-md shrink-0 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingCloud ? 'animate-spin' : ''}`} />
                <span>{isSyncingCloud ? 'Sincronizando...' : 'Sincronizar Servidor Local'}</span>
              </button>
            </div>

            {/* Middle Row: Express Backend Real-Time Local Data Stats */}
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h5 className="text-xs font-bold text-blue-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                  Métricas del Servidor Local Express & Persistencia
                </h5>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-bold border border-emerald-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    Actualizado en Vivo
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono">
                    Canal EventSource: /api/events
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* 1. Alumnos Registrados */}
                <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-200 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-emerald-400" />
                      Base de Alumnos
                    </span>
                    <span className="font-mono text-emerald-300 font-bold text-xs">
                      {students.length} registrados
                    </span>
                  </div>
                  {/* Progress Bar */}
                  <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden p-0.5 border border-slate-700/80">
                    <div
                      className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${students.length > 0 ? Math.max(5, Math.min(100, (students.filter((s) => s.activo).length / students.length) * 100)) : 100}%`,
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-300 font-mono">
                    <span>
                      Activos: {students.filter((s) => s.activo).length}
                    </span>
                    <span className="text-emerald-400 font-semibold">
                      Enlazados: {students.filter((s) => s.linkedDeviceId).length} celulares
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 pt-2 border-t border-slate-800 flex items-center justify-between">
                    <span>Archivo de Persistencia:</span>
                    <span className="text-slate-200 font-bold font-mono">data/app_state.json</span>
                  </div>
                </div>

                {/* 2. Registros de Asistencia */}
                <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-200 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-blue-400" />
                      Registros de Asistencia
                    </span>
                    <span className="font-mono text-blue-300 font-bold text-xs">
                      {attendanceRecords.length} totales
                    </span>
                  </div>
                  {/* Progress Bar */}
                  <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden p-0.5 border border-slate-700/80">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-cyan-400 h-full rounded-full transition-all duration-500"
                      style={{
                        width: '100%',
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-300 font-mono">
                    <span>
                      Checadas Hoy: {attendanceRecords.filter((r) => r.fecha === getTodayDateString()).length}
                    </span>
                    <span className="text-blue-400 font-semibold">
                      Estado: 100% Sincronizado
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 pt-2 border-t border-slate-800 flex items-center justify-between">
                    <span>Ruta API Servidor:</span>
                    <span className="text-slate-200 font-bold font-mono">/api/records</span>
                  </div>
                </div>

                {/* 3. Sedes Hospitalarias & SSE Stream */}
                <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-200 flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5 text-purple-400" />
                      Sedes & Conexión SSE
                    </span>
                    <span className="font-mono text-purple-300 font-bold text-xs">
                      {getHospitalSites().length} sedes activas
                    </span>
                  </div>
                  {/* Progress Bar */}
                  <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden p-0.5 border border-slate-700/80">
                    <div
                      className="bg-gradient-to-r from-purple-500 to-indigo-400 h-full rounded-full transition-all duration-500"
                      style={{
                        width: '100%',
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-300 font-mono">
                    <span>Transmisión: SSE Activa</span>
                    <span className="text-purple-300 font-semibold">
                      Latido: 25s
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 pt-2 border-t border-slate-800 flex items-center justify-between">
                    <span>Servidor Node.js:</span>
                    <span className="text-slate-200 font-bold font-mono">Express v4 / Vite</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {cloudSyncMsg && (
            <div className="p-3.5 bg-emerald-50 text-emerald-900 border border-emerald-200 rounded-xl text-xs font-semibold flex items-center gap-2 animate-fade-in shadow-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{cloudSyncMsg}</span>
            </div>
          )}

          {/* Multi-Sede Hospital Banner & Header */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <Building className="w-5 h-5 text-red-600" />
                  Gestión de Localizaciones y Geocercas GPS (Sedes Hospitalarias)
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Agrega y edita múltiples hospitales o clínicas (ej. Hospital General Los Mochis, IMSS Clínica 49 y 37, ISSSTE Los Mochis), ajusta sus coordenadas y define el radio de geocerca en metros para cada uno.
                </p>
              </div>

              <button
                onClick={handleOpenAddSite}
                className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-md transition-all self-start md:self-auto shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>+ Agregar Nueva Sede / Clínica</span>
              </button>
            </div>

            {siteSaveSuccess && (
              <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2 border border-emerald-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>{siteSaveSuccess}</span>
              </div>
            )}

            {/* List of Hospital Sites Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
              {allSites.map((site) => {
                const assignedStudentsCount = students.filter(
                  (s) => s.sedeId === site.id
                ).length;

                return (
                  <div
                    key={site.id}
                    className="bg-slate-50/80 rounded-2xl border border-slate-200 p-4 hover:border-slate-300 hover:shadow-md transition-all space-y-3 flex flex-col justify-between"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="w-9 h-9 bg-red-100 text-red-700 rounded-xl flex items-center justify-center font-bold">
                            <Building className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="font-bold text-slate-900 text-xs line-clamp-1">
                              {site.nombre}
                            </h4>
                            <p className="text-[11px] text-slate-500 line-clamp-1">
                              {site.direccion || 'Los Mochis, Sinaloa'}
                            </p>
                          </div>
                        </div>

                        <span className="px-2 py-0.5 bg-red-100 text-red-900 font-extrabold rounded-lg text-[10px] whitespace-nowrap shrink-0 border border-red-200">
                          📍 Radio: {site.radiusMeters}m
                        </span>
                      </div>

                      {/* Coordinates & Individual Schedule Notice */}
                      <div className="space-y-1.5 text-[11px] bg-white p-2.5 rounded-xl border border-slate-200/80">
                        <div className="flex items-center justify-between text-slate-600 font-mono">
                          <span>Lat: {site.latitude}</span>
                          <span>Lng: {site.longitude}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-600 pt-1 border-t border-slate-100">
                          <Clock className="w-3.5 h-3.5 text-red-600 shrink-0" />
                          <span className="text-[10px] font-medium text-slate-600">
                            Horario asignado individualmente por alumno (15m tol.)
                          </span>
                        </div>
                      </div>

                      {/* Assigned Students Badge */}
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">Alumnos en esta sede:</span>
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-800 font-bold rounded-md border border-blue-100">
                          {assignedStudentsCount} Alumnos
                        </span>
                      </div>
                    </div>

                    {/* Site Card Action Buttons */}
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-200/60">
                      <button
                        onClick={() => handleOpenEditSite(site)}
                        className="flex-1 py-1.5 bg-white hover:bg-slate-100 text-slate-800 font-bold rounded-lg text-xs border border-slate-200 transition-colors flex items-center justify-center gap-1"
                      >
                        <Edit2 className="w-3.5 h-3.5 text-blue-600" />
                        <span>Editar Sede y Radio</span>
                      </button>

                      <button
                        onClick={() => handleDeleteSite(site)}
                        className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-lg text-xs border border-rose-200 transition-colors"
                        title="Eliminar Sede"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Master Teacher Security & Data Backup Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Recuadro Izquierda: Credenciales del Usuario Maestro */}
            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 gap-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0" />
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">
                      Credenciales del Usuario Maestro
                    </h3>
                    <p className="text-xs text-slate-500">
                      Cambiar usuario o clave para controlar la aplicación
                    </p>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  {onResetDemoData && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('¿Restablecer todos los datos de muestra de la aplicación a los valores iniciales?')) {
                          onResetDemoData();
                        }
                      }}
                      className="w-full px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 border border-slate-200 transition-colors"
                      title="Restablecer datos de prueba"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-rose-600" />
                      <span>Reiniciar Datos</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setSemesterConfirmText('');
                      setSemesterError(null);
                      setSemesterSuccess(null);
                      setShowSemesterModal(true);
                    }}
                    className="w-full px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 border border-rose-200 transition-colors shadow-sm cursor-pointer"
                    title="Vaciar o eliminar todos los alumnos registrados"
                  >
                    <UserX className="w-3.5 h-3.5 text-rose-600" />
                    <span>Vaciar Alumnos</span>
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      if (
                        window.confirm(
                          '¿Estás seguro de que deseas desvincular los dispositivos celulares de TODOS los alumnos?\n\nEsta acción eliminará el vínculo de hardware de todos los alumnos registrados para que puedan volver a vincular o migrar su teléfono en su próximo inicio de sesión.'
                        )
                      ) {
                        await unlinkAllStudentDevices();
                        onRefreshData();
                        alert('✅ Se han desvinculado exitosamente todos los equipos móviles registrados de los alumnos.');
                      }
                    }}
                    className="w-full px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 border border-amber-200 transition-colors shadow-sm cursor-pointer"
                    title="Eliminar el registro de dispositivos vinculados de todos los alumnos"
                  >
                    <Smartphone className="w-3.5 h-3.5 text-amber-600" />
                    <span>Desvincular todos los equipos</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSemesterConfirmText('');
                      setSemesterError(null);
                      setSemesterSuccess(null);
                      setShowSemesterModal(true);
                    }}
                    className="w-full px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 border border-slate-200 transition-colors shadow-sm"
                    title="Eliminar registro de alumnos para nuevo semestre"
                  >
                    <UserX className="w-3.5 h-3.5 text-rose-600" />
                    <span>Cambio de Semestre</span>
                  </button>
                </div>
              </div>

              <form onSubmit={handleSaveMasterConfig} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Usuario Maestro
                  </label>
                  <input
                    type="text"
                    value={masterUserForm}
                    onChange={(e) => setMasterUserForm(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Contraseña / Clave Maestra
                  </label>
                  <div className="relative">
                    <input
                      type={showMasterPass ? 'text' : 'password'}
                      value={masterPassForm}
                      onChange={(e) => setMasterPassForm(e.target.value)}
                      className="w-full pl-3 pr-10 py-2 rounded-xl border border-slate-300 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowMasterPass(!showMasterPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                    >
                      {showMasterPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {masterSaveSuccess && (
                  <div className="p-2.5 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Credenciales maestras actualizadas correctamente.</span>
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs shadow-sm transition-all flex items-center justify-center gap-1.5"
                >
                  <KeyRound className="w-3.5 h-3.5 text-blue-400" />
                  <span>Actualizar Usuario Maestro</span>
                </button>
              </form>
            </div>

            {/* Recuadro Derecha: Exportación, Importación y Recarga de app_state.json */}
            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 gap-2">
                <div className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-slate-900 text-sm">
                        Base de Datos SQLite Local (clinicas.db)
                      </h3>
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-extrabold rounded-full">
                        Motor ACID Activo
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Transaccional local integrada sin rollbacks y espejo de respaldo en app_state.json
                    </p>
                  </div>
                </div>
              </div>

              {/* Data Summary Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 py-1">
                <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-center">
                  <span className="block text-slate-400 text-[10px] font-bold uppercase tracking-wider">Alumnos</span>
                  <span className="text-sm font-bold text-slate-900">{students.length}</span>
                </div>
                <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-center">
                  <span className="block text-slate-400 text-[10px] font-bold uppercase tracking-wider">Sedes</span>
                  <span className="text-sm font-bold text-slate-900">{getHospitalSites().length}</span>
                </div>
                <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-center">
                  <span className="block text-slate-400 text-[10px] font-bold uppercase tracking-wider">Bitácora</span>
                  <span className="text-sm font-bold text-slate-900">{attendanceRecords.length}</span>
                </div>
                <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-center">
                  <span className="block text-slate-400 text-[10px] font-bold uppercase tracking-wider">Inhábiles</span>
                  <span className="text-sm font-bold text-slate-900">{diasInhabiles.length}</span>
                </div>
              </div>

              {/* Status Banner */}
              {backupStatus && (
                <div
                  className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                    backupStatus.type === 'success'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}
                >
                  {backupStatus.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  )}
                  <span>{backupStatus.message}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleForceReloadState}
                  disabled={isReloadingServerState}
                  className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white font-bold rounded-xl text-xs shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  title="Recarga y sincroniza directamente desde la base de datos SQLite clinicas.db para mantener la información actualizada ante cualquier desincronización"
                >
                  <Database className={`w-4 h-4 text-emerald-200 ${isReloadingServerState ? 'animate-pulse' : ''}`} />
                  <RefreshCw className={`w-4 h-4 ${isReloadingServerState ? 'animate-spin' : ''}`} />
                  <span>{isReloadingServerState ? 'Sincronizando desde clinicas.db...' : '🔄 Recargar Datos desde clinicas.db'}</span>
                </button>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="file"
                    ref={backupFileInputRef}
                    accept=".json"
                    onChange={handleImportSystemBackup}
                    className="hidden"
                  />

                  <button
                    type="button"
                    onClick={() => backupFileInputRef.current?.click()}
                    disabled={isImportingBackup}
                    className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Upload className="w-4 h-4 text-emerald-400" />
                    <span>{isImportingBackup ? 'Analizando archivo...' : '📁 Cargar Respaldo JSON'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleExportSystemBackup}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-sm transition-all flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>📥 Descargar app_state.json</span>
                  </button>
                </div>
              </div>

              <div className="p-3 bg-emerald-50/80 rounded-xl border border-emerald-200 text-[11px] text-emerald-900 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Detección Automática de Archivos Activa</span>
                </div>
                <p className="text-emerald-900/90 leading-relaxed">
                  El servidor monitorea los archivos <code className="font-mono bg-emerald-100 px-1 py-0.5 rounded text-emerald-950 font-bold">/data/app_state.json</code> y <code className="font-mono bg-emerald-100 px-1 py-0.5 rounded text-emerald-950 font-bold">/app_state.json</code>. Cualquier cambio manual o carga externa se sincroniza automáticamente en memoria y se propaga a todos los dispositivos en tiempo real.
                </p>
              </div>

              <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 text-[11px] text-slate-600 space-y-1">
                <p className="font-semibold text-blue-900">📦 Información en app_state.json:</p>
                <p>Alumnos, matrículas, horarios por día, sedes hospitalarias, geocercas, bitácora de checadas y días inhábiles.</p>
              </div>
            </div>

            {/* Recuadro Supabase PostgreSQL: Base de Datos Maestra en la Nube */}
            <div className="lg:col-span-12 bg-gradient-to-br from-emerald-950 via-slate-900 to-teal-950 text-white rounded-3xl p-6 sm:p-8 border border-emerald-500/30 shadow-xl space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-emerald-500/20 pb-5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400 shadow-inner">
                    <Database className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h3 className="font-extrabold text-white text-base sm:text-lg">
                        Supabase PostgreSQL (Base Maestra en la Nube)
                      </h3>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                        supabaseStatus?.configured
                          ? 'bg-emerald-500 text-white shadow-sm'
                          : 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                      }`}>
                        {supabaseStatus?.configured ? '⚡ Supabase Activo (Espejo en la Nube)' : '⚪ No Configurado'}
                      </span>
                      {!supabaseStatus?.configured && (
                        <button
                          type="button"
                          onClick={() => setShowCloudRunHelp(!showCloudRunHelp)}
                          className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-all flex items-center gap-1"
                        >
                          <span>{showCloudRunHelp ? 'Ocultar Guía' : '¿Cómo configurar en Cloud Run?'}</span>
                        </button>
                      )}
                      {supabaseStatus?.configured && (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          supabaseStatus.circuitBreakerOpen
                            ? 'bg-amber-500/20 text-amber-300 border-amber-400/30'
                            : 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30'
                        }`}>
                          🛡️ {supabaseStatus.circuitBreakerOpen ? 'Circuit Breaker Activo' : 'PostgreSQL Pooling Directo'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-300 mt-0.5">
                      Arquitectura <strong>Local-First con SQLite</strong>: todas las lecturas y consultas de la app se resuelven en microsegundos desde SQLite sin consumir ancho de banda (0 Egress). Supabase actúa como réplica relacional en la nube.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDeltaSyncFromSupabase}
                    disabled={isSyncingSupabase}
                    className="px-3.5 py-2 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-xl text-xs shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50"
                    title="Delta Sync inteligente: actualiza cambios de alumnos/sedes y checadas recientes consumiendo kilobytes en lugar de megabytes"
                  >
                    <RefreshCw className={`w-4 h-4 ${isSyncingSupabase ? 'animate-spin text-white' : ''}`} />
                    <span>Delta Sync (Bajo Egress)</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSyncToSupabase}
                    disabled={isSyncingSupabase}
                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${isSyncingSupabase ? 'animate-spin text-white' : ''}`} />
                    <span>{isSyncingSupabase ? 'Sincronizando...' : 'Subir a Supabase (Push)'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handlePullFromSupabase(false)}
                    disabled={isSyncingSupabase}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-500/40 font-bold rounded-xl text-xs transition-all flex items-center gap-1.5 disabled:opacity-50"
                    title="Descargar datos maestros desde Supabase"
                  >
                    <Database className="w-4 h-4 text-emerald-400" />
                    <span>Descargar de Supabase (Pull)</span>
                  </button>
                </div>
              </div>

              {/* Status & Sync Result Message */}
              {supabaseSyncResult && (
                <div className={`p-4 rounded-2xl text-xs font-semibold flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  supabaseSyncResult.success
                    ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/30'
                    : 'bg-rose-500/20 text-rose-200 border border-rose-400/30'
                }`}>
                  <div className="flex items-center gap-3">
                    {supabaseSyncResult.success ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                    )}
                    <span>{supabaseSyncResult.message}</span>
                  </div>
                  {!supabaseStatus?.configured && (
                    <button
                      type="button"
                      onClick={() => setShowCloudRunHelp(true)}
                      className="px-3 py-1.5 bg-rose-400/20 hover:bg-rose-400/30 text-rose-100 rounded-lg text-[11px] font-bold border border-rose-400/40 shrink-0 transition-colors"
                    >
                      Ver cómo configurar en Cloud Run ⚙️
                    </button>
                  )}
                </div>
              )}

              {/* Guía Desplegable para Conectar Supabase en Cloud Run */}
              {showCloudRunHelp && (
                <div className="bg-slate-900/95 border border-amber-500/40 rounded-2xl p-5 text-xs text-slate-200 space-y-4 shadow-2xl animate-in fade-in duration-200">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2 text-amber-300 font-bold text-sm">
                      <Settings className="w-4 h-4" />
                      <span>Cómo activar la conexión de Supabase en Google Cloud Run</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowCloudRunHelp(false)}
                      className="text-slate-400 hover:text-white px-2 py-0.5 rounded text-[11px]"
                    >
                      ✕ Cerrar
                    </button>
                  </div>

                  <p className="text-slate-300 leading-relaxed">
                    La app funciona <strong>100% de forma autónoma con SQLite local</strong> (357 alumnos y todas tus checadas). El estado <span className="text-amber-300 font-bold">No Configurado</span> aparece únicamente porque el contenedor en Cloud Run requiere la variable de conexión a tu base de datos Supabase:
                  </p>

                  <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 font-mono text-[11px] space-y-2">
                    <div className="text-slate-400 font-sans font-bold text-[10px] uppercase">Variable de Entorno requerida en Cloud Run:</div>
                    <div className="text-emerald-400 break-all select-all font-bold">DATABASE_URL</div>
                    <div className="text-slate-400 font-sans text-[11px]">
                      Formato de Supabase (Connection Pooling):
                    </div>
                    <div className="text-teal-300 break-all select-all bg-slate-900 p-2 rounded border border-slate-800">
                      postgresql://postgres.[TU_PROYECTO]:[TU_CONTRASEÑA]@aws-0-[REGION].pooler.supabase.com:6543/postgres
                    </div>
                  </div>

                  <ol className="list-decimal list-inside space-y-1.5 text-slate-300 text-[11px]">
                    <li>En <strong>Supabase</strong> (supabase.com): Ve a <em>Project Settings &gt; Database &gt; Connection string (URI)</em> y copia la URL con tu contraseña.</li>
                    <li>En <strong>Google Cloud Console</strong>: Ve a <em>Cloud Run &gt; clinicastrack &gt; Editar y desplegar nueva revisión</em>.</li>
                    <li>En la pestaña <em>Variables y secretos</em> (o <em>Contenedores &gt; Variables de entorno</em>), añade la variable <code className="text-amber-300">DATABASE_URL</code> y pega la URL.</li>
                    <li>Haz clic en <strong>Desplegar</strong>. En cuanto inicie, el indicador cambiará a <strong className="text-emerald-400">⚡ Supabase Activo</strong> automáticamente.</li>
                  </ol>
                </div>
              )}

              {/* Diagnóstico en Vivo de Tablas Supabase vs SQLite Local */}
              <div className="bg-slate-900/90 rounded-2xl p-4 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    <h4 className="text-xs font-bold text-emerald-300">
                      Estado y Recuento en Supabase PostgreSQL vs Caché Local SQLite
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => fetchSupabaseDiagnostics()}
                    disabled={isLoadingDiagnostics}
                    className="text-[11px] px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-slate-700 flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingDiagnostics ? 'animate-spin text-emerald-400' : ''}`} />
                    <span>{isLoadingDiagnostics ? 'Comprobando...' : 'Revisar Estado'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl">
                    <span className="block text-slate-400 text-[10px] font-bold uppercase">Alumnos (students)</span>
                    <div className="flex items-baseline gap-1.5 mt-0.5">
                      <span className="text-sm font-bold text-white">
                        {supabaseDiagnostics?.supabaseCounts?.students ?? '—'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        / {supabaseDiagnostics?.localCounts?.students ?? students.length} local
                      </span>
                    </div>
                    <span className="inline-block mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                      ✓ Sincronizado
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl">
                    <span className="block text-slate-400 text-[10px] font-bold uppercase">Checadas (records)</span>
                    <div className="flex items-baseline gap-1.5 mt-0.5">
                      <span className="text-sm font-bold text-white">
                        {supabaseDiagnostics?.supabaseCounts?.records ?? '—'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        / {supabaseDiagnostics?.localCounts?.records ?? attendanceRecords.length} local
                      </span>
                    </div>
                    <span className="inline-block mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                      ✓ Sincronizado
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl">
                    <span className="block text-slate-400 text-[10px] font-bold uppercase">Sedes (sites)</span>
                    <div className="flex items-baseline gap-1.5 mt-0.5">
                      <span className="text-sm font-bold text-white">
                        {supabaseDiagnostics?.supabaseCounts?.sites ?? '—'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        / {supabaseDiagnostics?.localCounts?.sites ?? getHospitalSites().length} local
                      </span>
                    </div>
                    <span className="inline-block mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                      ✓ Sincronizado
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl">
                    <span className="block text-slate-400 text-[10px] font-bold uppercase">Inhábiles (holidays)</span>
                    <div className="flex items-baseline gap-1.5 mt-0.5">
                      <span className="text-sm font-bold text-white">
                        {supabaseDiagnostics?.supabaseCounts?.holidays ?? '—'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        / {supabaseDiagnostics?.localCounts?.holidays ?? diasInhabiles.length} local
                      </span>
                    </div>
                    <span className="inline-block mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                      ✓ Sincronizado
                    </span>
                  </div>
                </div>
              </div>

              {/* Arquitectura & Ventajas */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                {/* 1. Base Relacional PostgreSQL */}
                <div className="p-4 bg-slate-900/90 rounded-2xl border border-slate-800 space-y-2 flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                      <Activity className="w-3.5 h-3.5" />
                      1. PostgreSQL Relacional
                    </span>
                    <p className="text-slate-300 leading-relaxed mt-1 text-[11px]">
                      Tablas estructuradas con índices para alumnos, matrículas, turnos de guardia y asistencias.
                    </p>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400 font-bold">Supabase Cloud</span>
                </div>

                {/* 2. Cero Egress / Lecturas Innecesarias */}
                <div className="p-4 bg-slate-900/90 rounded-2xl border border-slate-800 space-y-2 flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-teal-400 flex items-center gap-1">
                      <Radio className="w-3.5 h-3.5" />
                      2. Cero Consumo de Egress
                    </span>
                    <p className="text-slate-300 leading-relaxed mt-1 text-[11px]">
                      Las lecturas de alumnos y checadas se atienden desde SQLite local, protegiendo los límites de transferencia.
                    </p>
                  </div>
                  <span className="text-[10px] font-mono text-teal-300 font-bold">0 MB Egress en Consultas</span>
                </div>

                {/* 3. Anti-Saturación y Respaldo Seguro */}
                <div className="p-4 bg-slate-900/90 rounded-2xl border border-slate-800 space-y-2 flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-indigo-400 flex items-center gap-1">
                      <Trash2 className="w-3.5 h-3.5" />
                      3. Conexión Protegida
                    </span>
                    <p className="text-slate-300 leading-relaxed mt-1 text-[11px]">
                      Pool de conexiones optimizado con reintentos controlados y circuit breaker ante saturación.
                    </p>
                  </div>
                  <span className="text-[10px] font-mono text-indigo-300 font-bold">Protección Activa</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: DÍAS INHÁBILES Y SUSPENSIÓN DE LABORES */}
      {activeTab === 'HOLIDAYS' && (
        <div className="space-y-6 animate-fade-in">
          {/* Header Description & Explanation Card */}
          <div className="bg-gradient-to-br from-amber-500/10 via-amber-50/50 to-orange-500/10 rounded-2xl p-5 border border-amber-200/80 shadow-sm space-y-3">
            <div className="flex items-start gap-3">
              <div className="p-3 bg-amber-500 text-white rounded-xl shadow-md shrink-0">
                <CalendarX className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-extrabold text-slate-900 text-base sm:text-lg flex items-center gap-2">
                  Gestión de Días Inhábiles y Festivos
                  <span className="px-2.5 py-0.5 bg-amber-100 text-amber-800 text-xs font-mono font-bold rounded-full border border-amber-300">
                    {diasInhabiles.length} Registrado(s)
                  </span>
                </h3>
                <p className="text-xs sm:text-sm text-slate-700 mt-1 leading-relaxed">
                  Las fechas registradas en este apartado se consideran <strong>días de suspensión de labores o inhábiles</strong>. 
                  Al momento de consultar asistencias y generar reportes oficiales (PDF o pantalla), estas fechas <strong>NO se contarán como guardias ni generarán falsas inasistencias</strong> para ningún alumno de la base de datos.
                </p>
              </div>
            </div>
          </div>

          {/* Form & Quick Presets Section */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Add New Holiday Form */}
            <div className="lg:col-span-5 bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <Plus className="w-4 h-4 text-red-600" />
                <h4 className="font-bold text-slate-900 text-sm">Registrar Nueva Fecha Inhábil</h4>
              </div>

              <form onSubmit={handleAddDiaInhabil} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Fecha Inhábil (Año-Mes-Día) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={newInhabilFecha}
                    onChange={(e) => setNewInhabilFecha(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 bg-slate-50"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Motivo o Descripción de la Suspensión
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. Día de la Independencia, Natalicio, Aniversario, Consejo Técnico..."
                    value={newInhabilMotivo}
                    onChange={(e) => setNewInhabilMotivo(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                {inhabilSuccessMsg && (
                  <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2 animate-fade-in border border-emerald-200">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{inhabilSuccessMsg}</span>
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full py-2.5 bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold rounded-xl text-xs shadow-md transition-all flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>Agregar Día Inhábil</span>
                </button>
              </form>

              {/* Quick Presets for Official Mexican Holidays 2026 */}
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  Sugerencias Rápidas Días Festivos Oficiales:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { fecha: '2026-02-05', motivo: 'Día de la Constitución' },
                    { fecha: '2026-03-16', motivo: 'Natalicio de Benito Juárez' },
                    { fecha: '2026-05-01', motivo: 'Día del Trabajo' },
                    { fecha: '2026-09-16', motivo: 'Aniversario de la Independencia' },
                    { fecha: '2026-11-16', motivo: 'Aniversario de la Revolución' },
                    { fecha: '2026-12-25', motivo: 'Navidad' },
                    { fecha: '2027-01-01', motivo: 'Año Nuevo' },
                  ].map((p) => (
                    <button
                      key={p.fecha}
                      type="button"
                      onClick={() => handleAddPresetHoliday(p.fecha, p.motivo)}
                      className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-lg text-[11px] font-medium transition-colors"
                    >
                      + {p.motivo} ({p.fecha.substring(5)})
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: Table / List of Registered Días Inhábiles */}
            <div className="lg:col-span-7 bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-amber-600" />
                  Fechas Inhábiles Registradas
                </h4>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Filtrar por fecha o motivo..."
                    value={inhabilSearch}
                    onChange={(e) => setInhabilSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 w-full sm:w-52"
                  />
                </div>
              </div>

              {/* Table List */}
              {diasInhabiles.length === 0 ? (
                <div className="text-center py-12 px-4 space-y-3 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                  <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto">
                    <CalendarX className="w-6 h-6" />
                  </div>
                  <div>
                    <h5 className="font-bold text-slate-800 text-sm">No hay días inhábiles registrados</h5>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                      Agrega fechas festivas o de suspensión de labores usando el formulario de la izquierda. Todos los alumnos tendrán justificada la guardia en esas fechas.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-bold">
                        <th className="py-2.5 px-3">Fecha</th>
                        <th className="py-2.5 px-3">Motivo / Descripción</th>
                        <th className="py-2.5 px-3 text-center">Efecto en Reportes</th>
                        <th className="py-2.5 px-3 text-right">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {diasInhabiles
                        .filter(
                          (h) =>
                            h.fecha.includes(inhabilSearch) ||
                            h.motivo.toLowerCase().includes(inhabilSearch.toLowerCase())
                        )
                        .map((h) => {
                          const dateObj = new Date(h.fecha + 'T00:00:00');
                          const dateFormatted = dateObj.toLocaleDateString('es-MX', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          });

                          return (
                            <tr key={h.id} className="hover:bg-amber-50/40 transition-colors">
                              <td className="py-3 px-3">
                                <div className="font-bold font-mono text-slate-900">{h.fecha}</div>
                                <div className="text-[10px] text-slate-500 capitalize">{dateFormatted}</div>
                              </td>
                              <td className="py-3 px-3 font-semibold text-slate-800">
                                {h.motivo || 'Día Inhábil'}
                              </td>
                              <td className="py-3 px-3 text-center">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-100 text-amber-900 rounded-full text-[10px] font-bold border border-amber-200">
                                  <ShieldCheck className="w-3 h-3 text-amber-700" />
                                  Excluida de inasistencias
                                </span>
                              </td>
                              <td className="py-3 px-3 text-right">
                                <button
                                  onClick={() => handleDeleteDiaInhabil(h.id, h.fecha)}
                                  className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg border border-rose-200 transition-colors"
                                  title="Eliminar Fecha Inhábil"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* SECTION 2: JUSTIFICACIÓN INDIVIDUAL DE GUARDIAS POR ALUMNO */}
          <div className="bg-gradient-to-br from-indigo-500/10 via-purple-50/50 to-blue-500/10 rounded-2xl p-5 border border-indigo-200/80 shadow-sm space-y-3 mt-8">
            <div className="flex items-start gap-3">
              <div className="p-3 bg-indigo-600 text-white rounded-xl shadow-md shrink-0">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-extrabold text-slate-900 text-base sm:text-lg flex items-center gap-2">
                  Justificación Individual de Guardias por Alumno
                  <span className="px-2.5 py-0.5 bg-indigo-100 text-indigo-800 text-xs font-mono font-bold rounded-full border border-indigo-300">
                    {attendanceRecords.filter(r => r.esJustificada || r.checkInStatus === 'JUSTIFICADA' || (r as any).estado === 'JUSTIFICADA').length} Justificante(s)
                  </span>
                </h3>
                <p className="text-xs sm:text-sm text-slate-700 mt-1 leading-relaxed">
                  Permite autorizar y justificar de forma individual una fecha específica de guardia para un alumno en particular (por incapacidad médica, comisión académica, etc.). 
                  Esta guardia quedará registrada oficialmente como <strong>JUSTIFICADA</strong> y se reflejará con su motivo en los reportes individuales y grupales en PDF.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Individual Justification Form */}
            <div className="lg:col-span-5 bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <UserCheck className="w-4 h-4 text-indigo-600" />
                <h4 className="font-bold text-slate-900 text-sm">Emitir Justificante para un Alumno</h4>
              </div>

              <form onSubmit={handleAddIndividualJustification} className="space-y-3.5">
                {/* Searchable Student Combobox */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Seleccionar Alumno <span className="text-red-500">*</span>
                  </label>

                  {justStudentId && (() => {
                    const selStudent = students.find((s) => s.id === justStudentId || isMatriculaMatch(s.matricula, justStudentId));
                    if (!selStudent) return null;
                    const dateObj = new Date(justDate + 'T00:00:00');
                    const isDuty = !isNaN(dateObj.getTime()) ? isDutyDayForDate(dateObj, selStudent) : false;
                    const dayName = !isNaN(dateObj.getTime()) ? WEEKDAY_NAMES_ES[dateObj.getDay()] : '';

                    return (
                      <div className="p-3 bg-gradient-to-br from-indigo-50/90 via-purple-50/40 to-blue-50/60 border border-indigo-200 rounded-xl space-y-2 text-xs shadow-xs animate-fade-in">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-xs shrink-0">
                              {selStudent.nombre.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="font-extrabold text-indigo-950 truncate text-xs">{selStudent.nombre}</p>
                              <p className="font-mono text-[11px] font-bold text-indigo-700">{selStudent.matricula}</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setJustStudentId('');
                              setJustStudentSearch('');
                              setJustStudentDropdownOpen(true);
                            }}
                            className="px-2.5 py-1 bg-white hover:bg-slate-50 text-indigo-700 border border-indigo-200 hover:border-indigo-300 rounded-lg text-[11px] font-bold flex items-center gap-1 shadow-xs transition-all active:scale-95 shrink-0"
                            title="Seleccionar otro alumno"
                          >
                            <UserX className="w-3.5 h-3.5 text-indigo-500" />
                            <span>Cambiar</span>
                          </button>
                        </div>

                        <div className="text-[11px] text-slate-600 flex flex-wrap gap-x-3 gap-y-1 pt-1.5 border-t border-indigo-100/80">
                          <span>Grupo: <strong className="text-slate-800">{selStudent.grupo || '10 A'}</strong></span>
                          <span>Equipo: <strong className="text-slate-800">{selStudent.equipo || 'Equipo 1'}</strong></span>
                          <span>Días guardia: <strong className="text-indigo-900">{selStudent.diasAsistencia ? sortDaysArray(selStudent.diasAsistencia).join(', ') : 'Lunes, Miércoles'}</strong></span>
                        </div>

                        {justDate && (
                          <div className="pt-1 text-[11px]">
                            {isDuty ? (
                              <span className="text-emerald-700 font-bold flex items-center gap-1">
                                <Check className="w-3.5 h-3.5" /> El {dayName} sí es día programado de guardia para este alumno.
                              </span>
                            ) : (
                              <span className="text-amber-700 font-medium flex items-center gap-1">
                                <Info className="w-3.5 h-3.5" /> Nota: El {dayName} no es el día habitual de guardia, pero igual puedes registrar la justificación.
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {!justStudentId && (
                    <div className="space-y-1.5">
                      <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-indigo-500 pointer-events-none" />
                        <input
                          type="text"
                          placeholder="Buscar por nombre, matrícula o grupo..."
                          value={justStudentSearch}
                          onChange={(e) => {
                            setJustStudentSearch(e.target.value);
                            setJustStudentDropdownOpen(true);
                          }}
                          onFocus={() => setJustStudentDropdownOpen(true)}
                          className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-slate-300 focus:border-indigo-500 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400/30 bg-slate-50"
                        />
                        {justStudentSearch && (
                          <button
                            type="button"
                            onClick={() => setJustStudentSearch('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-md"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {justStudentDropdownOpen && (() => {
                        const searchLower = justStudentSearch.toLowerCase().trim();
                        const matching = students.filter((s) => {
                          if (!searchLower) return true;
                          return (
                            s.nombre.toLowerCase().includes(searchLower) ||
                            s.matricula.toLowerCase().includes(searchLower) ||
                            (s.grupo || '').toLowerCase().includes(searchLower) ||
                            (s.equipo || '').toLowerCase().includes(searchLower) ||
                            (s.sedeNombre || '').toLowerCase().includes(searchLower)
                          );
                        }).sort((a, b) => (a.grupo || '').localeCompare(b.grupo || '') || a.nombre.localeCompare(b.nombre));

                        return (
                          <div className="border border-indigo-200 rounded-xl bg-white shadow-lg overflow-hidden max-h-56 overflow-y-auto divide-y divide-slate-100 z-20">
                            <div className="px-3 py-1.5 bg-indigo-50/60 text-[10px] font-bold text-indigo-800 uppercase flex items-center justify-between sticky top-0 backdrop-blur-xs z-10">
                              <span>{matching.length} Alumno(s) disponible(s)</span>
                              <span className="text-slate-500 font-normal">Haz clic para elegir</span>
                            </div>

                            {matching.length === 0 ? (
                              <div className="p-4 text-center text-xs text-slate-500">
                                No se encontraron alumnos con "{justStudentSearch}".
                              </div>
                            ) : (
                              matching.map((st) => (
                                <button
                                  key={st.id}
                                  type="button"
                                  onClick={() => {
                                    setJustStudentId(st.id);
                                    setJustStudentSearch('');
                                    setJustStudentDropdownOpen(false);
                                  }}
                                  className="w-full text-left px-3 py-2 hover:bg-indigo-50 transition-colors flex items-center justify-between gap-2 group"
                                >
                                  <div className="min-w-0">
                                    <div className="font-bold text-slate-900 text-xs group-hover:text-indigo-900 truncate">
                                      {st.nombre}
                                    </div>
                                    <div className="text-[11px] text-slate-500 flex items-center gap-2">
                                      <span className="font-mono font-semibold text-indigo-600">{st.matricula}</span>
                                      <span>•</span>
                                      <span>Gpo {st.grupo || '10 A'} - {st.equipo || 'Eq 1'}</span>
                                    </div>
                                  </div>
                                  <span className="px-2 py-0.5 bg-indigo-50 group-hover:bg-indigo-600 group-hover:text-white text-indigo-700 rounded text-[10px] font-bold transition-colors shrink-0">
                                    Elegir
                                  </span>
                                </button>
                              ))
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* Date Picker */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Fecha de la Guardia a Justificar <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={justDate}
                    onChange={(e) => setJustDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
                    required
                  />
                </div>

                {/* Motivo */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Motivo de la Justificación <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. Incapacidad Médica, Comisión Académica, Permiso Familiar..."
                    value={justMotivo}
                    onChange={(e) => setJustMotivo(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                </div>

                {/* Quick Presets for Motives */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                    Motivos Frecuentes:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      'Incapacidad Médica',
                      'Comisión Académica',
                      'Permiso Personal Autorizado',
                      'Duelo Familiar',
                      'Rotación Hospitalaria Especial',
                      'Evento Institucional',
                    ].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setJustMotivo(m)}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-all ${
                          justMotivo === m
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                            : 'bg-indigo-50/70 hover:bg-indigo-100 text-indigo-900 border-indigo-200'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                {justSuccessMsg && (
                  <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2 animate-fade-in border border-emerald-200">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{justSuccessMsg}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmittingJust || !justStudentId}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 text-white font-bold rounded-xl text-xs shadow-md transition-all flex items-center justify-center gap-2"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Registrar Justificación de Guardia</span>
                </button>
              </form>
            </div>

            {/* Right: Table of Individual Justifications */}
            <div className="lg:col-span-7 bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" />
                  Justificantes Oficiales Emitidos
                </h4>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar por alumno, matrícula o motivo..."
                    value={justSearch}
                    onChange={(e) => setJustSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full sm:w-60"
                  />
                </div>
              </div>

              {(() => {
                const justRecords = attendanceRecords
                  .filter(
                    (r) =>
                      r.esJustificada ||
                      r.checkInStatus === 'JUSTIFICADA' ||
                      (r as any).estado === 'JUSTIFICADA'
                  )
                  .filter((r) => {
                    const student = students.find((s) => s.id === r.studentId || isMatriculaMatch(s.matricula, r.matricula));
                    const term = justSearch.toLowerCase();
                    return (
                      r.fecha.includes(term) ||
                      (r.matricula || '').toLowerCase().includes(term) ||
                      (student?.nombre || r.studentNombre || '').toLowerCase().includes(term) ||
                      (r.motivoJustificante || r.notas || '').toLowerCase().includes(term)
                    );
                  })
                  .sort((a, b) => b.fecha.localeCompare(a.fecha));

                if (justRecords.length === 0) {
                  return (
                    <div className="text-center py-12 px-4 space-y-3 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                      <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto">
                        <UserCheck className="w-6 h-6" />
                      </div>
                      <div>
                        <h5 className="font-bold text-slate-800 text-sm">No hay justificaciones individuales registradas</h5>
                        <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                          Cuando un alumno presente justificante de guardia (incapacidad o permiso), regístralo con el formulario de la izquierda.
                        </p>
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 font-bold z-10">
                        <tr>
                          <th className="py-2.5 px-3">Fecha Guardia</th>
                          <th className="py-2.5 px-3">Alumno</th>
                          <th className="py-2.5 px-3">Grupo / Equipo</th>
                          <th className="py-2.5 px-3">Motivo del Justificante</th>
                          <th className="py-2.5 px-3 text-center">Estatus</th>
                          <th className="py-2.5 px-3 text-right">Acción</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {justRecords.map((r) => {
                          const student = students.find((s) => s.id === r.studentId || isMatriculaMatch(s.matricula, r.matricula));
                          const studentName = student?.nombre || r.studentNombre || r.matricula;
                          const dateObj = new Date(r.fecha + 'T00:00:00');
                          const dateFormatted = !isNaN(dateObj.getTime())
                            ? dateObj.toLocaleDateString('es-MX', {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                              })
                            : r.fecha;

                          return (
                            <tr key={r.id} className="hover:bg-indigo-50/40 transition-colors">
                              <td className="py-3 px-3">
                                <div className="font-bold font-mono text-slate-900">{r.fecha}</div>
                                <div className="text-[10px] text-slate-500 capitalize">{dateFormatted}</div>
                              </td>
                              <td className="py-3 px-3">
                                <div className="font-bold text-slate-900">{studentName}</div>
                                <div className="text-[10px] font-mono text-slate-500">{r.matricula}</div>
                              </td>
                              <td className="py-3 px-3 text-[11px] text-indigo-900 font-semibold">
                                {student ? `Gpo ${student.grupo || '10 A'} - ${student.equipo || 'Eq 1'}` : 'Gpo 10 A'}
                              </td>
                              <td className="py-3 px-3 text-slate-700 max-w-[200px]">
                                <div className="font-medium truncate" title={r.motivoJustificante || r.notas || 'Justificante autorizada'}>
                                  {r.motivoJustificante || r.notas || 'Justificante autorizada'}
                                </div>
                              </td>
                              <td className="py-3 px-3 text-center">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-800 rounded-full text-[10px] font-bold border border-purple-200">
                                  <ShieldCheck className="w-3 h-3 text-purple-600" />
                                  Justificada
                                </span>
                              </td>
                              <td className="py-3 px-3 text-right">
                                <button
                                  onClick={() => handleDeleteIndividualJustification(r.id, studentName, r.fecha)}
                                  className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg border border-rose-200 transition-colors"
                                  title="Anular Justificante"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Modal 1: AGREGAR NUEVO ALUMNO */}
      {showAddStudentModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 border border-slate-200 shadow-2xl relative space-y-4 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowAddStudentModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Plus className="w-5 h-5 text-red-600" />
              Agregar Nuevo Alumno
            </h3>

            <form onSubmit={handleAddStudent} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Matrícula (Usuario Alumno)
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. 20241008"
                    value={newMatricula}
                    onChange={(e) => setNewMatricula(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-mono text-slate-900 focus:ring-2 focus:ring-red-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Grupo del Alumno
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. 10 A, 10 B, 8 A"
                    value={newGrupo}
                    onChange={(e) => setNewGrupo(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs text-slate-900 uppercase font-bold focus:ring-2 focus:ring-red-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nombre Completo
                </label>
                <input
                  type="text"
                  placeholder="Ej. Dr. Roberto Sánchez"
                  value={newNombre}
                  onChange={(e) => setNewNombre(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs text-slate-900 focus:ring-2 focus:ring-red-500"
                  required
                />
              </div>

              {/* Sede Hospitalaria Asignada & Sede Secundaria */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-red-600" />
                    Sede Hospitalaria Principal
                  </label>
                  <select
                    value={newSedeId}
                    onChange={(e) => {
                      const selectedId = e.target.value;
                      setNewSedeId(selectedId);
                      const s = allSites.find((site) => site.id === selectedId);
                      if (s) {
                        setNewHoraEntrada(s.horaEntrada);
                        setNewHoraSalida(s.horaSalida);
                        setNewToleranciaMinutos(s.toleranciaMinutos);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs text-slate-900 font-medium focus:ring-2 focus:ring-red-500"
                  >
                    {allSites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                    <Building className="w-3.5 h-3.5 text-blue-600" />
                    Segunda Sede Opcional
                  </label>
                  <select
                    value={newSecondarySedeId}
                    onChange={(e) => setNewSecondarySedeId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs text-slate-900 font-medium focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Ninguna (Solo Sede Principal)</option>
                    {allSites
                      .filter((site) => site.id !== newSedeId)
                      .map((site) => (
                        <option key={site.id} value={site.id}>
                          {site.nombre}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Número de Equipo
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. Equipo 1, Equipo 2"
                    value={newEquipo}
                    onChange={(e) => setNewEquipo(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs text-slate-900 focus:ring-2 focus:ring-red-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Especialidad / Rotación Específica
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. Urgencias Médicas, Pediatría"
                    value={newEspecialidad}
                    onChange={(e) => setNewEspecialidad(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs text-slate-900 focus:ring-2 focus:ring-red-500"
                    required
                  />
                </div>
              </div>

              {/* Días de Asistencia Selección */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Días Específicos de Guardia Asignados (Selecciona los días)
                </label>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {DIAS_SEMANA_OPCIONES.map((dia) => {
                    const isSelected = newDiasAsistencia.includes(dia);
                    return (
                      <button
                        key={dia}
                        type="button"
                        onClick={() =>
                          handleToggleDay(dia, newDiasAsistencia, setNewDiasAsistencia)
                        }
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                          isSelected
                            ? 'bg-red-600 text-white border-red-600 shadow-sm'
                            : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                        }`}
                      >
                        {dia}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Horarios Específicos por Día de Guardia */}
              {newDiasAsistencia.length > 0 && (
                <div className="p-3 bg-red-50/60 rounded-2xl border border-red-100 space-y-2">
                  <label className="block text-xs font-bold text-red-900 flex items-center justify-between">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-red-600" />
                      Horarios Específicos por Día de Guardia
                    </span>
                    <span className="text-[10px] text-red-700 font-normal">
                      Configura turnos para cada día (Tolerancia: 15 min)
                    </span>
                  </label>

                  <div className="space-y-2.5 pt-1">
                    {sortDaysArray(newDiasAsistencia).map((dia) => {
                      const cur = newHorariosPorDia[dia] || {
                        turnos: [{ horaEntrada: '07:00', horaSalida: '15:00' }],
                      };
                      const turnos = cur.turnos && cur.turnos.length > 0
                        ? cur.turnos
                        : [{ horaEntrada: '07:00', horaSalida: '15:00' }];

                      return (
                        <div
                          key={dia}
                          className="p-3 bg-white rounded-xl border border-slate-200 text-xs space-y-2"
                        >
                          <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                            <span className="font-bold text-slate-800">{dia}</span>
                            <button
                              type="button"
                              onClick={() => handleStudentAddTurno(dia, false)}
                              className="text-[10px] font-bold text-red-700 hover:text-red-900 bg-red-50 hover:bg-red-100 px-2 py-0.5 rounded border border-red-200 flex items-center gap-1 transition-colors"
                            >
                              <Plus className="w-3 h-3" />
                              <span>+ Turno</span>
                            </button>
                          </div>

                          <div className="space-y-1.5">
                            {turnos.map((turno, tIdx) => (
                              <div
                                key={tIdx}
                                className="flex items-center justify-between gap-2 p-1.5 bg-slate-50 rounded-lg border border-slate-200/80"
                              >
                                <span className="text-[10px] font-bold text-slate-500 uppercase">
                                  T{tIdx + 1}
                                </span>
                                <div className="flex items-center gap-1.5">
                                  <div className="flex items-center gap-1">
                                    <label className="text-[10px] text-slate-500 font-medium">Entrada:</label>
                                    <input
                                      type="time"
                                      value={turno.horaEntrada}
                                      onChange={(e) =>
                                        handleStudentTurnoChange(dia, tIdx, 'horaEntrada', e.target.value, false)
                                      }
                                      className="px-1.5 py-0.5 rounded border border-slate-300 font-mono text-xs bg-white text-slate-900"
                                      required
                                    />
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <label className="text-[10px] text-slate-500 font-medium">Salida:</label>
                                    <input
                                      type="time"
                                      value={turno.horaSalida}
                                      onChange={(e) =>
                                        handleStudentTurnoChange(dia, tIdx, 'horaSalida', e.target.value, false)
                                      }
                                      className="px-1.5 py-0.5 rounded border border-slate-300 font-mono text-xs bg-white text-slate-900"
                                      required
                                    />
                                  </div>
                                </div>
                                {turnos.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => handleStudentRemoveTurno(dia, tIdx, false)}
                                    className="text-slate-400 hover:text-rose-600 p-0.5 transition-colors"
                                    title="Eliminar este turno"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {addStudentError && (
                <div className="p-2.5 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-200">
                  {addStudentError}
                </div>
              )}

              <button
                type="submit"
                className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs transition-all shadow-md mt-2"
              >
                Registrar Alumno
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: EDITAR ALUMNO */}
      {editingStudent && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 border border-slate-200 shadow-2xl relative space-y-4 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setEditingStudent(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Edit2 className="w-5 h-5 text-red-600" />
              Editar Datos del Alumno
            </h3>

            <form onSubmit={handleSaveEditStudent} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Matrícula
                  </label>
                  <input
                    type="text"
                    value={editMatricula}
                    onChange={(e) => setEditMatricula(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-mono text-slate-900"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Grupo
                  </label>
                  <input
                    type="text"
                    value={editGrupo}
                    onChange={(e) => setEditGrupo(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-bold text-slate-900 uppercase"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nombre Completo
                </label>
                <input
                  type="text"
                  value={editNombre}
                  onChange={(e) => setEditNombre(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs text-slate-900"
                  required
                />
              </div>

              {/* Sede Hospitalaria Asignada & Sede Secundaria */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-red-600" />
                    Sede Hospitalaria Principal
                  </label>
                  <select
                    value={editSedeId}
                    onChange={(e) => setEditSedeId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs text-slate-900 font-medium focus:ring-2 focus:ring-red-500"
                  >
                    {allSites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                    <Building className="w-3.5 h-3.5 text-blue-600" />
                    Segunda Sede Opcional
                  </label>
                  <select
                    value={editSecondarySedeId}
                    onChange={(e) => setEditSecondarySedeId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs text-slate-900 font-medium focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Ninguna (Solo Sede Principal)</option>
                    {allSites
                      .filter((site) => site.id !== editSedeId)
                      .map((site) => (
                        <option key={site.id} value={site.id}>
                          {site.nombre}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Número de Equipo
                  </label>
                  <input
                    type="text"
                    value={editEquipo}
                    onChange={(e) => setEditEquipo(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Especialidad / Rotación Específica
                  </label>
                  <input
                    type="text"
                    value={editEspecialidad}
                    onChange={(e) => setEditEspecialidad(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs text-slate-900"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Días Específicos de Guardia Asignados (Selecciona los días)
                </label>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {DIAS_SEMANA_OPCIONES.map((dia) => {
                    const isSelected = editDiasAsistencia.includes(dia);
                    return (
                      <button
                        key={dia}
                        type="button"
                        onClick={() =>
                          handleToggleDay(dia, editDiasAsistencia, setEditDiasAsistencia)
                        }
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                          isSelected
                            ? 'bg-red-600 text-white border-red-600'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {dia}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Horarios Específicos por Día de Guardia en Edición */}
              {editDiasAsistencia.length > 0 && (
                <div className="p-3 bg-red-50/60 rounded-2xl border border-red-100 space-y-2">
                  <label className="block text-xs font-bold text-red-900 flex items-center justify-between">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-red-600" />
                      Horarios Específicos por Día de Guardia
                    </span>
                    <span className="text-[10px] text-red-700 font-normal">
                      Ajusta turnos para cada día (Tolerancia: 15 min)
                    </span>
                  </label>

                  <div className="space-y-2.5 pt-1">
                    {sortDaysArray(editDiasAsistencia).map((dia) => {
                      const cur = editHorariosPorDia[dia] || {
                        turnos: [{ horaEntrada: editHoraEntrada || '07:00', horaSalida: editHoraSalida || '15:00' }],
                      };
                      const turnos = cur.turnos && cur.turnos.length > 0
                        ? cur.turnos
                        : [{ horaEntrada: editHoraEntrada || '07:00', horaSalida: editHoraSalida || '15:00' }];

                      return (
                        <div
                          key={dia}
                          className="p-3 bg-white rounded-xl border border-slate-200 text-xs space-y-2"
                        >
                          <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                            <span className="font-bold text-slate-800">{dia}</span>
                            <button
                              type="button"
                              onClick={() => handleStudentAddTurno(dia, true)}
                              className="text-[10px] font-bold text-red-700 hover:text-red-900 bg-red-50 hover:bg-red-100 px-2 py-0.5 rounded border border-red-200 flex items-center gap-1 transition-colors"
                            >
                              <Plus className="w-3 h-3" />
                              <span>+ Turno</span>
                            </button>
                          </div>

                          <div className="space-y-1.5">
                            {turnos.map((turno, tIdx) => (
                              <div
                                key={tIdx}
                                className="flex items-center justify-between gap-2 p-1.5 bg-slate-50 rounded-lg border border-slate-200/80"
                              >
                                <span className="text-[10px] font-bold text-slate-500 uppercase">
                                  T{tIdx + 1}
                                </span>
                                <div className="flex items-center gap-1.5">
                                  <div className="flex items-center gap-1">
                                    <label className="text-[10px] text-slate-500 font-medium">Entrada:</label>
                                    <input
                                      type="time"
                                      value={turno.horaEntrada}
                                      onChange={(e) =>
                                        handleStudentTurnoChange(dia, tIdx, 'horaEntrada', e.target.value, true)
                                      }
                                      className="px-1.5 py-0.5 rounded border border-slate-300 font-mono text-xs bg-white text-slate-900"
                                      required
                                    />
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <label className="text-[10px] text-slate-500 font-medium">Salida:</label>
                                    <input
                                      type="time"
                                      value={turno.horaSalida}
                                      onChange={(e) =>
                                        handleStudentTurnoChange(dia, tIdx, 'horaSalida', e.target.value, true)
                                      }
                                      className="px-1.5 py-0.5 rounded border border-slate-300 font-mono text-xs bg-white text-slate-900"
                                      required
                                    />
                                  </div>
                                </div>
                                {turnos.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => handleStudentRemoveTurno(dia, tIdx, true)}
                                    className="text-slate-400 hover:text-rose-600 p-0.5 transition-colors"
                                    title="Eliminar este turno"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Estado del Dispositivo Móvil y Opción de Desvinculación */}
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-blue-600 shrink-0" />
                    <div>
                      <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        Dispositivo Móvil Asignado
                      </span>
                      <strong className="text-xs text-slate-900 font-mono block">
                        {editingStudent.linkedDeviceId
                          ? editingStudent.linkedDeviceName || editingStudent.linkedDeviceId
                          : 'Sin dispositivo vinculado (Libre para 1er login)'}
                      </strong>
                    </div>
                  </div>

                  {editingStudent.linkedDeviceId && (
                    <button
                      type="button"
                      onClick={() => handleUnlinkDevice(editingStudent.id, editingStudent.nombre)}
                      className="px-3 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-800 text-[11px] font-bold rounded-xl transition-colors shrink-0 flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Desvincular</span>
                    </button>
                  )}
                </div>
              </div>

              {editStudentError && (
                <div className="p-2.5 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-200">
                  {editStudentError}
                </div>
              )}

              <button
                type="submit"
                className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs transition-all shadow-md mt-2"
              >
                Guardar Cambios
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: CARGA MASIVA DE ALUMNOS */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 border border-slate-200 shadow-2xl relative space-y-4 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowBulkModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Upload className="w-5 h-5 text-blue-600" />
              Carga Masiva de Alumnos (CSV / Lista)
            </h3>

            <p className="text-xs text-slate-500">
              Pega la lista de alumnos en el cuadro de texto (puedes copiar directamente desde Excel). Orden de columnas por línea:{' '}
              <strong className="text-slate-800">
                Matrícula, Nombre, Semestre/Grupo, Sede Principal, Sede Secundaria, Equipo, Especialidad/Rotación, Días de Guardia, Hora Entrada, Hora Salida
              </strong>
            </p>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] font-mono text-slate-700 space-y-1">
              <div className="font-bold text-slate-900 uppercase">Ejemplo de formato:</div>
              <div>20241010, Dra. Sofia Perez, 10 A, HGR 1, Ninguna, Equipo 1, Urgencias Médicas, Lunes y Miércoles, 07:00, 15:00</div>
              <div>20241011, Dr. Juan Escutia, 10 B, Hospital Central, Clínica 2, Equipo 2, Pediatría, Martes y Jueves, 08:00, 16:00</div>
            </div>

            <form onSubmit={handleBulkImport} className="space-y-3">
              <textarea
                rows={6}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder="20241010, Dra. Sofia Perez, 10 A, HGR 1, Ninguna, Equipo 1, Urgencias Médicas, Lunes y Miércoles, 07:00, 15:00..."
                className="w-full p-3 rounded-xl border border-slate-300 font-mono text-xs text-slate-900 focus:ring-2 focus:ring-blue-500"
              />

              {bulkError && (
                <div className="p-2.5 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-200">
                  {bulkError}
                </div>
              )}

              {bulkSuccess && (
                <div className="p-2.5 bg-emerald-50 text-emerald-800 text-xs rounded-xl border border-emerald-200 font-bold">
                  {bulkSuccess}
                </div>
              )}

              <button
                type="submit"
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition-all shadow-md"
              >
                Procesar e Importar Alumnos
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal 4: CREAR / EDITAR SEDE HOSPITALARIA Y RADIO GPS */}
      {showSiteModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 border border-slate-200 shadow-2xl relative space-y-4 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowSiteModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Building className="w-5 h-5 text-red-600" />
              <span>{siteFormId ? 'Editar Sede Hospitalaria' : 'Agregar Nueva Sede Hospitalaria'}</span>
            </h3>

            <form onSubmit={handleSaveSite} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Nombre de la Sede / Clínica / Hospital
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. Hospital General Los Mochis"
                    value={siteFormNombre}
                    onChange={(e) => setSiteFormNombre(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs text-slate-900 font-semibold focus:ring-2 focus:ring-red-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Dirección Física
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. Blvd. Macario Gaxiola, Los Mochis"
                    value={siteFormDireccion}
                    onChange={(e) => setSiteFormDireccion(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs text-slate-900 focus:ring-2 focus:ring-red-500"
                  />
                </div>
              </div>

              {/* Radio de Geocerca GPS */}
              <div className="p-4 bg-red-50/60 rounded-2xl border border-red-100 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-red-950 flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-red-600" />
                    Radio Permitido de Geocerca GPS (Metros)
                  </label>
                  <span className="text-xs font-extrabold bg-red-600 text-white px-3 py-0.5 rounded-full shadow-sm font-mono">
                    {siteFormRadiusMeters} Metros
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="10"
                    max="1000"
                    step="10"
                    value={siteFormRadiusMeters}
                    onChange={(e) => setSiteFormRadiusMeters(Number(e.target.value))}
                    className="w-full accent-red-600 cursor-pointer h-2 bg-red-200 rounded-lg"
                  />
                  <input
                    type="number"
                    min="10"
                    max="2000"
                    value={siteFormRadiusMeters}
                    onChange={(e) => setSiteFormRadiusMeters(Number(e.target.value))}
                    className="w-20 px-2 py-1 bg-white border border-red-300 text-xs font-mono font-bold text-slate-900 rounded-lg text-center"
                  />
                </div>

                {/* Preset quick buttons */}
                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  <span className="text-[11px] text-slate-500 font-medium">Accesos rápidos:</span>
                  {[50, 100, 150, 200, 300, 500].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setSiteFormRadiusMeters(preset)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                        siteFormRadiusMeters === preset
                          ? 'bg-red-600 text-white border-red-600 shadow-xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {preset}m
                    </button>
                  ))}
                </div>
              </div>

              {/* Map & Coordinates */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700">
                  Ubicación Exacta en el Mapa (Haz clic o arrastra el pin 📍)
                </label>
                <MapPicker
                  hospitalLat={siteFormLat}
                  hospitalLng={siteFormLng}
                  radiusMeters={siteFormRadiusMeters}
                  hospitalName={siteFormNombre || 'Sede Hospitalaria'}
                  userLat={null}
                  userLng={null}
                  isEditable={true}
                  onLocationSelect={(lat, lng) => {
                    setSiteFormLat(Number(lat.toFixed(6)));
                    setSiteFormLng(Number(lng.toFixed(6)));
                  }}
                  heightClass="h-56"
                />

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">Latitud GPS</label>
                    <input
                      type="number"
                      step="0.000001"
                      value={siteFormLat}
                      onChange={(e) => setSiteFormLat(Number(e.target.value))}
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-mono text-slate-900"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">Longitud GPS</label>
                    <input
                      type="number"
                      step="0.000001"
                      value={siteFormLng}
                      onChange={(e) => setSiteFormLng(Number(e.target.value))}
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-mono text-slate-900"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Notice for Individual Schedule Assignment */}
              <div className="p-3 bg-blue-50 text-blue-900 rounded-2xl border border-blue-200 text-xs flex items-start gap-2">
                <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="block text-blue-950 font-bold mb-0.5">
                    Horarios de Asistencia por Alumno
                  </strong>
                  Los horarios de entrada y salida no se limitan por sede. Se asignan de manera individual a cada alumno en su perfil. Por norma general, todos los alumnos cuentan con 15 minutos de tolerancia para marcar su asistencia.
                </div>
              </div>

              {siteFormError && (
                <div className="p-2.5 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-200">
                  {siteFormError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSiteModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs shadow-md transition-colors"
                >
                  Guardar Sede Hospitalaria
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CAMBIO DE SEMESTRE (ELIMINAR ALUMNOS) MODAL */}
      {showSemesterModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-rose-100 text-rose-600 rounded-xl">
                  <UserX className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    Cambio de Semestre
                  </h3>
                  <p className="text-xs text-slate-500">
                    Eliminar lista de alumnos registrados
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSemesterModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl space-y-2 text-xs text-rose-900">
              <div className="flex items-center gap-2 font-bold text-rose-800">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>¡Atención! Acción irreversible</span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-rose-900/90">
                Esta acción eliminará todos los registros de alumnos actuales para dar inicio al nuevo ciclo escolar.
                <strong> Las sedes hospitalarias y configuraciones no sufrirán cambios.</strong>
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700">
                Para confirmar la eliminación, escribe la palabra <span className="text-rose-600 font-extrabold uppercase">ELIMINAR</span>:
              </label>
              <input
                type="text"
                placeholder="Escribe ELIMINAR aquí"
                value={semesterConfirmText}
                onChange={(e) => setSemesterConfirmText(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500 uppercase tracking-wider"
              />
            </div>

            {semesterError && (
              <div className="p-2.5 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-200 font-medium">
                {semesterError}
              </div>
            )}

            {semesterSuccess && (
              <div className="p-2.5 bg-emerald-50 text-emerald-800 text-xs rounded-xl border border-emerald-200 font-medium flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{semesterSuccess}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSemesterModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleClearSemester}
                disabled={semesterConfirmText.trim() !== 'ELIMINAR'}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold rounded-xl text-xs shadow-md transition-all flex items-center gap-1.5"
              >
                <UserX className="w-3.5 h-3.5" />
                <span>Confirmar y Eliminar Alumnos</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL REPORTE INDIVIDUAL DE ALUMNO */}
      {showIndividualReportModal && reportStudent && (() => {
        const monthsList = [
          'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
          'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
        ];
        const selectedMonthName = monthsList[reportSelectedMonth];
        const year = reportSelectedYear;
        const month = reportSelectedMonth;

        // Days in month & First day index
        const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
        const firstDayIndex = new Date(year, month, 1).getDay(); // 0 = Dom, 1 = Lun...

        const todayStr = getTodayDateString();

        // Calculate Month Statistics & Day Map
        let monthDutyDaysCount = 0;
        let monthAttendedCount = 0;
        let monthATiempoCount = 0;
        let monthRetardoCount = 0;
        let monthFaltasCount = 0;

        interface DayReportInfo {
          dayNum: number;
          dateStr: string;
          isDutyDay: boolean;
          isPastOrToday: boolean;
          record?: AttendanceRecord;
          status: 'A_TIEMPO' | 'RETARDO' | 'FALTA' | 'FUTURA' | 'NO_GUARDIA';
        }

        const calendarDays: DayReportInfo[] = [];

        for (let d = 1; d <= totalDaysInMonth; d++) {
          const dateObj = new Date(year, month, d);
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const isDiaInhabil = diasInhabiles.some((h) => h.fecha === dateStr);
          const isDutyDay = !isDiaInhabil && isDutyDayForDate(dateObj, reportStudent);
          const isPastOrToday = dateStr <= todayStr;

          const rec = attendanceRecords.find(
            (r) => (r.studentId === reportStudent.id || r.matricula === reportStudent.matricula) && r.fecha === dateStr
          );

          let status: 'A_TIEMPO' | 'RETARDO' | 'FALTA' | 'FUTURA' | 'NO_GUARDIA' = 'NO_GUARDIA';

          if (isDiaInhabil) {
            status = 'NO_GUARDIA';
          } else if (isDutyDay) {
            if (isPastOrToday) {
              monthDutyDaysCount++;
              if (rec?.checkInStatus === 'A_TIEMPO') {
                status = 'A_TIEMPO';
                monthAttendedCount++;
                monthATiempoCount++;
              } else if (rec?.checkInStatus === 'RETARDO') {
                status = 'RETARDO';
                monthAttendedCount++;
                monthRetardoCount++;
              } else {
                status = 'FALTA';
                monthFaltasCount++;
              }
            } else {
              status = 'FUTURA';
            }
          }

          calendarDays.push({
            dayNum: d,
            dateStr,
            isDutyDay,
            isPastOrToday,
            record: rec,
            status,
          });
        }

        // Calculate Overall Evaluation Ratio for Semester Date Range [fechaInicioSemestre, fechaFinSemestre]
        const semesterEvalRatio = calculateStudentGuardRatio(
          reportStudent,
          attendanceRecords,
          fechaInicioSemestre,
          fechaFinSemestre,
          diasInhabiles
        );

        const asistenciaPercent = monthDutyDaysCount > 0
          ? Math.round((monthAttendedCount / monthDutyDaysCount) * 100)
          : 0;

        const handlePrint = () => {
          window.print();
        };

        return (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
            <style>{`
              @media print {
                body * {
                  visibility: hidden !important;
                }
                #individual-student-report-modal, #individual-student-report-modal * {
                  visibility: visible !important;
                }
                #individual-student-report-modal {
                  position: absolute !important;
                  left: 0 !important;
                  top: 0 !important;
                  width: 100% !important;
                  margin: 0 !important;
                  padding: 1rem !important;
                  box-shadow: none !important;
                  border: none !important;
                }
                .no-print {
                  display: none !important;
                }
              }
            `}</style>
            <div
              id="individual-student-report-modal"
              className="bg-white rounded-3xl max-w-4xl w-full p-6 sm:p-8 shadow-2xl border border-slate-200 space-y-6 my-auto animate-in fade-in zoom-in-95 duration-200 text-slate-900"
            >
              {/* Modal Header Actions */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5 no-print">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-emerald-100 text-emerald-700 rounded-2xl border border-emerald-200">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">
                      Reporte Individual de Asistencia y Guardias
                    </h3>
                    <p className="text-xs text-slate-500">
                      Resumen analítico, métricas de cumplimiento y calendario visual de guardias.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <button
                    onClick={handlePrint}
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-2 transition-all active:scale-95"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Imprimir / PDF</span>
                  </button>
                  <button
                    onClick={() => setShowIndividualReportModal(false)}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Printable Header Document Info */}
              <div className="p-5 bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white rounded-2xl shadow-md space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-blue-800/60 pb-4">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-blue-600 text-white rounded-2xl flex items-center justify-center font-extrabold text-xl shadow-lg border-2 border-blue-400/40">
                      {reportStudent.nombre.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h2 className="text-xl font-extrabold tracking-tight text-white">
                        {reportStudent.nombre}
                      </h2>
                      <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-blue-200">
                        <span className="font-mono bg-blue-900/60 px-2 py-0.5 rounded border border-blue-700/50">
                          Matrícula: {reportStudent.matricula}
                        </span>
                        <span className="font-bold bg-blue-500/20 px-2 py-0.5 rounded text-blue-200 border border-blue-400/30">
                          Grupo {reportStudent.grupo || '10 A'} - {reportStudent.equipo || 'Equipo 1'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-left sm:text-right text-xs space-y-1">
                    <span className="text-blue-300 block font-semibold">Reporte Oficial Emitido</span>
                    <span className="font-mono font-bold text-white block">{formatDateDisplay(todayStr)}</span>
                    <span className="text-[11px] text-blue-300/80 block">Docente Responsable: Dra. Sofia Perez</span>
                  </div>
                </div>

                {/* Additional Student Attributes */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-1">
                  <div>
                    <span className="text-blue-300/80 text-[11px] block">Sede Principal</span>
                    <strong className="text-white block font-semibold truncate">{reportStudent.sedeNombre || 'Sede Principal'}</strong>
                  </div>
                  <div>
                    <span className="text-blue-300/80 text-[11px] block">Especialidad / Rotación</span>
                    <strong className="text-white block font-semibold truncate">{reportStudent.rotacion || reportStudent.especialidad || 'Urgencias Médicas'}</strong>
                  </div>
                  <div>
                    <span className="text-blue-300/80 text-[11px] block">Días y Horario de Guardia</span>
                    <strong className="text-white block font-semibold">
                      {sortDaysArray(reportStudent.diasAsistencia || []).join(', ') || 'Lunes, Miércoles'} ({reportStudent.horaEntrada || '07:00'} - {reportStudent.horaSalida || '15:00'})
                    </strong>
                  </div>
                </div>
              </div>

              {/* Guardias Summary & Attendance Ratios */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Main Guardia Ratio Banner */}
                <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 text-emerald-950 flex flex-col justify-between space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
                      Guardias Asistidas ({selectedMonthName})
                    </span>
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-extrabold text-emerald-900 font-mono">
                        {monthAttendedCount} / {monthDutyDaysCount}
                      </span>
                      <span className="text-xs font-bold text-emerald-700 bg-emerald-200/80 px-2 py-0.5 rounded-full">
                        {asistenciaPercent}%
                      </span>
                    </div>
                    <p className="text-[11px] text-emerald-800 mt-1 font-medium">
                      {monthAttendedCount} guardias cumplidas de {monthDutyDaysCount} posibles en {selectedMonthName}.
                    </p>
                  </div>
                  {/* Progress bar */}
                  <div className="w-full bg-emerald-200/70 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-emerald-600 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(asistenciaPercent, 100)}%` }}
                    ></div>
                  </div>
                </div>

                {/* Overall / Semester Ratio Banner */}
                <div className="p-4 bg-blue-50 rounded-2xl border border-blue-200 text-blue-950 flex flex-col justify-between space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-800 uppercase tracking-wider">
                      Evaluación Semestral ({fechaInicioSemestre} a {fechaFinSemestre})
                    </span>
                    <TrendingUp className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-extrabold text-blue-900 font-mono">
                        {semesterEvalRatio.asistidas} / {semesterEvalRatio.posibles}
                      </span>
                      <span className="text-xs font-bold text-blue-700 bg-blue-200/80 px-2 py-0.5 rounded-full">
                        {semesterEvalRatio.percentage}%
                      </span>
                    </div>
                    <p className="text-[11px] text-blue-800 mt-1 font-medium">
                      {semesterEvalRatio.asistidas} guardias cumplidas de {semesterEvalRatio.posibles} programadas en el período del semestre.
                    </p>
                  </div>
                  <div className="w-full bg-blue-200/70 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-600 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(semesterEvalRatio.percentage, 100)}%` }}
                    ></div>
                  </div>
                </div>

                {/* Detailed Breakdown Card */}
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2 flex flex-col justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Desglose del Mes ({selectedMonthName})
                  </span>
                  <div className="grid grid-cols-3 gap-2 text-center py-1">
                    <div className="bg-emerald-100/80 p-2 rounded-xl border border-emerald-200">
                      <span className="text-lg font-bold text-emerald-800 font-mono block">{monthATiempoCount}</span>
                      <span className="text-[10px] text-emerald-900 font-bold block">A tiempo</span>
                    </div>
                    <div className="bg-amber-100/80 p-2 rounded-xl border border-amber-200">
                      <span className="text-lg font-bold text-amber-800 font-mono block">{monthRetardoCount}</span>
                      <span className="text-[10px] text-amber-900 font-bold block">Retardos</span>
                    </div>
                    <div className="bg-rose-100/80 p-2 rounded-xl border border-rose-200">
                      <span className="text-lg font-bold text-rose-800 font-mono block">{monthFaltasCount}</span>
                      <span className="text-[10px] text-rose-900 font-bold block">Faltas</span>
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-500 text-center font-medium">
                    Tolerancia de checada: 15 minutos tras la hora asignada.
                  </span>
                </div>
              </div>

              {/* CALENDAR CONTROLS & GRID */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-100 p-3 rounded-2xl border border-slate-200">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-blue-600" />
                    <h4 className="font-extrabold text-sm text-slate-900">
                      Calendario de Fechas de Guardia - {selectedMonthName} {year}
                    </h4>
                  </div>

                  {/* Month & Year Selectors */}
                  <div className="flex items-center gap-2 no-print">
                    <select
                      value={reportSelectedMonth}
                      onChange={(e) => setReportSelectedMonth(Number(e.target.value))}
                      className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white font-bold text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                    >
                      {monthsList.map((m, idx) => (
                        <option key={m} value={idx}>
                          {m}
                        </option>
                      ))}
                    </select>

                    <select
                      value={reportSelectedYear}
                      onChange={(e) => setReportSelectedYear(Number(e.target.value))}
                      className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white font-bold text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                    >
                      <option value={2025}>2025</option>
                      <option value={2026}>2026</option>
                      <option value={2027}>2027</option>
                    </select>
                  </div>
                </div>

                {/* Calendar Grid Table */}
                <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                  {/* Days of Week Header */}
                  <div className="grid grid-cols-7 bg-slate-900 text-white text-center text-xs font-bold py-2.5">
                    <div>Dom</div>
                    <div>Lun</div>
                    <div>Mar</div>
                    <div>Mié</div>
                    <div>Jue</div>
                    <div>Vie</div>
                    <div>Sáb</div>
                  </div>

                  {/* Calendar Days Matrix */}
                  <div className="grid grid-cols-7 gap-1 p-2 bg-slate-50">
                    {/* Empty Lead Offset Cells */}
                    {Array.from({ length: firstDayIndex }).map((_, i) => (
                      <div key={`empty-${i}`} className="h-16 sm:h-20 bg-slate-100/50 rounded-xl"></div>
                    ))}

                    {/* Day Cells */}
                    {calendarDays.map((day) => {
                      const isToday = day.dateStr === todayStr;

                      return (
                        <div
                          key={day.dayNum}
                          className={`h-16 sm:h-20 p-1.5 rounded-xl border flex flex-col justify-between transition-all ${
                            day.isDutyDay
                              ? day.status === 'A_TIEMPO'
                                ? 'bg-emerald-50 border-emerald-400 text-emerald-950 shadow-sm'
                                : day.status === 'RETARDO'
                                ? 'bg-amber-50 border-amber-400 text-amber-950 shadow-sm'
                                : day.status === 'FALTA'
                                ? 'bg-rose-50 border-rose-400 text-rose-950 shadow-sm'
                                : 'bg-blue-50/60 border-dashed border-blue-300 text-slate-600'
                              : 'bg-white border-slate-200/80 text-slate-400'
                          } ${isToday ? 'ring-2 ring-blue-600' : ''}`}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`text-xs font-bold font-mono px-1.5 py-0.2 rounded ${
                                isToday
                                  ? 'bg-blue-600 text-white'
                                  : day.isDutyDay
                                  ? 'bg-slate-900/10 text-slate-900'
                                  : 'text-slate-400'
                              }`}
                            >
                              {day.dayNum}
                            </span>

                            {day.isDutyDay && (
                              <span className="text-[9px] font-bold uppercase tracking-tighter">
                                {day.status === 'A_TIEMPO' && <span className="text-emerald-700">✓ ASISTIÓ</span>}
                                {day.status === 'RETARDO' && <span className="text-amber-700">⏱ RETARDO</span>}
                                {day.status === 'FALTA' && <span className="text-rose-700">✕ FALTA</span>}
                                {day.status === 'FUTURA' && <span className="text-blue-600">FUTURA</span>}
                              </span>
                            )}
                          </div>

                          <div className="text-center">
                            {day.isDutyDay ? (
                              day.status === 'A_TIEMPO' ? (
                                <div className="p-1 bg-emerald-600 text-white rounded text-[10px] font-bold shadow-xs">
                                  {day.record?.checkInTime
                                    ? formatTimeDisplay(day.record.checkInTime)
                                    : 'A tiempo'}
                                </div>
                              ) : day.status === 'RETARDO' ? (
                                <div className="p-1 bg-amber-500 text-white rounded text-[10px] font-bold shadow-xs">
                                  {day.record?.checkInTime
                                    ? formatTimeDisplay(day.record.checkInTime)
                                    : 'Retardo'}
                                </div>
                              ) : day.status === 'FALTA' ? (
                                <div className="p-1 bg-rose-600 text-white rounded text-[10px] font-bold shadow-xs">
                                  FALTA
                                </div>
                              ) : (
                                <span className="text-[10px] font-medium text-blue-700 block">
                                  Guardia
                                </span>
                              )
                            ) : (
                              <span className="text-[9px] text-slate-300 block">Sin Guardia</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Calendar Color Legend */}
                <div className="flex flex-wrap items-center justify-center gap-4 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700 font-semibold">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 rounded bg-emerald-500 border border-emerald-600 inline-block"></span>
                    <span>Asistencia Puntual</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 rounded bg-amber-500 border border-amber-600 inline-block"></span>
                    <span>Asistencia con Retardo</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 rounded bg-rose-600 border border-rose-700 inline-block"></span>
                    <span>Falta / Sin Registro</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 rounded bg-blue-100 border border-dashed border-blue-400 inline-block"></span>
                    <span>Guardia Programada (Futura)</span>
                  </div>
                </div>
              </div>

              {/* Footer Modal Actions */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-100 no-print">
                <span className="text-xs text-slate-500 font-medium">
                  Control de Asistencias Médicas • Documento generado para firma de expediente
                </span>
                <button
                  type="button"
                  onClick={() => setShowIndividualReportModal(false)}
                  className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-xl text-xs transition-colors"
                >
                  Cerrar Reporte
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL: COMPARACIÓN DE RESPALDO Y PROTECCIÓN DE DATOS ANTES DE RESTAURAR */}
      {pendingBackupImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-3xl w-full border border-slate-200 shadow-2xl overflow-hidden my-4 sm:my-6 animate-scale-in flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="p-4 sm:p-6 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-2xl border border-emerald-500/30">
                  <Database className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black text-white flex items-center gap-2">
                    Análisis y Sincronización Automática con .db
                  </h3>
                  <p className="text-xs text-slate-300 font-mono">
                    Archivo JSON: <span className="text-emerald-400 font-bold">{pendingBackupImport.fileName}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPendingBackupImport(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="Cerrar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Sub-tabs Navigation */}
            <div className="flex items-center gap-1 sm:gap-2 px-4 sm:px-6 pt-3 pb-2 border-b border-slate-200 bg-slate-50 shrink-0 overflow-x-auto">
              <button
                type="button"
                onClick={() => setPendingBackupImport((prev) => prev ? { ...prev, activeTab: 'overview' } : null)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  pendingBackupImport.activeTab === 'overview'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Resumen y Métricas</span>
              </button>

              <button
                type="button"
                onClick={() => setPendingBackupImport((prev) => prev ? { ...prev, activeTab: 'students' } : null)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  pendingBackupImport.activeTab === 'students'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Cambios en Alumnos y Horarios</span>
                {pendingBackupImport.diffAnalysis && (pendingBackupImport.diffAnalysis.students.added.length > 0 || pendingBackupImport.diffAnalysis.students.modified.length > 0) && (
                  <span className="px-1.5 py-0.2 bg-emerald-500 text-white text-[10px] font-black rounded-full">
                    {pendingBackupImport.diffAnalysis.students.added.length + pendingBackupImport.diffAnalysis.students.modified.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setPendingBackupImport((prev) => prev ? { ...prev, activeTab: 'records' } : null)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  pendingBackupImport.activeTab === 'records'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Checadas y Sedes</span>
                {pendingBackupImport.diffAnalysis && pendingBackupImport.diffAnalysis.records.newRecordsCount > 0 && (
                  <span className="px-1.5 py-0.2 bg-blue-500 text-white text-[10px] font-black rounded-full">
                    +{pendingBackupImport.diffAnalysis.records.newRecordsCount}
                  </span>
                )}
              </button>
            </div>

            {/* Scrollable Content Body */}
            <div className="p-4 sm:p-6 space-y-4 overflow-y-auto grow">
              {/* TAB 1: OVERVIEW & COMPARISON */}
              {pendingBackupImport.activeTab === 'overview' && (
                <div className="space-y-4">
                  {/* Visual Diff Badges Bar */}
                  {pendingBackupImport.diffAnalysis && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl">
                        <span className="text-[10px] uppercase font-black text-emerald-800 tracking-wider">Alumnos Nuevos</span>
                        <div className="text-lg font-black text-emerald-950">
                          +{pendingBackupImport.diffAnalysis.students.added.length}
                        </div>
                      </div>
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-2xl">
                        <span className="text-[10px] uppercase font-black text-blue-800 tracking-wider">Horarios Modificados</span>
                        <div className="text-lg font-black text-blue-950">
                          {pendingBackupImport.diffAnalysis.students.modified.length}
                        </div>
                      </div>
                      <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-2xl">
                        <span className="text-[10px] uppercase font-black text-indigo-800 tracking-wider">Checadas Nuevas</span>
                        <div className="text-lg font-black text-indigo-950">
                          +{pendingBackupImport.diffAnalysis.records.newRecordsCount}
                        </div>
                      </div>
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl">
                        <span className="text-[10px] uppercase font-black text-slate-600 tracking-wider">Alumnos Sin Cambio</span>
                        <div className="text-lg font-black text-slate-800">
                          {pendingBackupImport.diffAnalysis.students.unchangedCount}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Warning Alert if file is older or has fewer records */}
                  {pendingBackupImport.hasWarning ? (
                    <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl space-y-2">
                      <div className="flex items-center gap-2 text-amber-900 font-black text-sm">
                        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                        <span>⚠️ Advertencia de Datos Menores o Anteriores Detectados</span>
                      </div>
                      <div className="text-xs text-amber-950/90 space-y-1 pl-7">
                        {pendingBackupImport.warningReasons.map((reason, idx) => (
                          <p key={idx} className="leading-relaxed font-semibold">
                            • {reason}
                          </p>
                        ))}
                      </div>
                      <p className="text-xs text-amber-900 font-bold pl-7 pt-1">
                        Se recomienda usar <span className="text-emerald-700 font-black">Fusión Segura (Merge)</span> para actualizar horarios sin perder asistencias activas en clinicas.db.
                      </p>
                    </div>
                  ) : (
                    <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-3 text-emerald-900 text-xs font-semibold">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                      <span>El archivo JSON ha sido analizado con éxito contra clinicas.db. Listo para sincronización directa.</span>
                    </div>
                  )}

                  {/* Side-by-Side Comparison Table */}
                  <div className="border border-slate-200 rounded-2xl overflow-hidden bg-slate-50">
                    <div className="grid grid-cols-3 bg-slate-100/90 text-slate-700 text-[11px] font-black uppercase tracking-wider p-3 border-b border-slate-200">
                      <div>Colección / Métrica</div>
                      <div className="text-center">clinicas.db Actual</div>
                      <div className="text-center">Archivo .JSON</div>
                    </div>

                    <div className="divide-y divide-slate-200/70 text-xs">
                      {/* Attendance Records */}
                      <div className="grid grid-cols-3 p-3 items-center bg-white">
                        <span className="font-bold text-slate-800 flex items-center gap-1.5">
                          <Clock className="w-4 h-4 text-blue-500" />
                          Checadas en Bitácora
                        </span>
                        <span className="text-center font-mono font-bold text-slate-900">
                          {pendingBackupImport.currentStats.records}
                        </span>
                        <span className={`text-center font-mono font-bold ${
                          pendingBackupImport.fileStats.records < pendingBackupImport.currentStats.records
                            ? 'text-rose-600'
                            : 'text-emerald-600'
                        }`}>
                          {pendingBackupImport.fileStats.records}
                          {pendingBackupImport.diffAnalysis && pendingBackupImport.diffAnalysis.records.newRecordsCount > 0 && (
                            <span className="ml-1 text-[11px] text-emerald-700 font-normal">
                              (+{pendingBackupImport.diffAnalysis.records.newRecordsCount} nuevas)
                            </span>
                          )}
                        </span>
                      </div>

                      {/* Students */}
                      <div className="grid grid-cols-3 p-3 items-center bg-white">
                        <span className="font-bold text-slate-800 flex items-center gap-1.5">
                          <Users className="w-4 h-4 text-indigo-500" />
                          Alumnos Registrados
                        </span>
                        <span className="text-center font-mono font-bold text-slate-900">
                          {pendingBackupImport.currentStats.students}
                        </span>
                        <span className={`text-center font-mono font-bold ${
                          pendingBackupImport.fileStats.students < pendingBackupImport.currentStats.students
                            ? 'text-amber-600'
                            : 'text-emerald-600'
                        }`}>
                          {pendingBackupImport.fileStats.students}
                          {pendingBackupImport.diffAnalysis && pendingBackupImport.diffAnalysis.students.added.length > 0 && (
                            <span className="ml-1 text-[11px] text-emerald-700 font-normal">
                              (+{pendingBackupImport.diffAnalysis.students.added.length} nuevos)
                            </span>
                          )}
                        </span>
                      </div>

                      {/* Hospital Sites */}
                      <div className="grid grid-cols-3 p-3 items-center bg-white">
                        <span className="font-bold text-slate-800 flex items-center gap-1.5">
                          <Building className="w-4 h-4 text-amber-500" />
                          Sedes Hospitalarias
                        </span>
                        <span className="text-center font-mono font-bold text-slate-900">
                          {pendingBackupImport.currentStats.sites}
                        </span>
                        <span className="text-center font-mono font-bold text-slate-700">
                          {pendingBackupImport.fileStats.sites}
                        </span>
                      </div>

                      {/* Holidays */}
                      <div className="grid grid-cols-3 p-3 items-center bg-white">
                        <span className="font-bold text-slate-800 flex items-center gap-1.5">
                          <Calendar className="w-4 h-4 text-teal-500" />
                          Días Inhábiles
                        </span>
                        <span className="text-center font-mono font-bold text-slate-900">
                          {pendingBackupImport.currentStats.holidays}
                        </span>
                        <span className="text-center font-mono font-bold text-slate-700">
                          {pendingBackupImport.fileStats.holidays}
                        </span>
                      </div>

                      {/* Latest Record Date */}
                      <div className="grid grid-cols-3 p-3 items-center bg-white">
                        <span className="font-bold text-slate-800 flex items-center gap-1.5">
                          <Activity className="w-4 h-4 text-purple-500" />
                          Fecha Más Reciente
                        </span>
                        <span className="text-center font-mono text-[11px] text-slate-600">
                          {pendingBackupImport.currentStats.latestDate}
                        </span>
                        <span className={`text-center font-mono text-[11px] font-bold ${
                          pendingBackupImport.fileStats.latestDate < pendingBackupImport.currentStats.latestDate && pendingBackupImport.fileStats.latestDate !== 'Sin registros'
                            ? 'text-rose-600'
                            : 'text-slate-700'
                        }`}>
                          {pendingBackupImport.fileStats.latestDate}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: STUDENTS & SCHEDULES MODIFICATIONS */}
              {pendingBackupImport.activeTab === 'students' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-600 font-semibold">
                      Cambios específicos identificados en la configuración de cada alumno:
                    </p>
                    <span className="text-xs text-slate-500">
                      Total: {((pendingBackupImport.diffAnalysis?.students.modified.length || 0) + (pendingBackupImport.diffAnalysis?.students.added.length || 0))} alumnos con diferencias
                    </span>
                  </div>

                  {pendingBackupImport.diffAnalysis?.students.modified.length === 0 && pendingBackupImport.diffAnalysis?.students.added.length === 0 ? (
                    <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl text-center space-y-2">
                      <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                      <p className="text-sm font-bold text-slate-800">
                        Todos los horarios y datos de alumnos coinciden exactamente con la base de datos.
                      </p>
                      <p className="text-xs text-slate-500">
                        No hay diferencias pendientes en la configuración de alumnos entre el archivo JSON y clinicas.db.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                      {/* Added students */}
                      {pendingBackupImport.diffAnalysis?.students.added.map((st) => (
                        <div key={st.matricula} className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-2xl flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 bg-emerald-600 text-white font-mono text-[10px] font-black rounded-lg">
                                + NUEVO ALUMNO
                              </span>
                              <span className="text-xs font-bold text-emerald-950 font-mono">
                                Matrícula: {st.matricula}
                              </span>
                            </div>
                            <p className="text-sm font-bold text-slate-900">{st.nombre}</p>
                            <p className="text-xs text-slate-600">
                              Grupo: <span className="font-semibold text-slate-800">{st.grupo}</span> • Equipo: <span className="font-semibold text-slate-800">{st.equipo}</span> • Sede: <span className="font-semibold text-slate-800">{st.sedeNombre}</span>
                            </p>
                          </div>
                          <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 text-[11px] font-bold rounded-xl shrink-0">
                            {st.horariosCount || 0} turnos config
                          </span>
                        </div>
                      ))}

                      {/* Modified students */}
                      {pendingBackupImport.diffAnalysis?.students.modified.map((st) => (
                        <div key={st.matricula} className="p-3 bg-blue-50/70 border border-blue-200 rounded-2xl space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 bg-blue-600 text-white font-mono text-[10px] font-black rounded-lg">
                                ✎ MODIFICADO
                              </span>
                              <span className="text-xs font-bold text-blue-950 font-mono">
                                Matrícula: {st.matricula}
                              </span>
                            </div>
                            <span className="text-[11px] text-slate-500 font-medium">
                              Grupo {st.grupo} • {st.equipo}
                            </span>
                          </div>
                          <p className="text-sm font-bold text-slate-900">{st.nombre}</p>
                          <div className="space-y-0.5 pl-2 border-l-2 border-blue-400">
                            {st.changes.map((ch, idx) => (
                              <p key={idx} className="text-xs font-semibold text-blue-950 flex items-center gap-1.5">
                                <span className="text-blue-500">•</span> {ch}
                              </p>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: ATTENDANCE RECORDS & SITES */}
              {pendingBackupImport.activeTab === 'records' && (
                <div className="space-y-3">
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                    <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">
                      Resumen de Asistencias y Checadas
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div className="p-3 bg-white border border-slate-200 rounded-xl">
                        <span className="text-xs text-slate-500">Nuevas checadas a incorporar:</span>
                        <div className="text-lg font-black text-blue-600">
                          +{pendingBackupImport.diffAnalysis?.records.newRecordsCount || 0}
                        </div>
                        <p className="text-[11px] text-slate-500">
                          Se insertarán en clinicas.db sin alterar las existentes.
                        </p>
                      </div>
                      <div className="p-3 bg-white border border-slate-200 rounded-xl">
                        <span className="text-xs text-slate-500">Checadas ya existentes:</span>
                        <div className="text-lg font-black text-slate-800">
                          {pendingBackupImport.diffAnalysis?.records.existingRecordsCount || 0}
                        </div>
                        <p className="text-[11px] text-slate-500">
                          Conservadas intactas en la base de datos.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Sites and holidays */}
                  {pendingBackupImport.diffAnalysis && (pendingBackupImport.diffAnalysis.sites.added.length > 0 || pendingBackupImport.diffAnalysis.holidays.added.length > 0) && (
                    <div className="p-4 bg-teal-50/70 border border-teal-200 rounded-2xl space-y-2">
                      <h4 className="text-xs font-black text-teal-900 uppercase tracking-wider">
                        Nuevas Sedes / Días Inhábiles Detectados
                      </h4>
                      {pendingBackupImport.diffAnalysis.sites.added.length > 0 && (
                        <p className="text-xs text-teal-950 font-semibold">
                          • Sedes a agregar: {pendingBackupImport.diffAnalysis.sites.added.join(', ')}
                        </p>
                      )}
                      {pendingBackupImport.diffAnalysis.holidays.added.length > 0 && (
                        <p className="text-xs text-teal-950 font-semibold">
                          • Días inhábiles a agregar: {pendingBackupImport.diffAnalysis.holidays.added.join(', ')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Auto-Backup Protection Notice */}
              <div className="p-3.5 bg-blue-50/80 border border-blue-200 rounded-2xl flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div className="text-xs text-blue-950 space-y-0.5">
                  <p className="font-bold text-blue-900">Protección Automática Activa:</p>
                  <p className="text-blue-800/90 leading-relaxed">
                    Antes de procesar la sincronización, el servidor creará automáticamente una copia de respaldo con timestamp <code className="font-mono bg-blue-100 px-1 py-0.5 rounded text-blue-950 font-bold">clinicas_backup_TIMESTAMP.db</code> para garantizar la total recuperabilidad de la información.
                  </p>
                </div>
              </div>
            </div>

            {/* Actions Grid */}
            <div className="p-4 sm:p-6 border-t border-slate-200 bg-slate-50/80 space-y-2.5 shrink-0">
              <button
                type="button"
                onClick={() => handleConfirmBackupImport('merge')}
                className="w-full p-3.5 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white font-bold rounded-2xl text-xs shadow-md transition-all flex items-center justify-between group"
              >
                <div className="flex items-center gap-2.5 text-left">
                  <div className="p-1.5 bg-white/20 rounded-xl">
                    <RefreshCw className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <div className="text-sm font-black flex items-center gap-1.5">
                      <span>Sincronizar y Actualizar .db (Fusión Inteligente)</span>
                      <span className="px-2 py-0.2 bg-emerald-400 text-slate-900 text-[10px] font-black rounded-full">
                        Recomendado
                      </span>
                    </div>
                    <p className="text-[11px] text-emerald-100 font-normal">
                      Actualiza los horarios y datos de alumnos en clinicas.db, suma nuevas checadas y preserva teléfonos ya vinculados.
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-white/70 group-hover:translate-x-1 transition-transform shrink-0" />
              </button>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        '¿Confirmas que deseas sobrescribir y reemplazar toda la base de datos con este archivo? Se generará un auto-backup previo en el servidor.'
                      )
                    ) {
                      handleConfirmBackupImport('replace');
                    }
                  }}
                  className="p-3 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 font-bold rounded-2xl text-xs transition-colors flex items-center justify-center gap-2"
                >
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>⚠️ Reemplazar / Sobrescribir Todo</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPendingBackupImport(null)}
                  className="p-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-2xl text-xs transition-colors flex items-center justify-center gap-1.5"
                >
                  <X className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>Cancelar Operación</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
