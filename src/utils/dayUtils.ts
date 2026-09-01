import { DaySchedule } from '../types';

/**
 * Utility functions for standardizing, sorting and comparing days of the week
 * in natural calendar order: Lunes -> Martes -> Miércoles -> Jueves -> Viernes -> Sábado -> Domingo.
 */

export const normalizeSpanishDay = (dayStr: string): string => {
  return (dayStr || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
};

export const WEEKDAY_NAMES_ES = [
  'domingo',
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
];

export const DIAS_SEMANA_OPCIONES = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
];

export const DAY_ORDER_MAP: Record<string, number> = {
  lunes: 0,
  martes: 1,
  miercoles: 2,
  jueves: 3,
  viernes: 4,
  sabado: 5,
  domingo: 6,
};

export const getDayOrder = (day: string): number => {
  const norm = normalizeSpanishDay(day);
  return DAY_ORDER_MAP[norm] !== undefined ? DAY_ORDER_MAP[norm] : 99;
};

/**
 * Sorts an array of day names in the natural order of the week (Lunes a Domingo)
 */
export const sortDaysArray = (days: string[]): string[] => {
  if (!Array.isArray(days)) return [];
  return [...days].sort((a, b) => getDayOrder(a) - getDayOrder(b));
};

/**
 * Sorts an array of day schedule objects in the natural order of the week (Lunes a Domingo)
 */
export const sortDaySchedules = <T extends Partial<DaySchedule> & { dia: string }>(schedules?: T[] | null): T[] => {
  if (!Array.isArray(schedules)) return [];
  return [...schedules].sort((a, b) => getDayOrder(a.dia) - getDayOrder(b.dia));
};
