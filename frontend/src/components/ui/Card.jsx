// Shared hover-lift for clickable cards — same treatment StatTile/LandingPage
// feature cards already use, now available anywhere via `interactive`.
const INTERACTIVE = 'transition-all duration-150 hover:-translate-y-0.5 hover:shadow-modal cursor-pointer';

/**
 * Shared Card — consistent padding, radius (md=10px), shadow.
 * Every card-like surface in the app uses this.
 * Optional header slot via `header` prop.
 * Pass `interactive` for a clickable card (hover-lift + pointer cursor).
 */
export default function Card({ header, children, className = '', interactive = false, ...props }) {
  return (
    <div
      className={`bg-white rounded-md shadow-card border border-gray-100 ${interactive ? INTERACTIVE : ''} ${className}`}
      {...props}
    >
      {header && (
        <div className="px-5 py-4 border-b border-gray-100">
          {header}
        </div>
      )}
      <div className="p-5">
        {children}
      </div>
    </div>
  );
}

/** Flush variant — no built-in padding, useful when children control their own */
export function CardFlush({ children, className = '', interactive = false, ...props }) {
  return (
    <div
      className={`bg-white rounded-md shadow-card border border-gray-100 overflow-hidden ${interactive ? INTERACTIVE : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
