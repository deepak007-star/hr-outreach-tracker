import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';

const LS_KEY    = 'hr_outreach_reminder';
const HAS_NOTIF = typeof Notification !== 'undefined';
const DAYS_LIST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const GCAL_DAY  = { Mon:'MO', Tue:'TU', Wed:'WE', Thu:'TH', Fri:'FR', Sat:'SA', Sun:'SU' };

// ── Helpers ────────────────────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, '0'); }

function generateIcs({ time, days, message }) {
  const [h, m] = time.split(':').map(Number);
  const now = new Date();
  const dateStr = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}`;
  const startT  = `${pad(h)}${pad(m)}00`;
  const endMin  = (m + 5) % 60;
  const endH    = m + 5 >= 60 ? (h + 1) % 24 : h;
  const endT    = `${pad(endH)}${pad(endMin)}00`;
  const byday   = (days?.length ? days : ['Mon','Tue','Wed','Thu','Fri']).map(d => GCAL_DAY[d]).filter(Boolean).join(',');
  const desc    = (message || 'Time for your daily HR outreach goal!').replace(/[,;\\]/g, '\\$&');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HR Outreach Tracker//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `DTSTART:${dateStr}T${startT}`, `DTEND:${dateStr}T${endT}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${byday}`,
    'SUMMARY:HR Outreach Reminder', `DESCRIPTION:${desc}`,
    'BEGIN:VALARM', 'TRIGGER:-PT0S', 'ACTION:DISPLAY', `DESCRIPTION:${desc}`,
    'END:VALARM', 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

function googleCalUrl(time, message) {
  const [h, m] = time.split(':').map(Number);
  const now = new Date();
  const date   = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}`;
  const startT = `${pad(h)}${pad(m)}00`;
  const endMin = (m + 30) % 60;
  const endH   = m + 30 >= 60 ? h + 1 : h;
  const endT   = `${pad(endH % 24)}${pad(endMin)}00`;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent('HR Outreach Reminder')}&details=${encodeURIComponent(message || 'Daily HR outreach reminder')}&dates=${date}T${startT}%2F${date}T${endT}`;
}

function Toggle({ on, onChange }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative w-12 h-6 rounded-full transition-colors focus:outline-none shrink-0 ${on ? 'bg-brand-600' : 'bg-gray-300'}`}
    >
      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-0.5'}`} />
    </button>
  );
}

export default function ReminderModal({ onClose }) {
  const { user } = useAuth();
  const [enabled,         setEnabled]         = useState(false);
  const [time,            setTime]            = useState('09:00');
  const [days,            setDays]            = useState(['Mon','Tue','Wed','Thu','Fri']);
  const [message,         setMessage]         = useState('Time for your daily HR outreach goal!');
  const [deliveryToast,   setDeliveryToast]   = useState(true);
  const [deliveryBrowser, setDeliveryBrowser] = useState(false);
  const [deliveryEmail,   setDeliveryEmail]   = useState(false);
  const [permission,      setPermission]      = useState(HAS_NOTIF ? Notification.permission : 'denied');
  const [saving,          setSaving]          = useState(false);

  useEffect(() => {
    const applyConfig = (s) => {
      if (!s || !Object.keys(s).length) return false;
      if (s.enabled         !== undefined) setEnabled(s.enabled);
      if (s.time)                          setTime(s.time);
      if (s.days?.length)                  setDays(s.days);
      if (s.message)                       setMessage(s.message);
      if (s.deliveryToast   !== undefined) setDeliveryToast(s.deliveryToast);
      if (s.deliveryBrowser !== undefined) setDeliveryBrowser(s.deliveryBrowser);
      if (s.deliveryEmail   !== undefined) setDeliveryEmail(s.deliveryEmail);
      return true;
    };

    const loadLocal = () => {
      try { applyConfig(JSON.parse(localStorage.getItem(LS_KEY) || '{}')); } catch {}
    };

    if (user) {
      api.get('/reminder').then(s => { if (!applyConfig(s)) loadLocal(); }).catch(loadLocal);
    } else {
      loadLocal();
    }
  }, [user]);

  const config = { enabled, time, days, message, deliveryToast, deliveryBrowser, deliveryEmail };

  const save = async () => {
    if (enabled && !time) { toast.error('Please set a reminder time'); return; }
    if (enabled && days.length === 0) { toast.error('Select at least one day'); return; }
    if (enabled && !deliveryToast && !deliveryBrowser && !deliveryEmail) {
      toast.error('Enable at least one delivery method (toast, browser, or email)');
      return;
    }
    setSaving(true);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(config));
      if (user) await api.put('/reminder', config).catch(() => {});
      toast.success('Reminder saved!');
      onClose();
    } finally { setSaving(false); }
  };

  const testNow = () => {
    const msg = message || 'Time for your daily HR outreach goal!';
    let fired = false;
    if (deliveryToast) {
      toast('⏰ ' + msg, {
        duration: 8000,
        style: { border: '2px solid #2563eb', background: '#eff6ff', color: '#1e40af', fontWeight: 600 },
      });
      fired = true;
    }
    if (deliveryBrowser && HAS_NOTIF) {
      if (permission === 'granted') {
        try { new Notification('HR Outreach Tracker 🎯', { body: msg, icon: '/vite.svg' }); fired = true; }
        catch {}
      } else {
        toast.error('Browser notification permission not granted');
      }
    }
    if (deliveryEmail) {
      toast('📧 Email reminders are sent by the server at the configured time. Check your inbox then!', { duration: 6000 });
      fired = true;
    }
    if (!fired) toast.error('Enable at least one delivery method first');
  };

  const requestPermission = async () => {
    if (!HAS_NOTIF) return;
    const r = await Notification.requestPermission();
    setPermission(r);
  };

  const toggleDay = (d) =>
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);

  const downloadIcs = () => {
    const blob = new Blob([generateIcs(config)], { type: 'text/calendar;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'hr_outreach_reminder.ics' });
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Calendar file downloaded — open it to import into your calendar app.');
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-md shadow-modal w-full max-w-lg my-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-bold text-gray-800">🔔 Reminder Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="p-5 space-y-5 max-h-[76vh] overflow-y-auto">
          {/* Master toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-700 text-sm">Enable reminder</p>
              <p className="text-xs text-gray-400 mt-0.5">Get notified to do your daily HR outreach</p>
            </div>
            <Toggle on={enabled} onChange={setEnabled} />
          </div>

          {enabled && (
            <>
              {/* Time + Days */}
              <div className="space-y-4 p-4 bg-gray-50 rounded-md border">
                {/* Time */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Reminder time</label>
                  <input
                    type="time"
                    value={time}
                    onChange={e => setTime(e.target.value)}
                    className="border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none w-36 bg-white"
                  />
                </div>

                {/* Days */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Days</label>
                  <div className="flex gap-1 flex-wrap mb-2">
                    {[
                      { label: 'Weekdays', val: ['Mon','Tue','Wed','Thu','Fri'] },
                      { label: 'Every day', val: [...DAYS_LIST] },
                      { label: 'Mon/Wed/Fri', val: ['Mon','Wed','Fri'] },
                    ].map(preset => (
                      <button key={preset.label}
                        onClick={() => setDays(preset.val)}
                        className="text-xs px-2 py-1 bg-white border rounded-sm hover:bg-brand-50 text-gray-600 transition"
                      >{preset.label}</button>
                    ))}
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {DAYS_LIST.map(d => (
                      <button key={d} onClick={() => toggleDay(d)}
                        className={`text-xs px-2.5 py-1.5 rounded-sm font-medium border transition ${
                          days.includes(d)
                            ? 'bg-brand-600 text-white border-brand-600'
                            : 'bg-white text-gray-600 border-gray-300 hover:border-brand-400'
                        }`}>{d}</button>
                    ))}
                  </div>
                  {days.length === 0 && <p className="text-xs text-red-500 mt-1.5">Select at least one day</p>}
                </div>
              </div>

              {/* Custom message */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Reminder message</label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={2}
                  maxLength={200}
                  placeholder="Custom reminder message…"
                  className="w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none resize-none"
                />
                <p className="text-[10px] text-gray-400 text-right mt-0.5">{message.length}/200</p>
              </div>

              {/* Delivery methods */}
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">Delivery methods</p>
                <div className="space-y-2">

                  {/* In-app toast */}
                  <div className="flex items-start gap-3 p-3 rounded-md border hover:bg-gray-50 cursor-pointer" onClick={() => setDeliveryToast(v => !v)}>
                    <input type="checkbox" checked={deliveryToast} readOnly className="mt-0.5 pointer-events-none" />
                    <div>
                      <p className="text-sm font-medium text-gray-700">In-app popup (toast)</p>
                      <p className="text-xs text-gray-400">Shows a banner in the app while it's open in the browser</p>
                    </div>
                  </div>

                  {/* Browser notification */}
                  <div className="border rounded-md">
                    <div className="flex items-start gap-3 p-3 cursor-pointer hover:bg-gray-50 rounded-md" onClick={() => setDeliveryBrowser(v => !v)}>
                      <input type="checkbox" checked={deliveryBrowser} readOnly className="mt-0.5 pointer-events-none" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-700">Browser / OS notification</p>
                        <p className="text-xs text-gray-400">Shows in Windows Action Center (app must be open in browser)</p>
                      </div>
                    </div>
                    {deliveryBrowser && (
                      <div className="px-3 pb-3 -mt-1">
                        {!HAS_NOTIF && (
                          <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">Not supported in this browser</p>
                        )}
                        {HAS_NOTIF && permission === 'default' && (
                          <button onClick={requestPermission}
                            className="text-xs bg-brand-600 text-white px-3 py-1.5 rounded-sm hover:bg-brand-700 transition">
                            Allow notifications →
                          </button>
                        )}
                        {HAS_NOTIF && permission === 'granted' && (
                          <p className="text-xs text-green-600 font-medium">✓ Permission granted</p>
                        )}
                        {HAS_NOTIF && permission === 'denied' && (
                          <p className="text-xs text-red-600">Blocked — enable in browser site settings (lock icon in address bar)</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Email */}
                  <div
                    className={`flex items-start gap-3 p-3 rounded-md border hover:bg-gray-50 ${!user ? 'opacity-60' : 'cursor-pointer'}`}
                    onClick={() => user && setDeliveryEmail(v => !v)}
                  >
                    <input type="checkbox" checked={deliveryEmail} readOnly disabled={!user} className="mt-0.5 pointer-events-none" />
                    <div>
                      <p className="text-sm font-medium text-gray-700">
                        Email to {user?.email || 'your account'}
                        {!user && <span className="ml-1.5 text-xs text-amber-500 font-normal">(sign in first)</span>}
                      </p>
                      <p className="text-xs text-gray-400">Backend sends to your registered email (requires SMTP setup)</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Calendar section */}
              <div className="bg-brand-50 border border-brand-200 rounded-md p-4 space-y-3">
                <div>
                  <p className="text-xs font-semibold text-brand-800 mb-0.5">Add to calendar — works without login</p>
                  <p className="text-[11px] text-brand-600">Gets an OS-level reminder even when the app is closed</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={downloadIcs}
                    className="text-xs flex items-center gap-1.5 px-3 py-2 bg-white border border-brand-300 text-brand-700 rounded-sm hover:bg-brand-50 font-medium transition">
                    📅 Download .ics
                  </button>
                  <a
                    href={googleCalUrl(time, message)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs flex items-center gap-1.5 px-3 py-2 bg-white border border-brand-300 text-brand-700 rounded-sm hover:bg-brand-50 font-medium transition"
                  >
                    📆 Add to Google Calendar
                  </a>
                </div>
                <p className="text-[10px] text-brand-500 leading-relaxed">
                  Import the .ics into Google Calendar, Outlook, or Apple Calendar. Set the event to repeat on your selected days.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 p-5 border-t">
          {enabled && (
            <button onClick={testNow}
              className="px-4 py-2 border rounded-sm text-sm font-medium text-gray-600 hover:bg-gray-50 transition">
              ▶ Test now
            </button>
          )}
          <div className="flex-1 flex justify-end gap-2">
            <button onClick={onClose}
              className="px-4 py-2 border rounded-sm text-sm font-medium hover:bg-gray-50 transition">Cancel</button>
            <button onClick={save} disabled={saving || (enabled && days.length === 0)}
              className="px-5 py-2 bg-brand-600 text-white rounded-sm text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 transition">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
