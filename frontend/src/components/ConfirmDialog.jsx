import { useState, useEffect } from 'react';
import { registerConfirmHandler } from '../utils/confirm';

// Self-hosted visibility (driven by the confirm() promise utility, not a
// parent-controlled onClose prop) doesn't fit ui/Modal.jsx's render-prop API,
// so this plays its own matching modal-in/out animation directly instead.
export default function ConfirmDialog() {
  const [state, setState]     = useState({ open: false, message: '', detail: '', resolve: null });
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    registerConfirmHandler((message, detail) =>
      new Promise(resolve => setState({ open: true, message, detail, resolve }))
    );
  }, []);

  const close = (value) => {
    setClosing(true);
    setTimeout(() => {
      setState(s => { s.resolve?.(value); return { open: false, message: '', detail: '', resolve: null }; });
      setClosing(false);
    }, 120);
  };

  if (!state.open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 animate-backdrop-in" onClick={() => close(false)} />
      <div className={`relative bg-white rounded-md shadow-modal w-full max-w-sm mx-4 p-6 ${closing ? 'animate-modal-out' : 'animate-modal-in'}`}>
        <p className="text-sm font-semibold text-gray-900">{state.message}</p>
        {state.detail && <p className="text-xs text-gray-500 mt-1">{state.detail}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={() => close(false)}
            className="px-4 py-1.5 text-xs rounded-sm border border-gray-300 text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => close(true)}
            className="px-4 py-1.5 text-xs rounded-sm bg-red-600 text-white hover:bg-red-700"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
