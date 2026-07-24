/**
 * Skeleton loaders — replaces spinners for data fetches >300ms.
 * Usage: <SkeletonLine />, <SkeletonCard />, <SkeletonRow />
 */

export function SkeletonLine({ className = '' }) {
  return <div className={`skeleton h-3 rounded-sm ${className}`} />;
}

export function SkeletonCard({ className = '' }) {
  return (
    <div className={`bg-white rounded-md shadow-card border border-gray-100 p-4 space-y-3 ${className}`}>
      <div className="skeleton h-4 w-1/2 rounded-sm" />
      <div className="skeleton h-3 w-full rounded-sm" />
      <div className="skeleton h-3 w-3/4 rounded-sm" />
    </div>
  );
}

export function SkeletonRow({ cols = 4, className = '' }) {
  return (
    <div className={`flex items-center gap-4 px-4 py-3 border-b border-gray-100 ${className}`}>
      {Array.from({ length: cols }).map((_, i) => (
        <div key={i} className="skeleton h-3 flex-1 rounded-sm" />
      ))}
    </div>
  );
}

export default function SkeletonBlock({ className = '' }) {
  return <div className={`skeleton ${className}`} />;
}
