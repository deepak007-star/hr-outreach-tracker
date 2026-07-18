export default function StatsBar({ contacts }) {
  const total      = contacts.length;
  const contacted  = contacts.filter(c => ['Sent','Opened','Replied','Interview'].includes(c.status)).length;
  const replied    = contacts.filter(c => ['Replied','Interview'].includes(c.status)).length;
  const interviews = contacts.filter(c => c.status === 'Interview').length;
  const pct = n => total ? `${Math.round((n / total) * 100)}%` : '—';

  const cards = [
    { label: 'Total Contacts',  value: total,                    color: 'text-slate-700' },
    { label: 'Contacted',       value: `${contacted} (${pct(contacted)})`, color: 'text-blue-600' },
    { label: 'Replied',         value: `${replied} (${pct(replied)})`,     color: 'text-green-600' },
    { label: 'Interviews',      value: interviews,               color: 'text-emerald-600' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map(({ label, value, color }) => (
        <div key={label} className="bg-white rounded-xl border shadow-sm p-4">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</p>
          <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
        </div>
      ))}
    </div>
  );
}
