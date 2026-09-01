export interface HospitalSite {
  id: string;
  nombre: string;
  direccion: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  horaEntrada?: string; // e.g. "07:00"
  horaSalida?: string; // e.g. "15:00"
  toleranciaMinutos?: number; // e.g. 15
}

export interface TimeTurno {
  horaEntrada: string; // e.g. "07:00"
  horaSalida: string; // e.g. "08:00"
}

export interface DaySchedule {
  dia: string; // e.g. "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"
  horaEntrada: string; // e.g. "07:00"
  horaSalida: string; // e.g. "08:00"
  turnos?: TimeTurno[]; // Múltiples turnos/horarios en el mismo día
  toleranciaMinutos?: number; // e.g. 15
}

export interface Student {
  id: string;
  matricula: string;
  nombre: string;
  email?: string;
  especialidad?: string; // e.g. "Urgencias Médicas", "Pediatría", "Cirugía General", "Medicina Interna"
  rotacion: string; // e.g. "Urgencias Médicas", "Pediatría", "Cirugía General"
  grupo: string; // e.g. "10 A", "10 B", "10 C", "8 A", "8 B"
  equipo: string; // e.g. "Equipo 1", "Equipo 2"
  diasAsistencia: string[]; // e.g. ["Lunes", "Jueves"]
  horariosPorDia?: DaySchedule[]; // Horarios específicos por día de la semana e.g. [{ dia: "Lunes", horaEntrada: "07:00", horaSalida: "08:00" }, { dia: "Miércoles", horaEntrada: "16:00", horaSalida: "17:00" }]
  sedeId: string; // ID de la sede hospitalaria principal asignada
  sedeNombre?: string; // Nombre cacheado de la sede principal
  secondarySedeId?: string | null; // ID de la segunda sede hospitalaria opcional
  secondarySedeNombre?: string | null; // Nombre cacheado de la segunda sede opcional
  horaEntrada?: string; // Horario dinámico e.g. "07:00", "08:00", "14:00"
  horaSalida?: string; // Horario dinámico e.g. "15:00", "16:00", "21:00"
  toleranciaMinutos?: number; // Tolerancia dinámica en minutos e.g. 15
  linkedDeviceId: string | null;
  linkedDeviceName: string | null;
  linkedAt: string | null;
  activo: boolean;
  updatedAt?: string; // ISO timestamp to track last modification
}

export interface HospitalZone {
  id?: string;
  nombre: string;
  direccion: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  horaEntrada?: string; // e.g. "07:00"
  horaSalida?: string; // e.g. "15:00"
  toleranciaMinutos?: number; // e.g. 15
}

export type CheckInStatus = 'A_TIEMPO' | 'RETARDO' | 'FUERA_DE_RANGO' | 'NO_REGISTRADO' | 'JUSTIFICADA';
export type CheckOutStatus = 'COMPLETADO' | 'SALIDA_ANTICIPADA' | 'FUERA_DE_RANGO' | 'SIN_SALIDA';

export interface DiaInhabil {
  id: string;
  fecha: string; // YYYY-MM-DD
  motivo: string;
  createdAt?: string;
}

export interface AttendanceRecord {
  id: string;
  studentId: string;
  matricula: string;
  fecha: string; // YYYY-MM-DD
  checkInTime: string | null; // ISO string
  checkInLat: number | null;
  checkInLng: number | null;
  checkInDistanceMeters: number | null;
  checkInStatus: CheckInStatus;
  checkOutTime: string | null; // ISO string
  checkOutLat: number | null;
  checkOutLng: number | null;
  checkOutDistanceMeters: number | null;
  checkOutStatus: CheckOutStatus;
  deviceIdUsed: string;
  deviceNameUsed: string;
  notas?: string;
  turnoIndex?: number;
  turnoLabel?: string;
  horaEntradaProgramada?: string;
  horaSalidaProgramada?: string;
  esJustificada?: boolean;
  motivoJustificante?: string;
  tipo?: string;
  estado?: string;
  studentNombre?: string;
  grupo?: string;
  equipo?: string;
  siteId?: string;
  siteNombre?: string;
}

export type UserRole = 'TEACHER' | 'STUDENT';
