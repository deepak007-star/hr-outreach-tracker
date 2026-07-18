import { useState, useEffect } from 'react';
import { api } from '../api/client.js';

const MONTHS  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Tailwind classes must be complete strings for purge detection
const LEVEL_CLS = [
  'bg-gray-100 border-gray-200',   // 0  no activity
  'bg-green-200 border-green-300', // 1  1 action
  'bg-green-400 border-green-500', // 2  2-3 actions
  'bg-green-600 border-green-700', // 3  4-6 actions
  'bg-green-800 border-green-900', // 4  7+ actions
];

function fmt(d) {
  return d.toISOString().split('T')[0];
}

function level(total) {
  if (!total)     return 0;
  if (total <= 1) return 1;
  if (total <= 3) return 2;
  if (total <= 6) return 3;
  return 4;
}

function buildGrid(map) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = fmt(today);

  // Sunday of the week that started 51 weeks ago
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay() - 51 * 7);

  const weeks = [];
  const cur = new Date(start);
  for (let w = 0; w < 52; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const s = fmt(cur);
      const act = map[s] || { emails_sent: 0, contacts_added: 0, total: 0 };
      week.push({ date: s, ...act, isFuture: cur > today, isToday: s === todayStr });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function calcStats(map) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // current streak
  let cur = 0;
  const check = new Date(today);
  if (!(map[fmt(check)]?.total > 0)) check.setDate(check.getDate() - 1);
  while (map[fmt(check)]?.total > 0) {
    cur++;
    check.setDate(check.getDate() - 1);
    if (cur > 3650) break;
  }

  // longest streak
  const dates = Object.keys(map).filter(d => map[d].total > 0).sort();
  let longest = 0, streak = 0;
  for (let i = 0; i < dates.length; i++) {
    streak = i === 0
      ? 1
      : Math.round((new Date(dates[i]) - new Date(dates[i - 1])) / 86400000) === 1
        ? streak + 1
        : 1;
    if (streak > longest) longest = streak;
  }

  const totalEmails   = Object.values(map).reduce((s, d) => s + (d.emails_sent   || 0), 0);
  const totalContacts = Object.values(map).reduce((s, d) => s + (d.contacts_added || 0), 0);

  return { cur, longest, activeDays: dates.length, totalEmails, totalContacts };
}

export default function ActivityCalendar({ refreshKey = 0 }) {
  const [map,     setMap]     = useState({});
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState(null); // { x, y, cell }

  useEffect(() => {
    setLoading(true);
    api.get('/stats/activity', { params: { days: 365 } })
      .then(data => {
        const m = {};
        data.forEach(d => { m[d.date] = d; });
        setMap(m);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refreshKey]);

  if (loading) return null;

  const weeks = buildGrid(map);
  const stats = calcStats(map);

  // Month label: first week of each month gets a label
  const monthLabels = {};
  weeks.forEach((week, wi) => {
    const mo = new Date(week[0].date).getMonth();
    if (wi === 0 || new Date(weeks[wi - 1][0].date).getMonth() !== mo) {
      monthLabels[wi] = MONTHS[mo];
    }
  });

  return (
    <div className="bg-white rounded-xl border shadow-sm p-5">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-sm font-semibold text-gray-700">Outreach Activity</h2>
        <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
          <span title="Consecutive days with activity ending today">
            🔥 <strong className="text-gray-800">{stats.cur}</strong> day streak
          </span>
          <span>⚡ Longest: <strong className="text-gray-800">{stats.longest}</strong></span>
          <span>✅ <strong className="text-gray-800">{stats.activeDays}</strong> active days</span>
          <span>📧 <strong className="text-gray-800">{stats.totalEmails}</strong> emails sent</span>
          <span>👤 <strong className="text-gray-800">{stats.totalContacts}</strong> contacts added</span>
        </div>
      </div>

      <div className="overflow-x-auto select-none">
        {/* Month labels row */}
        <div className="flex mb-1" style={{ paddingLeft: 28, gap: 2, minWidth: 'max-content' }}>
          {weeks.map((_, wi) => (
            <div key={wi}
              className="text-gray-400 overflow-visible whitespace-nowrap"
              style={{ width: 12, flexShrink: 0, fontSize: 9 }}>
              {monthLabels[wi] || ''}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="flex" style={{ gap: 2 }}>
          {/* Day-of-week labels */}
          <div className="flex flex-col mr-1" style={{ gap: 2 }}>
            {['', 'Mon', '', 'Wed', '', 'Fri', ''].map((label, i) => (
              <div key={i} className="text-gray-400 flex items-center justify-end pr-1"
                style={{ width: 20, height: 12, fontSize: 9, lineHeight: '12px' }}>
                {label}
              </div>
            ))}
          </div>

          {/* Week columns */}
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col" style={{ gap: 2 }}>
              {week.map((cell, di) => (
                <div
                  key={di}
                  style={{ width: 12, height: 12 }}
                  className={[
                    'rounded-sm border cursor-default transition-transform hover:scale-125',
                    cell.isFuture
                      ? 'bg-gray-50 border-gray-100 opacity-20'
                      : LEVEL_CLS[level(cell.total)],
                    cell.isToday ? 'outline outline-2 outline-blue-500' : '',
                  ].join(' ')}
                  onMouseEnter={e => {
                    if (!cell.isFuture) setTooltip({ x: e.clientX, y: e.clientY, cell });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-1.5 mt-3" style={{ paddingLeft: 28 }}>
          <span className="text-xs text-gray-400">Less</span>
          {LEVEL_CLS.map((cls, i) => (
            <div key={i} className={`rounded-sm border ${cls}`} style={{ width: 12, height: 12 }} />
          ))}
          <span className="text-xs text-gray-400">More</span>
          <span className="ml-3 text-xs text-gray-400">
            <span className="inline-block w-3 h-3 rounded-sm outline outline-2 outline-blue-500 bg-gray-100 border border-gray-200 align-middle mr-0.5" />
            Today
          </span>
        </div>
      </div>

      {/* Floating tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none"
          style={{ left: tooltip.x + 12, top: tooltip.y - 72 }}
        >
          <div className="font-semibold mb-1">{tooltip.cell.date}{tooltip.cell.isToday ? ' · Today' : ''}</div>
          <div>📧 {tooltip.cell.emails_sent || 0} email{tooltip.cell.emails_sent !== 1 ? 's' : ''} sent</div>
          <div>👤 {tooltip.cell.contacts_added || 0} contact{tooltip.cell.contacts_added !== 1 ? 's' : ''} added</div>
        </div>
      )}
    </div>
  );
}
