/**
 * StatusPill — the single authoritative status badge.
 * Used identically on Dashboard, Contacts table, Admin panel, and anywhere
 * a contact/lead status is shown. Never recreate status coloring elsewhere.
 *
 * Semantic mapping (must match dashboard pipeline colors):
 *   New          → slate
 *   Drafted      → blue
 *   Sent         → amber
 *   Opened       → violet
 *   Replied      → emerald
 *   Interview    → green (bold)
 *   Rejected     → red
 *   Do Not Contact → neutral + strikethrough
 */

const STATUS_MAP = {
  'New':            'bg-slate-100  text-slate-600   border-slate-200',
  'Drafted':        'bg-blue-50    text-blue-700    border-blue-200',
  'Sent':           'bg-amber-50   text-amber-700   border-amber-200',
  'Opened':         'bg-violet-50  text-violet-700  border-violet-200',
  'Replied':        'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Interview':      'bg-green-50   text-green-800   border-green-300  font-semibold',
  'Rejected':       'bg-red-50     text-red-700     border-red-200',
  'Do Not Contact': 'bg-gray-50    text-gray-400    border-gray-200   line-through',
};

export default function StatusPill({ status, className = '' }) {
  const cls = STATUS_MAP[status] ?? 'bg-gray-100 text-gray-500 border-gray-200';
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs rounded-sm border leading-none ${cls} ${className}`}
    >
      {status}
    </span>
  );
}

/** Dot-only indicator (for smaller contexts like table rows) */
export function StatusDot({ status }) {
  const dotMap = {
    'New':            'bg-slate-400',
    'Drafted':        'bg-blue-500',
    'Sent':           'bg-amber-500',
    'Opened':         'bg-violet-500',
    'Replied':        'bg-emerald-500',
    'Interview':      'bg-green-600',
    'Rejected':       'bg-red-500',
    'Do Not Contact': 'bg-gray-300',
  };
  return (
    <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${dotMap[status] ?? 'bg-gray-300'}`} />
  );
}
