import { pgTable, serial, text, integer, doublePrecision, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID
  email: text('email').notNull(),
  role: text('role').default('docente'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const systemConfig = pgTable('system_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sites = pgTable('sites', {
  id: text('id').primaryKey(),
  nombre: text('nombre').notNull(),
  direccion: text('direccion'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  radiusMeters: doublePrecision('radius_meters'),
  horaEntrada: text('hora_entrada'),
  horaSalida: text('hora_salida'),
  toleranciaMinutos: integer('tolerancia_minutos'),
  dataJson: text('data_json'),
  updatedAt: text('updated_at').notNull(),
});

export const students = pgTable('students', {
  id: text('id').primaryKey(),
  matricula: text('matricula').notNull().unique(),
  nombre: text('nombre').notNull(),
  email: text('email'),
  especialidad: text('especialidad'),
  rotacion: text('rotacion'),
  grupo: text('grupo'),
  equipo: text('equipo'),
  activo: integer('activo').default(1),
  sedeId: text('sede_id'),
  sedeNombre: text('sede_nombre'),
  secondarySedeId: text('secondary_sede_id'),
  secondarySedeNombre: text('secondary_sede_nombre'),
  horaEntrada: text('hora_entrada'),
  horaSalida: text('hora_salida'),
  toleranciaMinutos: integer('tolerancia_minutos'),
  diasAsistencia: text('dias_asistencia'),
  horariosPorDia: text('horarios_por_dia'),
  linkedDeviceId: text('linked_device_id'),
  linkedDeviceName: text('linked_device_name'),
  linkedAt: text('linked_at'),
  dataJson: text('data_json'),
  updatedAt: text('updated_at').notNull(),
});

export const attendanceRecords = pgTable('attendance_records', {
  id: text('id').primaryKey(),
  studentId: text('student_id'),
  matricula: text('matricula'),
  studentNombre: text('student_nombre'),
  grupo: text('grupo'),
  equipo: text('equipo'),
  siteId: text('site_id'),
  siteNombre: text('site_nombre'),
  fecha: text('fecha').notNull(),
  tipo: text('tipo').notNull(),
  horaRegistrada: text('hora_registrada').notNull(),
  estado: text('estado').notNull(),
  horaEsperada: text('hora_esperada'),
  toleranciaMinutos: integer('tolerancia_minutos'),
  minutosDiferencia: integer('minutos_diferencia'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  distanceMeters: doublePrecision('distance_meters'),
  accuracyMeters: doublePrecision('accuracy_meters'),
  dentroDeZona: integer('dentro_de_zona'),
  deviceId: text('device_id'),
  deviceName: text('device_name'),
  verificadoPorGPS: integer('verificado_por_gps'),
  esJustificada: integer('es_justificada').default(0),
  motivoJustificante: text('motivo_justificante'),
  dataJson: text('data_json'),
  createdAt: text('created_at').notNull(),
});

export const holidays = pgTable('holidays', {
  fecha: text('fecha').primaryKey(),
  descripcion: text('descripcion').notNull(),
  creadoPor: text('creado_por'),
  fechaCreacion: text('fecha_creacion'),
});
