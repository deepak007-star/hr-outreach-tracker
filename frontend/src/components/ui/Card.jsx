/**
 * Shared Card — consistent padding, radius (md=10px), shadow.
 * Every card-like surface in the app uses this.
 * Optional header slot via `header` prop.
 */
export default function Card({ header, children, className = '', ...props }) {
  return (
    <div
      className={`bg-white rounded-md shadow-card border border-gray-100 ${className}`}
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
export function CardFlush({ children, className = '', ...props }) {
  return (
    <div
      className={`bg-white rounded-md shadow-card border border-gray-100 overflow-hidden ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
