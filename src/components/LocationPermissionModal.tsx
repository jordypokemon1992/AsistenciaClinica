import React, { useState, useEffect } from 'react';
import {
  MapPin,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  X,
  RefreshCw,
  ShieldAlert,
  HelpCircle,
  Lock,
  Compass,
} from 'lucide-react';
import { isIOSDevice, checkOrRequestGPS } from '../utils/geolocation';

interface LocationPermissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPermissionGranted: (lat: number, lng: number) => void;
  studentName?: string;
}

export const LocationPermissionModal: React.FC<LocationPermissionModalProps> = ({
  isOpen,
  onClose,
  onPermissionGranted,
  studentName,
}) => {
  const [isTesting, setIsTesting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const isIOS = isIOSDevice();

  useEffect(() => {
    if (isOpen) {
      setIsTesting(false);
      setErrorMsg(null);
      setPermissionDenied(false);
      setIsSuccess(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRequestGPS = async () => {
    setIsTesting(true);
    setErrorMsg(null);
    setPermissionDenied(false);
    setIsSuccess(false);

    const result = await checkOrRequestGPS();
    setIsTesting(false);

    if (result.success && result.lat !== undefined && result.lng !== undefined) {
      setIsSuccess(true);
      setTimeout(() => {
        onPermissionGranted(result.lat!, result.lng!);
        onClose();
      }, 700);
    } else {
      setErrorMsg(result.error || 'No se pudo obtener la ubicación GPS.');
      if (result.permissionDenied) {
        setPermissionDenied(true);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl space-y-5 relative overflow-hidden">
        {/* Top Accent Gradient Bar */}
        <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-red-500 via-rose-500 to-amber-500"></div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
          title="Cerrar modal"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header Icon & Title */}
        <div className="text-center space-y-2 pt-2">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-950/80 text-red-600 dark:text-red-400 rounded-2xl border border-red-200 dark:border-red-900 flex items-center justify-center mx-auto shadow-sm relative">
            <MapPin className="w-8 h-8" />
            {isIOS && (
              <span className="absolute -bottom-1 -right-1 px-1.5 py-0.5 bg-slate-900 text-white text-[9px] font-bold rounded-md font-mono border border-slate-700">
                iOS
              </span>
            )}
          </div>

          <h3 className="text-xl font-extrabold text-slate-900 dark:text-white">
            Permiso de Ubicación GPS Requerido
          </h3>

          {studentName && (
            <p className="text-xs font-semibold text-red-600 dark:text-red-400">
              Hola, {studentName}
            </p>
          )}

          <p className="text-xs text-slate-600 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
            ClinicasTrack requiere acceso a la ubicación GPS de tu teléfono para validar que te encuentres en la sede hospitalaria autorizada al checar asistencia.
          </p>

          {isIOS && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-300 text-[11px] font-semibold rounded-full mt-1">
              <Smartphone className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>Optimización Especial para iPhone / iPad iOS</span>
            </div>
          )}
        </div>

        {/* Success Feedback State */}
        {isSuccess ? (
          <div className="p-4 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 rounded-2xl text-center space-y-2 animate-fade-in">
            <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400 mx-auto animate-bounce" />
            <p className="text-xs font-bold text-emerald-950 dark:text-emerald-200">
              ¡Ubicación GPS Verificada con Éxito!
            </p>
            <p className="text-[11px] text-emerald-700 dark:text-emerald-300 font-mono">
              Accediendo al portal...
            </p>
          </div>
        ) : (
          /* Permission Request & Error Display */
          <div className="space-y-4">
            {errorMsg && (
              <div className="p-4 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 rounded-2xl text-xs text-rose-900 dark:text-rose-200 space-y-2">
                <div className="flex items-center gap-2 font-bold text-rose-950 dark:text-rose-100">
                  <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>No se pudo conectar al GPS ({errorMsg})</span>
                </div>
                <p className="text-[11px] text-rose-800 dark:text-rose-300">
                  {permissionDenied
                    ? 'El permiso de ubicación fue denegado en tu navegador. Sigue los pasos de abajo para desbloquearlo.'
                    : 'Asegúrate de tener activa la opción de Localización/GPS en el menú rápido de tu teléfono.'}
                </p>
              </div>
            )}

            {/* Step-by-step iOS / Safari Guide if permission was denied or user is on iOS */}
            {(permissionDenied || isIOS) && (
              <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 space-y-2.5">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
                  <span className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Compass className="w-4 h-4 text-red-500" />
                    Guía de Activación en iPhone / Safari:
                  </span>
                  <span className="text-[10px] bg-slate-200 dark:bg-slate-800 px-2 py-0.5 rounded font-mono">
                    iOS Settings
                  </span>
                </div>

                <ol className="space-y-2 text-[11px] list-decimal list-inside text-slate-600 dark:text-slate-400">
                  <li className="leading-tight">
                    En Safari, toca el icono <strong>"AA"</strong> o <strong>"Ajustes de Sitio"</strong> (lado izquierdo de la barra de dirección web superior).
                  </li>
                  <li className="leading-tight">
                    Selecciona <strong>Configuración del sitio web</strong> &gt; <strong>Ubicación</strong> &gt; Elige <strong>Permitir</strong>.
                  </li>
                  <li className="leading-tight">
                    O ve a <strong>Ajustes de tu iPhone</strong> &gt; <strong>Privacidad y Seguridad</strong> &gt; <strong>Localización</strong> &gt; <strong>Safari</strong> y activa <strong>"Al usar la app"</strong>.
                  </li>
                </ol>
              </div>
            )}

            {/* Main Action Buttons */}
            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={handleRequestGPS}
                disabled={isTesting}
                className="w-full py-3.5 px-4 bg-red-600 hover:bg-red-700 active:scale-[0.99] text-white font-bold rounded-2xl transition-all shadow-md flex items-center justify-center gap-2 text-sm disabled:opacity-50"
              >
                {isTesting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Consultando GPS de iPhone / Dispositivo...</span>
                  </>
                ) : (
                  <>
                    <MapPin className="w-4 h-4" />
                    <span>
                      {permissionDenied || errorMsg
                        ? 'Reintentar Conexión GPS'
                        : 'Activar y Otorgar Permisos GPS'}
                    </span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 font-semibold text-xs transition-colors"
              >
                Cancelar y Volver
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
