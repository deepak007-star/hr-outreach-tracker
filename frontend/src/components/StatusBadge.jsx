const STYLES = {
  'New':            'bg-gray-100 text-gray-600',
  'Drafted':        'bg-brand-100 text-brand-700',
  'Sent':           'bg-yellow-100 text-yellow-800',
  'Opened':         'bg-lime-100 text-lime-700',
  'Replied':        'bg-green-100 text-green-700',
  'Interview':      'bg-emerald-100 text-emerald-700 font-semibold',
  'Rejected':       'bg-red-100 text-red-700',
  'Do Not Contact': 'bg-gray-700 text-gray-300 line-through',
};

export default function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${STYLES[status] || STYLES['New']}`}>
      {status}
    </span>
  );
}
