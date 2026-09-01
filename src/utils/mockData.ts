import { Student, HospitalZone, HospitalSite, AttendanceRecord } from '../types';

export const INITIAL_HOSPITAL_SITES: HospitalSite[] = [
  {
    id: 'site-1',
    nombre: 'Hospital General Los Mochis',
    direccion: 'Blvd. Macario Gaxiola y Av. Hidalgo, Los Mochis, Sin.',
    latitude: 25.7925,
    longitude: -108.996,
    radiusMeters: 150,
    horaEntrada: '07:00',
    horaSalida: '15:00',
    toleranciaMinutos: 15,
  },
  {
    id: 'site-2',
    nombre: 'IMSS Clínica 49 y 37',
    direccion: 'Blvd. Rosendo G. Castro s/n, Col. Centro, Los Mochis, Sin.',
    latitude: 25.798,
    longitude: -108.999,
    radiusMeters: 150,
    horaEntrada: '07:00',
    horaSalida: '15:00',
    toleranciaMinutos: 15,
  },
  {
    id: 'site-3',
    nombre: 'ISSSTE Los Mochis',
    direccion: 'Av. Independencia y Santos Degollado, Los Mochis, Sin.',
    latitude: 25.795,
    longitude: -108.992,
    radiusMeters: 180,
    horaEntrada: '08:00',
    horaSalida: '16:00',
    toleranciaMinutos: 20,
  },
];

export const INITIAL_HOSPITAL_ZONE: HospitalZone = {
  id: 'site-1',
  nombre: 'Hospital General Los Mochis',
  direccion: 'Blvd. Macario Gaxiola y Av. Hidalgo, Los Mochis, Sin.',
  latitude: 25.7925,
  longitude: -108.996,
  radiusMeters: 150,
  horaEntrada: '07:00',
  horaSalida: '15:00',
  toleranciaMinutos: 15,
};

export const INITIAL_STUDENTS: Student[] = [];

export function generateInitialAttendanceRecords(): AttendanceRecord[] {
  return [];
}
