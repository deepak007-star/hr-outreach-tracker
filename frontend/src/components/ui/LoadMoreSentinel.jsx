/**
 * Drop at the bottom of any incrementally-loaded list. Auto-fires `onLoadMore`
 * the moment it scrolls into view (IntersectionObserver) — no manual "next
 * page" click needed — and falls back to a clickable button while loading or
 * for users who land on it via keyboard nav.
 */
import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';

export default function LoadMoreSentinel({ hasMore, loading, onLoadMore, className = '' }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!hasMore || !ref.current) return;
    const el = ref.current;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) onLoadMore(); },
      { rootMargin: '200px' } // fire a bit before it's actually visible
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore]);

  if (!hasMore) return null;

  return (
    <div ref={ref} className={`flex justify-center py-4 ${className}`}>
      <button
        onClick={onLoadMore}
        disabled={loading}
        className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-brand-700 disabled:opacity-60 px-3 py-1.5 rounded-full border border-gray-200 hover:border-brand-300 bg-white transition"
      >
        {loading ? <Loader2 size={13} className="animate-spin" /> : null}
        {loading ? 'Loading more…' : 'Load more'}
      </button>
    </div>
  );
}
