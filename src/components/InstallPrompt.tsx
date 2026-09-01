import React, { useState, useEffect } from 'react';
import { Download, Smartphone, Apple, CheckCircle2, X, Share2, PlusSquare } from 'lucide-react';

export const InstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showModal, setShowModal] = useState<boolean>(false);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);
  const [isIOS, setIsIOS] = useState<boolean>(false);

  useEffect(() => {
    // Check if already installed / running in standalone mode
    const isRunningStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    setIsStandalone(isRunningStandalone);

    // Detect iOS
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isAppleDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isAppleDevice);

    // Capture Android Chrome beforeinstallprompt event
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        console.log('User accepted PWA installation');
      }
      setDeferredPrompt(null);
      setShowModal(false);
    } else {
      setShowModal(true);
    }
  };

  if (isStandalone) {
    return null; // Already installed as PWA app
  }

  return (
    <>
      {/* Discreet Banner / Button at the top or floating */}
      <div className="bg-gradient-to-r from-sky-900/90 via-slate-900/90 to-sky-950/90 border-b border-sky-700/40 text-white px-3 py-2 text-xs flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-md bg-sky-500/20 flex items-center justify-center text-sky-300 shrink-0 border border-sky-500/30">
            <Smartphone className="w-3.5 h-3.5" />
          </div>
          <p className="truncate font-medium text-slate-200">
            <span className="font-semibold text-white">¿Deseas instalar la App?</span> Accede rápido con el icono en tu pantalla.
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleInstallClick}
            className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 active:scale-95 text-white font-bold rounded-lg transition-all flex items-center gap-1 shadow-sm text-[11px]"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Instalar</span>
          </button>
        </div>
      </div>

      {/* Guide Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-5 text-white shadow-2xl relative animate-in fade-in zoom-in duration-200">
            <button
              onClick={() => setShowModal(false)}
              className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-sky-600 flex items-center justify-center text-white shadow-lg overflow-hidden border border-sky-400/30">
                <img src="/icon-192.png" alt="Icono App" className="w-full h-full object-cover" />
              </div>
              <div>
                <h3 className="font-bold text-base text-white">Instalar ClinicasTrack</h3>
                <p className="text-xs text-slate-400">Acceso directo con icono oficial en tu pantalla</p>
              </div>
            </div>

            {isIOS ? (
              <div className="space-y-3 bg-slate-800/80 rounded-xl p-4 border border-slate-700">
                <div className="flex items-center gap-2 text-sky-300 font-semibold text-sm">
                  <Apple className="w-4 h-4" />
                  <span>Pasos para iPhone (Safari):</span>
                </div>
                <ol className="text-xs text-slate-300 space-y-2 list-decimal list-inside leading-relaxed">
                  <li>
                    Abre esta página en <strong className="text-white">Safari</strong>.
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span>Toca el botón <strong>Compartir</strong></span>
                    <Share2 className="w-4 h-4 text-sky-400 inline shrink-0 mt-0.5" />
                    <span>en la barra inferior.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span>Selecciona <strong>"Agregar a la pantalla de inicio"</strong></span>
                    <PlusSquare className="w-4 h-4 text-sky-400 inline shrink-0 mt-0.5" />
                  </li>
                  <li>Toca <strong>"Agregar"</strong> arriba a la derecha.</li>
                </ol>
              </div>
            ) : (
              <div className="space-y-3 bg-slate-800/80 rounded-xl p-4 border border-slate-700">
                <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                  <Smartphone className="w-4 h-4" />
                  <span>Pasos para Android (Chrome / Edge / Xiaomi):</span>
                </div>
                <ol className="text-xs text-slate-300 space-y-2 list-decimal list-inside leading-relaxed">
                  <li>
                    Abre el menú de <strong className="text-white">tres puntos (⋮)</strong> arriba a la derecha en Chrome.
                  </li>
                  <li>
                    Selecciona <strong className="text-sky-300">"Instalar aplicación"</strong> o <strong className="text-sky-300">"Crear acceso directo"</strong>.
                  </li>
                  <li>
                    Confirma y el icono oficial de la aplicación aparecerá en el inicio de tu teléfono.
                  </li>
                </ol>
              </div>
            )}

            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setShowModal(false)}
                className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 active:scale-95 rounded-xl font-bold text-sm text-white transition-all shadow-md"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
