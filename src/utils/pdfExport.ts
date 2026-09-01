import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Student, HospitalZone, AttendanceRecord, DiaInhabil } from '../types';
import { getTodayDateString } from './geolocation';
import { normalizeSpanishDay, WEEKDAY_NAMES_ES } from './dayUtils';

function isDutyDayForDate(date: Date, student: Student): boolean {
  const dayIndex = date.getDay();
  const dayNameNorm = WEEKDAY_NAMES_ES[dayIndex];
  
  const assignedDays = student.diasAsistencia && student.diasAsistencia.length > 0
    ? student.diasAsistencia
    : (student.horariosPorDia || []).map(h => h.dia);

  return assignedDays.some(d => normalizeSpanishDay(d) === dayNameNorm);
}

export function calculateStudentGuardRatio(
  student: Student,
  records: AttendanceRecord[],
  inicioStr: string,
  finStr: string,
  diasInhabiles: DiaInhabil[] = []
) {
  const todayStr = getTodayDateString();
  const evalEndStr = finStr < todayStr ? finStr : todayStr;

  let totalPosibles = 0;
  let totalAsistidas = 0;

  if (!inicioStr || !finStr) {
    return { asistidas: 0, posibles: 0, ratio: '0/0', percentage: 0 };
  }

  const startDate = new Date(inicioStr + 'T00:00:00');
  const endDate = new Date(evalEndStr + 'T00:00:00');

  const curr = new Date(startDate);
  while (curr <= endDate) {
    const yyyy = curr.getFullYear();
    const mm = String(curr.getMonth() + 1).padStart(2, '0');
    const dd = String(curr.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const isDiaInhabil = diasInhabiles.some((h) => h.fecha === dateStr);

    if (!isDiaInhabil && isDutyDayForDate(curr, student)) {
      totalPosibles++;
      const rec = records.find(
        (r) => (r.studentId === student.id || r.matricula === student.matricula) && r.fecha === dateStr
      );
      const isJustificada = rec?.esJustificada || rec?.checkInStatus === 'JUSTIFICADA' || (rec as any)?.estado === 'JUSTIFICADA';
      if (rec?.checkInStatus === 'A_TIEMPO' || (rec as any)?.estado === 'A_TIEMPO' || rec?.checkInStatus === 'RETARDO' || (rec as any)?.estado === 'RETARDO' || isJustificada) {
        totalAsistidas++;
      }
    }
    curr.setDate(curr.getDate() + 1);
  }

  return {
    asistidas: totalAsistidas,
    posibles: totalPosibles,
    ratio: `${totalAsistidas}/${totalPosibles}`,
    percentage: totalPosibles > 0 ? Math.round((totalAsistidas / totalPosibles) * 100) : 0
  };
}

export function exportGroupPDFReport(
  students: Student[],
  selectedGrupo: string,
  hospitalZone: HospitalZone,
  attendanceRecords: AttendanceRecord[],
  fechaInicioSemestre: string = '2026-01-15',
  fechaFinSemestre: string = '2026-06-30',
  docenteNombre: string = 'Dra. Sofia Perez - Titular de Guardia',
  diasInhabiles: DiaInhabil[] = []
) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const todayStr = getTodayDateString();

  // Filter students if a specific group is selected
  const filteredStudents =
    selectedGrupo === 'ALL'
      ? students
      : students.filter((s) => (s.grupo || 'Sin Grupo') === selectedGrupo);

  // Group attendance stats
  let totalATiempoGroup = 0;
  let totalRetardosGroup = 0;
  let totalFueraRangoGroup = 0;

  filteredStudents.forEach((std) => {
    const stdRecords = attendanceRecords.filter((r) => r.studentId === std.id || r.matricula === std.matricula);
    stdRecords.forEach((r) => {
      if (r.checkInStatus === 'A_TIEMPO') totalATiempoGroup++;
      else if (r.checkInStatus === 'RETARDO') totalRetardosGroup++;
      else if (r.checkInStatus === 'FUERA_DE_RANGO') totalFueraRangoGroup++;
    });
  });

  const totalChecadasGroup = totalATiempoGroup + totalRetardosGroup + totalFueraRangoGroup;

  // Colors
  const primaryColor = [15, 23, 42]; // Slate 900
  const redColor = [185, 28, 28]; // Red 700
  const lightBg = [254, 242, 242]; // Red 50

  // 1. Header Banner
  doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.rect(0, 0, 210, 32, 'F');

  // Title Text
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Control de Asistencias Médicas y Guardias Hospitalarias', 14, 13);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(252, 165, 165); // Red 300
  doc.text('Reporte Oficial de Evaluación Semestral por Alumno y Registro de Asistencias', 14, 21);

  // Badge on header
  doc.setFillColor(redColor[0], redColor[1], redColor[2]);
  doc.roundedRect(142, 9, 54, 13, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  const grupoTitle = selectedGrupo === 'ALL' ? 'TODOS LOS GRUPOS' : `GRUPO: ${selectedGrupo}`;
  doc.text(grupoTitle, 169, 17, { align: 'center' });

  // 2. Info Grid Header
  doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
  doc.roundedRect(14, 36, 182, 24, 2, 2, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, 36, 182, 24, 2, 2, 'S');

  doc.setTextColor(51, 65, 85);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('SEDE PRINCIPAL:', 18, 42);
  doc.setFont('helvetica', 'normal');
  doc.text(hospitalZone.nombre || 'Hospital General de Zona', 48, 42);

  doc.setFont('helvetica', 'bold');
  doc.text('PERÍODO SEMESTRE:', 18, 48);
  doc.setFont('helvetica', 'normal');
  doc.text(`${fechaInicioSemestre}  al  ${fechaFinSemestre}`, 48, 48);

  doc.setFont('helvetica', 'bold');
  doc.text('DOCENTE TITULAR:', 18, 54);
  doc.setFont('helvetica', 'normal');
  doc.text(docenteNombre, 48, 54);

  doc.setFont('helvetica', 'bold');
  doc.text('FECHA EMISIÓN:', 130, 42);
  doc.setFont('helvetica', 'normal');
  doc.text(
    new Date().toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    158,
    42
  );

  doc.setFont('helvetica', 'bold');
  doc.text('TOTAL EVALUADOS:', 130, 48);
  doc.setFont('helvetica', 'normal');
  doc.text(`${filteredStudents.length} alumnos`, 158, 48);

  doc.setFont('helvetica', 'bold');
  doc.text('TOTAL CHECADAS:', 130, 54);
  doc.setFont('helvetica', 'normal');
  doc.text(`${totalChecadasGroup} registros`, 158, 54);

  // 3. Section Title - CONTEO Y RESUMEN DE ASISTENCIAS
  doc.setFillColor(241, 245, 249); // Slate 100
  doc.roundedRect(14, 63, 182, 7, 1.5, 1.5, 'F');
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('EVALUACIÓN DE ASISTENCIA Y RELACIÓN DE GUARDIAS CUMPLIDAS POR ALUMNO', 18, 68);

  // 4. Table Rows Construction
  const tableData = filteredStudents.map((std, idx) => {
    const stdRecords = attendanceRecords.filter((r) => r.studentId === std.id || r.matricula === std.matricula);

    const aTiempoCount = stdRecords.filter((r) => r.checkInStatus === 'A_TIEMPO').length;
    const retardosCount = stdRecords.filter((r) => r.checkInStatus === 'RETARDO').length;

    const ratioInfo = calculateStudentGuardRatio(
      std,
      attendanceRecords,
      fechaInicioSemestre,
      fechaFinSemestre,
      diasInhabiles
    );

    const estatusGeneral =
      ratioInfo.percentage >= 90
        ? 'Excelente'
        : ratioInfo.percentage >= 75
        ? 'Regular'
        : ratioInfo.posibles === 0
        ? 'Sin Datos'
        : 'Atención';

    const sedeName = std.sedeNombre || hospitalZone.nombre || 'Sede Principal';

    return [
      (idx + 1).toString(),
      std.matricula,
      std.nombre,
      `${std.grupo || '10 A'} / ${std.equipo || 'Eq. 1'}`,
      sedeName,
      aTiempoCount.toString(),
      retardosCount.toString(),
      `${ratioInfo.ratio} (${ratioInfo.percentage}%)`,
      estatusGeneral,
    ];
  });

  autoTable(doc, {
    startY: 73,
    head: [
      [
        '#',
        'Matrícula',
        'Nombre del Alumno',
        'Grupo / Eq.',
        'Sede Hospitalaria',
        'A Tiempo',
        'Retardos',
        'Guardias (Cumplidas / Posibles)',
        'Estatus',
      ],
    ],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [185, 28, 28], // Red 700
      textColor: [255, 255, 255],
      fontSize: 7.5,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
    },
    bodyStyles: {
      fontSize: 7.5,
      textColor: [30, 41, 59],
      valign: 'middle',
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 6 },
      1: { halign: 'center', fontStyle: 'bold', cellWidth: 18 },
      2: { cellWidth: 42 },
      3: { halign: 'center', cellWidth: 18 },
      4: { cellWidth: 32 },
      5: { halign: 'center', cellWidth: 14, fontStyle: 'bold' },
      6: { halign: 'center', cellWidth: 14 },
      7: { halign: 'center', cellWidth: 26, fontStyle: 'bold' },
      8: { halign: 'center', cellWidth: 12, fontStyle: 'bold' },
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
  });

  // 5. Summary Breakdown Box below table
  const finalTableY = (doc as any).lastAutoTable?.finalY || 180;
  let currentY = finalTableY + 6;

  if (currentY + 35 < 280) {
    doc.setFillColor(254, 242, 242);
    doc.roundedRect(14, currentY, 182, 18, 2, 2, 'F');
    doc.setDrawColor(252, 165, 165);
    doc.roundedRect(14, currentY, 182, 18, 2, 2, 'S');

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(153, 27, 27);
    doc.text('RESUMEN DE EVALUACIÓN SEMESTRAL AL EMITIR PDF:', 18, currentY + 5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85);
    doc.text(
      `• Rango de evaluación de semestre: ${fechaInicioSemestre} a ${fechaFinSemestre}`,
      18,
      currentY + 10
    );
    const inhabilNote = diasInhabiles.length > 0
      ? ` • ${diasInhabiles.length} fecha(s) inhábiles registrada(s) fueron excluidas de inasistencias.`
      : '';

    doc.text(
      `• Registros de asistencias evaluados con corte de guardias para ${filteredStudents.length} alumnos.${inhabilNote}`,
      18,
      currentY + 14
    );

    currentY += 24;
  }

  // 6. Footer & Signature
  const signatureY = Math.max(currentY + 15, 240);

  if (signatureY < 270) {
    doc.setDrawColor(148, 163, 184);
    doc.line(70, signatureY, 140, signatureY);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(51, 65, 85);
    doc.text(docenteNombre, 105, signatureY + 5, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('Firma y Sello del Profesor Titular de Campo Clínico', 105, signatureY + 9, { align: 'center' });
  }

  // Download PDF file
  const filename = `Reporte_Semestral_Asistencias_${selectedGrupo.replace(/\s+/g, '_')}_${todayStr}.pdf`;
  doc.save(filename);
}


