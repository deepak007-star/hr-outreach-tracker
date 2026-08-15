// Compact summary strip for the Contacts page — full StatTiles are on the Dashboard.
// `summary` comes from GET /contacts/summary — true counts across every contact
// matching the current filters, independent of how many pages are loaded.
export default function StatsBar({ summary }) {
  const total      = summary?.total ?? 0;
  const contacted  = summary?.emailed ?? 0;
  const replied    = summary?.replied ?? 0;
  const interviews = summary?.interviews ?? 0;
  const pct = n => total ? `${Math.round((n / total) * 100)}%` : '—';

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 bg-white rounded-md shadow-card border border-gray-100 text-xs text-gray-500">
      <span>
        <span className="font-semibold text-gray-900">{total}</span> contacts
      </span>
      <span className="text-gray-200 hidden sm:inline">·</span>
      <span>
        <span className="font-semibold text-brand-600">{contacted}</span>
        <span className="text-gray-400"> contacted ({pct(contacted)})</span>
      </span>
      <span className="text-gray-200 hidden sm:inline">·</span>
      <span>
        <span className="font-semibold text-emerald-600">{replied}</span>
        <span className="text-gray-400"> replied ({pct(replied)})</span>
      </span>
      <span className="text-gray-200 hidden sm:inline">·</span>
      <span>
        <span className="font-semibold text-green-600">{interviews}</span>
        <span className="text-gray-400"> interview{interviews !== 1 ? 's' : ''}</span>
      </span>
    </div>
  );
}
