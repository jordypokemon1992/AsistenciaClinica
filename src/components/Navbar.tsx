import React, { useState, useEffect } from 'react';
import { UserRole, Student, HospitalZone } from '../types';
import {
  ShieldCheck,
  GraduationCap,
  Hospital,
  Clock,
  RotateCcw,
  LogOut,
  Smartphone,
  ChevronRight,
} from 'lucide-react';

interface NavbarProps {
  currentRole: UserRole;
  isTeacherAuthenticated: boolean;
  activeStudent: Student | null;
  hospitalZone: HospitalZone;
  onSwitchRole: (role: UserRole) => void;
  onLogoutStudent: () => void;
  onLogoutMasterTeacher: () => void;
  onResetDemoData: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentRole,
  isTeacherAuthenticated,
  activeStudent,
  hospitalZone,
  onSwitchRole,
  onLogoutStudent,
  onLogoutMasterTeacher,
  onResetDemoData,
}) => {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="sticky top-0 z-50 bg-slate-900 text-white border-b border-slate-800 shadow-md">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2.5 sm:py-0 sm:h-16 gap-2 sm:gap-4">
          {/* Brand & Hospital Info */}
          <div className="flex items-start sm:items-center gap-3 min-w-0">
            <div className="w-9 h-9 bg-red-600 rounded-lg flex items-center justify-center text-white font-bold shadow-md text-base shrink-0 mt-0.5 sm:mt-0">
              C
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-bold text-base sm:text-lg tracking-tight text-white leading-none">
                  ClinicasTrack <span className="text-red-400 text-xs font-mono font-semibold">v2.0</span>
                </h1>
                <span className="hidden md:inline-block px-2.5 py-0.5 text-[10px] uppercase font-bold tracking-wider rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Multisede GPS
                </span>
              </div>
              <p className="text-xs text-slate-300 font-medium truncate max-w-xs mt-0.5">
                Control de asistencia hospitalaria a clinicas
              </p>

              {/* Botón de Salir y Estado de Sesión en móvil (Justo debajo de la descripción) */}
              {isTeacherAuthenticated ? (
                <div className="flex sm:hidden items-center gap-2 mt-2">
                  <div className="flex items-center gap-1.5 bg-red-950/80 border border-red-800 px-2.5 py-1 rounded-xl text-xs">
                    <ShieldCheck className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    <span className="font-bold text-red-200 text-[11px]">Docente Maestro</span>
                  </div>
                  <button
                    onClick={onLogoutMasterTeacher}
                    title="Cerrar sesión maestra"
                    className="px-2.5 py-1 bg-red-600 hover:bg-red-700 active:scale-95 text-white rounded-lg transition-all flex items-center gap-1 text-[11px] font-bold shadow-sm"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Salir</span>
                  </button>
                </div>
              ) : activeStudent ? (
                <div className="flex sm:hidden items-center gap-2 mt-2">
                  <div className="flex items-center gap-1.5 bg-slate-800 border border-slate-700 px-2.5 py-1 rounded-xl text-xs min-w-0">
                    <GraduationCap className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    <span className="font-bold text-white text-[11px] truncate max-w-[140px]">
                      {activeStudent.nombre}
                    </span>
                  </div>
                  <button
                    onClick={onLogoutStudent}
                    title="Cerrar sesión de alumno"
                    className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 active:scale-95 text-white rounded-lg transition-all flex items-center gap-1 text-[11px] font-bold shadow-sm"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Salir</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {/* Clock */}
          <div className="hidden lg:flex items-center gap-4 text-xs text-slate-300">
            <div className="font-mono text-sm text-emerald-400 bg-slate-950 px-3.5 py-1.5 rounded-lg border border-slate-800 shadow-inner">
              {currentTime.toLocaleTimeString('es-MX')}
            </div>
          </div>

          {/* Actions & Active Session Status (Desktop view) */}
          <div className="hidden sm:flex items-center gap-2">
            {isTeacherAuthenticated ? (
              <div className="flex items-center gap-2 bg-red-950/60 border border-red-800 px-3 py-1.5 rounded-xl text-xs">
                <ShieldCheck className="w-4 h-4 text-red-400 shrink-0" />
                <span className="font-bold text-red-200">Docente Maestro</span>
                <button
                  onClick={onLogoutMasterTeacher}
                  title="Cerrar sesión maestra"
                  className="ml-1 px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center gap-1 text-[11px] font-bold"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Salir</span>
                </button>
              </div>
            ) : activeStudent ? (
              <div className="flex items-center gap-2 bg-slate-800/90 border border-slate-700 px-3 py-1.5 rounded-xl text-xs">
                <GraduationCap className="w-4 h-4 text-red-400 shrink-0" />
                <span className="font-bold text-white truncate max-w-[180px]">
                  {activeStudent.nombre}
                </span>
                <button
                  onClick={onLogoutStudent}
                  title="Cerrar sesión de alumno"
                  className="ml-1 px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors flex items-center gap-1 text-[11px] font-bold"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Salir</span>
                </button>
              </div>
            ) : (
              <div className="px-3 py-1.5 bg-slate-800/80 rounded-xl border border-slate-700/80 text-[11px] text-slate-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-semibold text-slate-300">Login Único Activo</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
