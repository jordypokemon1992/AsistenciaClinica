import React, { useState } from 'react';
import {
  ShieldCheck,
  Lock,
  User,
  Eye,
  EyeOff,
  KeyRound,
  GraduationCap,
  ArrowLeft,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { verifyMasterAuth, getMasterConfig } from '../services/storage';

interface TeacherLoginGateProps {
  onSuccessLogin: () => void;
  onCancelToStudent: () => void;
}

export const TeacherLoginGate: React.FC<TeacherLoginGateProps> = ({
  onSuccessLogin,
  onCancelToStudent,
}) => {
  const masterConfig = getMasterConfig();
  const [usuario, setUsuario] = useState('DOCENTE');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!usuario.trim() || !password) {
      setError('Por favor ingresa usuario y contraseña maestra.');
      return;
    }

    const isValid = verifyMasterAuth(usuario, password);

    if (isValid) {
      onSuccessLogin();
    } else {
      setError('Credenciales maestros incorrectos. Verifique el usuario o la contraseña.');
    }
  };

  const handleFillDemo = () => {
    setUsuario(masterConfig.usuario);
    setPassword(masterConfig.password);
    setError(null);
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-8 bg-slate-900/5 dark:bg-slate-950">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
        {/* Header Banner */}
        <div className="bg-slate-900 text-white p-6 relative overflow-hidden text-center">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-red-500/10 rounded-full blur-xl pointer-events-none" />
          <div className="mx-auto w-12 h-12 bg-red-600/20 rounded-2xl border border-red-500/30 flex items-center justify-center mb-3">
            <ShieldCheck className="w-7 h-7 text-red-400" />
          </div>
          <h2 className="text-xl font-bold tracking-tight">
            Acceso Maestro de Docente
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            ClinicasTrack - Control de Asistencia Hospitalaria
          </p>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-5">
          <form onSubmit={handleLogin} className="space-y-4">
            {/* Usuario Maestro Input */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Usuario Maestro
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={usuario}
                  onChange={(e) => setUsuario(e.target.value)}
                  placeholder="Ej. DOCENTE"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 font-mono text-sm uppercase"
                  required
                />
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            {/* Password Input */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Clave de Control Maestro
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 font-mono text-sm"
                  required
                />
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Demo Master Credentials Pill */}
            <div className="p-3 bg-red-50/80 border border-red-200/80 rounded-xl text-xs text-red-900 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-red-600 shrink-0" />
                <div>
                  <span className="font-bold block text-[11px] text-red-950">Acceso Maestro Demo:</span>
                  <span className="font-mono text-[11px] text-red-800">
                    User: <strong>{masterConfig.usuario}</strong> | Pass: <strong>{masterConfig.password}</strong>
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleFillDemo}
                className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg text-[10px] whitespace-nowrap shadow-sm transition-all"
              >
                Autocompletar
              </button>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2 text-sm"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Ingresar como Usuario Maestro</span>
            </button>
          </form>

          {/* Return to Student Button */}
          <div className="pt-2 border-t border-slate-100 text-center">
            <button
              type="button"
              onClick={onCancelToStudent}
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 font-medium py-1 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Regresar al Portal de Alumnos (Checadas)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
