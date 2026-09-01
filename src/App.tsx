import React, { useState, useEffect } from 'react';
import { UserRole, Student, HospitalZone, AttendanceRecord } from './types';
import { Navbar } from './components/Navbar';
import { StudentPortal } from './components/StudentPortal';
import { TeacherDashboard } from './components/TeacherDashboard';
import { UnifiedLogin } from './components/UnifiedLogin';
import { InstallPrompt } from './components/InstallPrompt';
import {
  getHospitalZone,
  getStudents,
  getAttendanceRecords,
  resetDemoData,
  subscribeToCloudChanges,
  isMatriculaMatch,
} from './services/storage';

const TEACHER_AUTH_SESSION_KEY = 'hosp_teacher_master_authenticated';

export default function App() {
  const [activeStudent, setActiveStudent] = useState<Student | null>(null);

  const [isTeacherAuthenticated, setIsTeacherAuthenticated] = useState<boolean>(() => {
    return sessionStorage.getItem(TEACHER_AUTH_SESSION_KEY) === 'true';
  });

  const [hospitalZone, setHospitalZone] = useState<HospitalZone>(getHospitalZone());
  const [students, setStudents] = useState<Student[]>(getStudents());
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>(
    getAttendanceRecords()
  );

  // Refresh data from storage
  const refreshData = () => {
    setHospitalZone(getHospitalZone());
    const currentStudents = getStudents();
    setStudents(currentStudents);
    setAttendanceRecords(getAttendanceRecords());

    // Sync active student state if logged in
    setActiveStudent((prev) => {
      if (!prev) return null;
      const updated = currentStudents.find(
        (s) =>
          s.id === prev.id ||
          (s.matricula && prev.matricula && isMatriculaMatch(s.matricula, prev.matricula))
      );
      return updated ? { ...updated } : null;
    });
  };

  useEffect(() => {
    refreshData();
    const role: 'teacher' | 'student' | 'guest' = isTeacherAuthenticated
      ? 'teacher'
      : activeStudent
      ? 'student'
      : 'guest';

    const unsubscribe = subscribeToCloudChanges(
      () => {
        refreshData();
      },
      {
        role,
        studentId: activeStudent?.id,
        matricula: activeStudent?.matricula,
      }
    );
    return () => unsubscribe();
  }, [isTeacherAuthenticated, activeStudent?.id, activeStudent?.matricula]);

  const handleTeacherLoginSuccess = () => {
    setIsTeacherAuthenticated(true);
    setActiveStudent(null);
    sessionStorage.setItem(TEACHER_AUTH_SESSION_KEY, 'true');
  };

  const handleStudentLoginSuccess = (student: Student) => {
    setActiveStudent(student);
    setIsTeacherAuthenticated(false);
  };

  const handleLogoutMasterTeacher = () => {
    setIsTeacherAuthenticated(false);
    sessionStorage.removeItem(TEACHER_AUTH_SESSION_KEY);
  };

  const handleLogoutStudent = () => {
    setActiveStudent(null);
  };

  // Handle Reset Demo Data
  const handleResetDemoData = () => {
    if (
      window.confirm(
        '¿Deseas reiniciar todos los datos a la muestra inicial? Se restaurará la lista de alumnos, geocerca y registros de ejemplo.'
      )
    ) {
      resetDemoData();
      refreshData();
      setActiveStudent(null);
      setIsTeacherAuthenticated(false);
      sessionStorage.removeItem(TEACHER_AUTH_SESSION_KEY);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans">
      {/* Navbar Header */}
      <Navbar
        currentRole={isTeacherAuthenticated ? 'TEACHER' : 'STUDENT'}
        isTeacherAuthenticated={isTeacherAuthenticated}
        activeStudent={activeStudent}
        hospitalZone={hospitalZone}
        onSwitchRole={() => {}}
        onLogoutStudent={handleLogoutStudent}
        onLogoutMasterTeacher={handleLogoutMasterTeacher}
        onResetDemoData={handleResetDemoData}
      />

      {/* PWA Install Banner */}
      <InstallPrompt />

      {/* Main View Area */}
      <main className="flex-1 flex flex-col">
        {isTeacherAuthenticated ? (
          <TeacherDashboard
            students={students}
            hospitalZone={hospitalZone}
            attendanceRecords={attendanceRecords}
            onRefreshData={refreshData}
            onLogoutMasterTeacher={handleLogoutMasterTeacher}
            onResetDemoData={handleResetDemoData}
          />
        ) : activeStudent ? (
          <StudentPortal
            activeStudent={activeStudent}
            hospitalZone={hospitalZone}
            onLoginStudent={handleStudentLoginSuccess}
            onLogoutStudent={handleLogoutStudent}
            onRefreshData={refreshData}
          />
        ) : (
          <UnifiedLogin
            onStudentLogin={handleStudentLoginSuccess}
            onTeacherLoginSuccess={handleTeacherLoginSuccess}
            students={students}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 py-4 px-4 sm:px-6 text-center text-xs text-slate-500 dark:text-slate-400">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>
            Control de Asistencia Hospitalaria con Geocerca GPS • Vinculación de Teléfono Único
          </div>
          <div className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
            Unidad: {hospitalZone.nombre}
          </div>
        </div>
      </footer>
    </div>
  );
}
