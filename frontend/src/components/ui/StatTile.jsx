/**
 * StatTile — shared stat card for Dashboard and Admin.
 * One visual style: white card, accent ONLY on the icon chip — never the whole tile.
 * The "signal ping" motif optionally animates the icon for live/active metrics.
 *
 * Props:
 *   icon      — lucide-react element
 *   label     — e.g. "Contacts Tracked"
 *   value     — primary number/string
 *   sub       — secondary line (e.g. "+5 this week")
 *   accent    — tailwind color name without number (brand|emerald|amber|violet|blue|red)
 *   pulse     — boolean: show signal-ping on icon (for "live" stats)
 *   onClick   — optional click handler
 */

const ACCENT = {
  brand:   'bg-brand-50   text-brand-600   border-brand-100',
  emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  amber:   'bg-amber-50   text-amber-600   border-amber-100',
  violet:  'bg-violet-50  text-violet-600  border-violet-100',
  blue:    'bg-blue-50    text-blue-600    border-blue-100',
  red:     'bg-red-50     text-red-600     border-red-100',
  green:   'bg-green-50   text-green-600   border-green-100',
  slate:   'bg-slate-100  text-slate-600   border-slate-200',
};

export default function StatTile({ icon, label, value, sub, accent = 'brand', pulse = false, onClick }) {
  const iconCls = ACCENT[accent] ?? ACCENT.brand;
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-md shadow-card border border-gray-100 p-4 flex items-start gap-4 ${
        onClick ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-modal transition-all duration-150' : ''
      }`}
    >
      <div className={`relative shrink-0 w-10 h-10 rounded-md border flex items-center justify-center ${iconCls}`}>
        {pulse && (
          <span className="absolute inset-0 rounded-md bg-current opacity-20 animate-signal-ping" />
        )}
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-400 font-medium leading-none mb-1 truncate">{label}</p>
        <p className="text-xl font-semibold text-gray-900 leading-tight">{value ?? '—'}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}
