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

const inp = 'w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none transition';

export default function SmtpSettingsModal({ onClose }) {
  const [smtp, setSmtp] = useState({
    host: 'smtp.gmail.com', port: '587', user: '', pass: '', fromName: '',
  });
  const [preset,   setPreset]   = useState('gmail');
  const [showPass, setShowPass] = useState(false);
  const [testing,  setTesting]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [testMsg,  setTestMsg]  = useState(null);
  const [google,     setGoogle]     = useState(null); // { connected, email } | null while loading
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const refreshGoogleStatus = () => api.get('/oauth/status').then(r => setGoogle(r.google)).catch(() => setGoogle({ connected: false }));

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
    }).catch(() => {});
    refreshGoogleStatus();
  }, []);

  const handleConnectGoogle = async () => {
    setConnecting(true);
    try {
      const { url } = await api.get('/oauth/google/start');
      window.location.href = url;
    } catch {
      toast.error('Could not start Google connection');
      setConnecting(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    setDisconnecting(true);
    try {
      await api.delete('/oauth/google');
      await refreshGoogleStatus();
      toast.success('Google account disconnected');
    } catch {
      toast.error('Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

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
    // If Google not connected, require at least the basic SMTP fields
    if (!google?.connected) {
      if (!smtp.host.trim()) { toast.error('SMTP host is required'); return; }
      const port = parseInt(smtp.port, 10);
      if (!smtp.port || isNaN(port) || port < 1 || port > 65535) {
        toast.error('Enter a valid port number (1–65535)');
        return;
      }
      if (!smtp.user.trim()) { toast.error('Username / From Email is required'); return; }
      if (!smtp.pass.trim()) { toast.error('Password / App Password is required'); return; }
    }
    setSaving(true);
    try {
      await api.put('/settings', {
        smtp_config: JSON.stringify(smtp),
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
      <div className="bg-white rounded-md shadow-modal w-full max-w-md max-h-[90vh] overflow-y-auto">

        <div className="sticky top-0 bg-white flex items-center justify-between px-6 py-4 border-b z-10">
          <h2 className="text-base font-bold">Email / SMTP Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Google OAuth connect */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">Send from Google (recommended)</label>
            {google === null ? (
              <div className="text-sm text-gray-400 px-3 py-2">Checking connection…</div>
            ) : google.connected ? (
              <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-sm px-3 py-2.5">
                <span className="text-sm text-green-800">✓ Connected as <strong>{google.email}</strong></span>
                <button onClick={handleDisconnectGoogle} disabled={disconnecting}
                  className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50">
                  {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </div>
            ) : (
              <button onClick={handleConnectGoogle} disabled={connecting}
                className="w-full flex items-center justify-center gap-2 border border-gray-300 rounded-sm py-2.5 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 transition">
                {connecting ? 'Redirecting…' : 'Connect Google Account'}
              </button>
            )}
            <p className="mt-2 text-xs text-gray-500 leading-relaxed">
              One click — sign in with Google and grant permission to send email on your behalf. No app password needed.
            </p>
          </div>

          <hr />

          {/* Manual SMTP fallback */}
          <details open={!google?.connected}>
            <summary className="text-xs font-semibold text-gray-600 cursor-pointer select-none">
              Advanced: Manual SMTP (for non-Gmail providers, or as a fallback)
            </summary>
            <div className="space-y-5 mt-4">
              {/* Presets */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">Provider</label>
                <div className="flex gap-2">
                  {Object.keys(PRESETS).map(key => (
                    <button key={key} type="button" onClick={() => applyPreset(key)}
                      className={`flex-1 py-2 text-sm font-medium rounded-sm border transition capitalize
                        ${preset === key
                          ? 'bg-brand-600 text-white border-brand-600'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                    >
                      {key}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-amber-700 bg-amber-50 rounded-sm px-3 py-2 leading-relaxed">
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
            </div>
          </details>

          {/* Test result */}
          {testMsg && (
            <div className={`rounded-sm px-3 py-2 text-sm ${
              testMsg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}>
              {testMsg.ok ? '✓' : '✗'} {testMsg.text}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3">
            <button onClick={handleTest} disabled={testing}
              className="flex-1 border rounded-sm py-2.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition">
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 bg-brand-600 text-white rounded-sm py-2.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 transition">
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
