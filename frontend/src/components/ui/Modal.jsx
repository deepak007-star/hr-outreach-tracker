/**
 * Shared Modal — backdrop + centered panel with entrance/exit animation,
 * Escape-to-close, and click-outside-to-close. Single source of truth for
 * modal chrome; every *Modal.jsx component should wrap its content in this
 * instead of hand-rolling `fixed inset-0 bg-black/50 ...` with no transition
 * (which is what every modal in the app did before this).
 *
 * `onClose` is the real "unmount me" callback — Modal delays calling it until
 * the exit animation finishes, so a plain `<button onClick={onClose}>` still
 * works but pops instead of animating out. For an animated close from inside
 * your own content (a Cancel/X button), use the render-prop form and call
 * `requestClose` instead:
 *
 *   <Modal onClose={onClose}>
 *     {({ requestClose }) => (
 *       <Card>
 *         <button onClick={requestClose}>Cancel</button>
 *       </Card>
 *     )}
 *   </Modal>
 */
import { useEffect, useState, useCallback } from 'react';

const EXIT_MS = 120; // matches the modal-out animation duration in tailwind.config.js

export default function Modal({ children, onClose, maxWidth = 'max-w-md', closeOnBackdrop = true }) {
  const [closing, setClosing] = useState(false);

  const requestClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => onClose?.(), EXIT_MS);
  }, [onClose]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-backdrop-in"
      onClick={closeOnBackdrop ? (e => { if (e.target === e.currentTarget) requestClose(); }) : undefined}
    >
      <div className={`w-full ${maxWidth} ${closing ? 'animate-modal-out' : 'animate-modal-in'}`}>
        {typeof children === 'function' ? children({ requestClose }) : children}
      </div>
    </div>
  );
}
