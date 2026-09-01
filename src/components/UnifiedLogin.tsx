import React, { useState } from 'react';
import {
  ShieldCheck,
  GraduationCap,
  Lock,
  User,
  Eye,
  EyeOff,
  AlertCircle,
  Building2,
  MapPin,
  Clock,
  Smartphone,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import { Student } from '../types';
import { LocationPermissionModal } from './LocationPermissionModal';
import {
  getStudentByMatricula,
  getStudentByMatriculaAsync,
  verifyMasterAuth,
  getStudents,
  linkStudentDevice,
  getRecentStudentLogins,
  addRecentStudentLogin,
  isMatriculaMatch,
} from '../services/storage';
import { getOrCreateDeviceFingerprint, checkOrRequestGPS } from '../utils/geolocation';

interface UnifiedLoginProps {
  onStudentLogin: (student: Student) => void;
  onTeacherLoginSuccess: () => void;
  students?: Student[];
}

export const UnifiedLogin: React.FC<UnifiedLoginProps> = ({
  onStudentLogin,
  onTeacherLoginSuccess,
  students: propStudents,
}) => {
  const [activeTab, setActiveTab] = useState<'STUDENT' | 'TEACHER'>('STUDENT');

  // Device signature of current browser
  const currentDevice = getOrCreateDeviceFingerprint();

  // Student State
  const [matriculaInput, setMatriculaInput] = useState('');
  const [studentError, setStudentError] = useState<string | null>(null);
  const [isCheckingMatricula, setIsCheckingMatricula] = useState(false);
  const [recentLogins, setRecentLogins] = useState<Student[]>(() => getRecentStudentLogins());

  // Location & Device Confirmation Modal State
  const [pendingStudent, setPendingStudent] = useState<Student | null>(null);
  const [pendingLinkStudent, setPendingLinkStudent] = useState<Student | null>(null);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [isVerifyingGPS, setIsVerifyingGPS] = useState(false);

  // Teacher State
  const [teacherUser, setTeacherUser] = useState('');
  const [teacherPass, setTeacherPass] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [teacherError, setTeacherError] = useState<string | null>(null);

  const finalizeStudentLogin = (student: Student) => {
    addRecentStudentLogin(student.matricula);
    setRecentLogins(getRecentStudentLogins());
    onStudentLogin(student);
  };

  const handleConfirmLinkStudentInLogin = async () => {
    if (!pendingLinkStudent) return;
    const target = pendingLinkStudent;
    const linked = linkStudentDevice(target.id, currentDevice.id, currentDevice.name);
    if (!linked) {
      setStudentError('⛔ ERROR DE VINCULACIÓN: No se pudo vincular este dispositivo a tu matrícula.');
      setPendingLinkStudent(null);
      return;
    }
    target.linkedDeviceId = currentDevice.id;
    target.linkedDeviceName = currentDevice.name;
    setPendingLinkStudent(null);

    // Check GPS permission right at login moment!
    setIsVerifyingGPS(true);
    const gpsCheck = await checkOrRequestGPS();
    setIsVerifyingGPS(false);

    if (gpsCheck.success) {
      finalizeStudentLogin(target);
    } else {
      setPendingStudent(target);
      setShowLocationModal(true);
    }
  };

  // Helper to process student login with strict device binding & GPS permission check
  const processStudentLogin = async (student: Student): Promise<boolean> => {
    setStudentError(null);

    if (!student.activo) {
      setStudentError(`La matrícula "${student.matricula}" está inactiva en el sistema.`);
      return false;
    }

    // Single Device Binding Verification
    if (student.linkedDeviceId && student.linkedDeviceId !== currentDevice.id) {
      const allStudents = getStudents();
      const isClaimedByOther = allStudents.some(
        (s) => s.id !== student.id && !isMatriculaMatch(s.matricula, student.matricula) && s.linkedDeviceId === currentDevice.id
      );

      if (isClaimedByOther) {
        const claimingOwner = allStudents.find(
          (s) => s.id !== student.id && !isMatriculaMatch(s.matricula, student.matricula) && s.linkedDeviceId === currentDevice.id
        );
        setStudentError(
          `⛔ DISPOSITIVO YA REGISTRADO: Este teléfono ("${currentDevice.name}") ya se encuentra vinculado a la matrícula de otro alumno (${claimingOwner?.nombre || 'Otro Alumno'} - Matrícula: ${claimingOwner?.matricula}). No está permitido que dos alumnos compartan un mismo dispositivo.`
        );
        return false;
      }

      // Trigger confirmation screen with student name for hardware migration
      setPendingLinkStudent(student);
      return false;
    }

    // First time login -> Show confirmation pop-up modal with student name
    if (!student.linkedDeviceId) {
      const allStudents = getStudents();
      const existingStudentWithDevice = allStudents.find(
        (s) => s.id !== student.id && s.linkedDeviceId === currentDevice.id
      );

      if (existingStudentWithDevice) {
        setStudentError(
          `⛔ DISPOSITIVO YA REGISTRADO: Este teléfono ("${currentDevice.name}") ya se encuentra vinculado a la matrícula de otro alumno (${existingStudentWithDevice.nombre} - Matrícula: ${existingStudentWithDevice.matricula}). No está permitido que dos alumnos compartan un mismo dispositivo.`
        );
        return false;
      }

      // Show security confirmation modal before linking!
      setPendingLinkStudent(student);
      return false;
    }

    // Check GPS permission right at login moment!
    setIsVerifyingGPS(true);
    const gpsCheck = await checkOrRequestGPS();
    setIsVerifyingGPS(false);

    if (gpsCheck.success) {
      // Permission ALREADY GRANTED -> Log in directly without showing modal!
      finalizeStudentLogin(student);
      return true;
    } else {
      // Permission NOT GRANTED or prompt/denied -> Open Location Permission Modal
      setPendingStudent(student);
      setShowLocationModal(true);
      return false;
    }
  };

  // Handle Student Login Form Submit
  const handleStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStudentError(null);

    const cleanMat = matriculaInput.trim();
    if (!cleanMat) {
      setStudentError('Por favor ingresa tu matrícula de alumno.');
      return;
    }

    setIsCheckingMatricula(true);
    let student = getStudentByMatricula(cleanMat);
    if (!student) {
      // Search in Express backend in case local storage hasn't synced yet
      student = await getStudentByMatriculaAsync(cleanMat);
    }
    setIsCheckingMatricula(false);

    if (!student) {
      setStudentError(
        `La matrícula "${cleanMat}" no está registrada. Verifica el número o solicita el alta a tu docente.`
      );
      return;
    }

    await processStudentLogin(student);
  };

  // Handle Teacher Login
  const handleTeacherSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTeacherError(null);

    if (!teacherUser.trim() || !teacherPass) {
      setTeacherError('Por favor ingresa tu usuario y clave maestra.');
      return;
    }

    const isValid = verifyMasterAuth(teacherUser, teacherPass);
    if (isValid) {
      onTeacherLoginSuccess();
    } else {
      setTeacherError('Credenciales maestras incorrectas. Revisa usuario o contraseña.');
    }
  };

  return (
    <div className="w-full min-h-[calc(100vh-5rem)] flex flex-col justify-center items-center px-3 sm:px-6 py-6 sm:py-10 bg-gradient-to-b from-slate-100 via-slate-50 to-slate-200 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 transition-all">
      <div className="w-full max-w-xl mx-auto space-y-6">
        
        {/* Main Branding Banner Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-100 dark:bg-red-950/80 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 text-xs font-bold shadow-sm">
            <Building2 className="w-3.5 h-3.5 text-red-600" />
            <span>Sistema Único de Control Clínico</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-tight">
            Control de asistencia hospitalaria a clinicas
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">
            Registro con geolocalización GPS, verificación de dispositivo único y gestión centralizada.
          </p>
        </div>

        {/* Unified Login Card */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden transition-all">
          
          {/* Tab Selector Header */}
          <div className="p-2 bg-slate-100 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => {
                setActiveTab('STUDENT');
                setStudentError(null);
              }}
              className={`py-3 px-4 rounded-2xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all min-h-[44px] ${
                activeTab === 'STUDENT'
                  ? 'bg-white dark:bg-slate-900 text-red-600 dark:text-red-400 shadow-md border border-slate-200/80 dark:border-slate-800'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <GraduationCap className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
              <span>Acceso Alumnos</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('TEACHER');
                setTeacherError(null);
              }}
              className={`py-3 px-4 rounded-2xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all min-h-[44px] ${
                activeTab === 'TEACHER'
                  ? 'bg-white dark:bg-slate-900 text-red-600 dark:text-red-400 shadow-md border border-slate-200/80 dark:border-slate-800'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
              <span>Acceso Docente</span>
            </button>
          </div>

          {/* Form Body */}
          <div className="p-5 sm:p-8 space-y-6">
            
            {/* TAB 1: STUDENT LOGIN */}
            {activeTab === 'STUDENT' && (
              <form onSubmit={handleStudentSubmit} className="space-y-5">
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <GraduationCap className="w-5 h-5 text-red-600 dark:text-red-400" />
                    Ingreso de Alumno por Matrícula
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Ingresa tu matrícula para realizar tu checada de entrada o salida con GPS.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
                    Matrícula del Alumno
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={matriculaInput}
                      onChange={(e) => setMatriculaInput(e.target.value)}
                      placeholder="Ej. 20241001"
                      className="w-full pl-10 pr-4 py-3 sm:py-3.5 rounded-2xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 font-mono text-base sm:text-sm"
                      required
                    />
                    <User className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                {/* Device Signature Info Banner */}
                <div className="p-3 bg-slate-100 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <Smartphone className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider">
                        Dispositivo Actual Detectado
                      </span>
                      <strong className="font-mono text-slate-900 dark:text-white text-[11px]">
                        {currentDevice.name}
                      </strong>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold rounded-full border border-emerald-300 dark:border-emerald-800 shrink-0">
                    Seguridad Activa
                  </span>
                </div>

                {studentError && (
                  <div className="p-3.5 bg-rose-50 dark:bg-rose-950/80 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 rounded-2xl text-xs space-y-1.5 shadow-sm">
                    <div className="flex items-center gap-2 font-bold text-rose-900 dark:text-rose-100 text-xs">
                      <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                      <span>Validación de Dispositivo Único</span>
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      {studentError}
                    </p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isCheckingMatricula || isVerifyingGPS}
                  className="w-full py-3.5 px-4 bg-red-600 hover:bg-red-700 active:scale-[0.99] text-white font-bold rounded-2xl shadow-lg shadow-red-600/25 transition-all flex items-center justify-center gap-2 text-sm sm:text-base min-h-[48px] disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isCheckingMatricula ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                      <span>Verificando en la Base de Datos...</span>
                    </>
                  ) : isVerifyingGPS ? (
                    <>
                      <MapPin className="w-5 h-5 animate-bounce text-amber-300 shrink-0" />
                      <span>Verificando Permiso GPS...</span>
                    </>
                  ) : (
                    <>
                      <span>Ingresar al Portal de Checadas</span>
                      <ChevronRight className="w-5 h-5" />
                    </>
                  )}
                </button>

                {/* Recent Student Logins Shortcuts */}
                {recentLogins.length > 0 && (
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                      Ingreso Reciente:
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {recentLogins.slice(0, 4).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setMatriculaInput(s.matricula);
                            processStudentLogin(s);
                          }}
                          className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/80 hover:border-red-300 dark:hover:border-red-800 hover:bg-red-50/50 dark:hover:bg-red-950/30 text-left transition-all group min-h-[44px]"
                        >
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-red-600 dark:group-hover:text-red-400 truncate">
                            {s.nombre}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 flex items-center justify-between mt-0.5">
                            <span>Mat: <strong>{s.matricula}</strong></span>
                            <span className="text-[10px] text-red-600 dark:text-red-400 font-bold">Ingresar →</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </form>
            )}

            {/* TAB 2: TEACHER LOGIN */}
            {activeTab === 'TEACHER' && (
              <form onSubmit={handleTeacherSubmit} className="space-y-4">
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-red-600 dark:text-red-400" />
                    Acceso Maestro de Docente / Titular
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Ingresa tus credenciales maestras para administrar listas, geocercas y asistencias.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                    Usuario Maestro
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={teacherUser}
                      onChange={(e) => setTeacherUser(e.target.value)}
                      placeholder="Ej. DOCENTE"
                      className="w-full pl-10 pr-4 py-3 rounded-2xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 font-mono text-sm uppercase"
                      required
                    />
                    <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                    Clave de Control Maestro
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={teacherPass}
                      onChange={(e) => setTeacherPass(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-10 py-3 rounded-2xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 font-mono text-sm"
                      required
                    />
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 min-w-[36px] min-h-[36px] flex items-center justify-center"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {teacherError && (
                  <div className="p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 rounded-2xl text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                    <span>{teacherError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full py-3.5 px-4 bg-red-600 hover:bg-red-700 active:scale-[0.99] text-white font-bold rounded-2xl shadow-lg shadow-red-600/25 transition-all flex items-center justify-center gap-2 text-sm sm:text-base min-h-[48px]"
                >
                  <ShieldCheck className="w-5 h-5" />
                  <span>Ingresar como Docente Maestro</span>
                </button>
              </form>
            )}

          </div>
        </div>

        {/* Feature Highlights Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-100 dark:border-red-900 flex items-center justify-center shrink-0">
              <MapPin className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-900 dark:text-white">Geocerca GPS</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Validación por sede hospitalaria</div>
            </div>
          </div>

          <div className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-100 dark:border-red-900 flex items-center justify-center shrink-0">
              <Smartphone className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-900 dark:text-white">Equipo Único</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Vínculo anti-suplantación</div>
            </div>
          </div>

          <div className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-100 dark:border-red-900 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-900 dark:text-white">Horarios Dinámicos</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Puntualidad y retardo automático</div>
            </div>
          </div>
        </div>

        {/* Device Confirmation Modal with Student Name */}
        {pendingLinkStudent && (
          <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-5 animate-scale-up">
              <div className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
                <div className="w-12 h-12 bg-red-50 dark:bg-red-950/60 rounded-2xl flex items-center justify-center text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900 shrink-0">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                    Confirmación de Dispositivo Único
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Sincronización de hardware móvil por alumno
                  </p>
                </div>
              </div>

              <div className="bg-red-50/80 dark:bg-red-950/40 p-4 rounded-2xl border border-red-100 dark:border-red-900 space-y-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-red-700 dark:text-red-400 block">
                  Alumno a Vincular:
                </span>
                <div className="text-sm font-black text-slate-900 dark:text-white">
                  {pendingLinkStudent.nombre}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <span className="bg-white dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 font-mono">
                    Matrícula: {pendingLinkStudent.matricula}
                  </span>
                  <span className="bg-white dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                    Grupo {pendingLinkStudent.grupo || '10 A'}
                  </span>
                </div>
              </div>

              <div className="text-xs text-slate-600 dark:text-slate-300 space-y-2 bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-700">
                <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                  <Smartphone className="w-4 h-4 text-red-600 dark:text-red-400" />
                  <span>Equipo Detectado:</span>
                </div>
                <p className="font-mono text-[11px] text-slate-700 dark:text-slate-300 font-semibold truncate bg-white dark:bg-slate-900 p-2 rounded-xl border border-slate-200 dark:border-slate-800">
                  {currentDevice.name}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Al confirmar, este dispositivo quedará registrado oficialmente y vinculado de forma permanente a la matrícula de <strong>{pendingLinkStudent.nombre}</strong>.
                </p>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPendingLinkStudent(null)}
                  className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-2xl text-xs transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmLinkStudentInLogin}
                  className="flex-1 py-3 px-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-2xl text-xs shadow-lg shadow-red-600/25 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Sí, Vincular Mi Dispositivo</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Location Permission Popup Modal */}
        <LocationPermissionModal
          isOpen={showLocationModal}
          onClose={() => setShowLocationModal(false)}
          onPermissionGranted={(lat, lng) => {
            if (pendingStudent) {
              finalizeStudentLogin(pendingStudent);
              setPendingStudent(null);
            }
          }}
          studentName={pendingStudent?.nombre}
        />

      </div>
    </div>
  );
};
