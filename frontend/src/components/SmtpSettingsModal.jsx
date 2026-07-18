import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';

const PRESETS = {
  gmail: {
    host: 'smtp.gmail.com', port: '587',
    hint: 'Use a Gmail App Password (not your normal password). Enable 2-Step Verification first, then go to Google Account → Security → App Passwords.',
  },
  outlook: {
    host: 'smtp-mail.outlook.com', port: '587',
    hint: 'Use your full Outlook/Hotmail email and password. May require enabling "Less secure app access" in account settings.',
  },
  custom: {
    host: '', port: '587',
    hint: 'Enter your SMTP server hostname and port. Port 587 = STARTTLS (recommended), 465 = SSL, 25 = plain.',
  },
};

const inp = 'w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none transition';

export default function SmtpSettingsModal({ onClose }) {
  const [smtp, setSmtp] = useState({
    host: 'smtp.gmail.com', port: '587', user: '', pass: '', fromName: '',
  });
  const [footer,   setFooter]   = useState('To opt out of future emails, reply with UNSUBSCRIBE.');
  const [preset,   setPreset]   = useState('gmail');
  const [showPass, setShowPass] = useState(false);
  const [testing,  setTesting]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [testMsg,  setTestMsg]  = useState(null);

  useEffect(() => {
    api.get('/settings').then(s => {
      try {
        const cfg = JSON.parse(s.smtp_config || '{}');
        if (cfg.host) {
          setSmtp(prev => ({ ...prev, ...cfg }));
          const matched = Object.entries(PRESETS).find(([, p]) => p.host === cfg.host);
          if (matched) setPreset(matched[0]);
          else setPreset('custom');
        }
      } catch {}
      if (s.unsubscribe_footer_text) setFooter(s.unsubscribe_footer_text);
    }).catch(() => {});
  }, []);

  const set = k => e => setSmtp(s => ({ ...s, [k]: e.target.value }));

  const applyPreset = (key) => {
    setPreset(key);
    setSmtp(s => ({ ...s, host: PRESETS[key].host, port: PRESETS[key].port }));
    setTestMsg(null);
  };

  const handleTest = async () => {
    if (!smtp.host || !smtp.user || !smtp.pass) {
      toast.error('Fill in host, username, and password first');
      return;
    }
    setTesting(true);
    setTestMsg(null);
    try {
      const r = await api.post('/email/test', smtp);
      setTestMsg({ ok: true, text: r.message });
      toast.success('SMTP connection verified!');
    } catch (err) {
      const msg = err.response?.data?.error || 'Connection failed';
      setTestMsg({ ok: false, text: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/settings', {
        smtp_config:            JSON.stringify(smtp),
        unsubscribe_footer_text: footer,
      });
      toast.success('Settings saved');
      onClose();
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">

        <div className="sticky top-0 bg-white flex items-center justify-between px-6 py-4 border-b z-10">
          <h2 className="text-base font-bold">Email / SMTP Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Presets */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">Provider</label>
            <div className="flex gap-2">
              {Object.keys(PRESETS).map(key => (
                <button key={key} type="button" onClick={() => applyPreset(key)}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg border transition capitalize
                    ${preset === key
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                >
                  {key}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 leading-relaxed">
              {PRESETS[preset]?.hint}
            </p>
          </div>

          {/* Host + Port */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1">SMTP Host</label>
              <input value={smtp.host} onChange={set('host')} placeholder="smtp.gmail.com" className={inp} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Port</label>
              <input value={smtp.port} onChange={set('port')} type="number" className={inp} />
            </div>
          </div>

          {/* Username */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Username / From Email</label>
            <input value={smtp.user} onChange={set('user')} type="email"
              placeholder="you@gmail.com" className={inp} />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              Password / App Password
            </label>
            <div className="relative">
              <input value={smtp.pass} onChange={set('pass')}
                type={showPass ? 'text' : 'password'}
                placeholder="••••••••••••••••"
                className={`${inp} pr-16`} />
              <button type="button" onClick={() => setShowPass(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600">
                {showPass ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {/* Display name */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Your Name (shown as sender)</label>
            <input value={smtp.fromName} onChange={set('fromName')}
              placeholder="Vishal Choudhary" className={inp} />
          </div>

          <hr />

          {/* Unsubscribe footer */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              Opt-out line (appended to every email)
            </label>
            <textarea value={footer} onChange={e => setFooter(e.target.value)} rows={2}
              className={`${inp} resize-none`} />
          </div>

          {/* Test result */}
          {testMsg && (
            <div className={`rounded-lg px-3 py-2 text-sm ${
              testMsg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}>
              {testMsg.ok ? '✓' : '✗'} {testMsg.text}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3">
            <button onClick={handleTest} disabled={testing}
              className="flex-1 border rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition">
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
