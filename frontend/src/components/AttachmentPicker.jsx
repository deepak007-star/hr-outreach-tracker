import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client.js';

/**
 * Modal for picking a resume to attach to an outgoing email.
 *
 * Props:
 *   profile   — profile object (has_resume_file, resume_filename)
 *   onSelect  — fn(attachment) where attachment is one of:
 *                 { type:'profile', label }
 *                 { type:'vault',   vaultId, label }
 *                 { type:'local',   data (base64), mimeType, label }
 *                 { type:'drive',   driveUrl, filename, label }
 *   onClose   — fn()
 */
export default function AttachmentPicker({ profile, onSelect, onClose }) {
  const [tab,           setTab]           = useState('device');
  const [vaultVersions, setVaultVersions] = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [driveUrl,      setDriveUrl]      = useState('');
  const [driveErr,      setDriveErr]      = useState('');
  const fileRef    = useRef(null);
  const userTabRef = useRef(false); // true once user manually selects a tab

  // Fetch vault once on mount; pick the best initial tab from what's available
  useEffect(() => {
    api.get('/resume-versions')
      .then(data => {
        const arr = Array.isArray(data) ? data : [];
        setVaultVersions(arr);
        if (!userTabRef.current) {
          if (profile?.has_resume_file) setTab('profile');
          else if (arr.some(v => v.has_file)) setTab('vault');
        }
      })
      .finally(() => setLoading(false));
  }, []); // run once — profile is captured in closure; see effect below for late-loading case

  // If parent's profile finishes loading AFTER vault data already arrived, upgrade to profile tab
  useEffect(() => {
    if (!loading && !userTabRef.current && profile?.has_resume_file) {
      setTab('profile');
    }
  }, [profile, loading]);

  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      onSelect({ type: 'local', label: file.name, data: base64, mimeType: file.type });
    };
    reader.readAsDataURL(file);
  }

  function handleDrive() {
    const url = driveUrl.trim();
    setDriveErr('');
    if (!url) { setDriveErr('Paste a Google Drive link first.'); return; }
    if (!url.includes('drive.google.com') && !url.includes('docs.google.com')) {
      setDriveErr('Please enter a valid Google Drive share link.'); return;
    }
    const nameMatch = url.match(/\/([^/?]+)\?/) || [];
    const label = nameMatch[1] ? decodeURIComponent(nameMatch[1]) : 'Drive Resume';
    onSelect({ type: 'drive', driveUrl: url, filename: 'resume.pdf', label: `Drive: ${label}` });
  }

  const vaultFiles = vaultVersions.filter(v => v.has_file);

  const TABS = [
    { id: 'profile', label: 'Profile' },
    { id: 'vault',   label: 'Vault' },
    { id: 'device',  label: 'Upload' },
    { id: 'drive',   label: 'Drive' },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-bold text-gray-800 text-sm">Attach Resume</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b">
          {TABS.map(t => (
            <button key={t.id} onClick={() => { userTabRef.current = true; setTab(t.id); }}
              className={`flex-1 py-2.5 text-xs font-semibold transition ${
                tab === t.id
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-4 max-h-[55vh] overflow-y-auto">

          {/* Profile tab */}
          {tab === 'profile' && (
            profile?.has_resume_file ? (
              <button
                onClick={() => onSelect({ type: 'profile', label: profile.resume_filename || 'Profile Resume' })}
                className="w-full text-left p-4 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition"
              >
                <div className="text-sm font-semibold text-blue-700">Use Profile Resume</div>
                <div className="text-xs text-blue-500 mt-0.5 truncate">{profile.resume_filename || 'Your uploaded resume'}</div>
              </button>
            ) : (
              <div className="text-center py-6 space-y-2">
                <p className="text-2xl">📄</p>
                <p className="text-sm font-medium text-gray-500">No resume in your profile</p>
                <p className="text-xs text-gray-400">Upload a resume on the Profile tab, or choose another source below.</p>
              </div>
            )
          )}

          {/* Vault tab */}
          {tab === 'vault' && (
            loading ? (
              <p className="text-xs text-gray-400 text-center py-6">Loading vault…</p>
            ) : vaultFiles.length > 0 ? (
              <div className="space-y-2">
                {vaultFiles.map(v => (
                  <button key={v.id} onClick={() => onSelect({ type: 'vault', vaultId: v.id, label: v.label })}
                    className="w-full text-left p-3 border rounded-xl hover:bg-gray-50 transition group">
                    <div className="text-sm font-medium text-gray-700 group-hover:text-blue-600 transition">{v.label}</div>
                    {v.target_role && <div className="text-xs text-gray-400 mt-0.5">{v.target_role}</div>}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 space-y-2">
                <p className="text-2xl">📂</p>
                <p className="text-sm font-medium text-gray-500">No files saved in vault yet</p>
                <p className="text-xs text-gray-400">Save a resume to the Vault first, or upload directly below.</p>
              </div>
            )
          )}

          {/* Device upload tab */}
          {tab === 'device' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">Select a PDF or DOCX file from your computer.</p>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.doc"
                className="hidden"
                onChange={e => e.target.files[0] && handleFile(e.target.files[0])}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full py-6 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition text-center"
              >
                <div className="text-3xl mb-2">📤</div>
                <div className="font-medium">Browse files</div>
                <div className="text-xs text-gray-400 mt-1">PDF, DOCX, DOC</div>
              </button>
            </div>
          )}

          {/* Google Drive tab */}
          {tab === 'drive' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Google Drive Share Link</label>
                <input
                  value={driveUrl}
                  onChange={e => { setDriveUrl(e.target.value); setDriveErr(''); }}
                  placeholder="https://drive.google.com/file/d/..."
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none"
                />
                {driveErr && <p className="text-xs text-red-500 mt-1">{driveErr}</p>}
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                The file must be shared as <strong>"Anyone with the link"</strong> in Google Drive settings.
              </div>
              <button
                onClick={handleDrive}
                disabled={!driveUrl.trim()}
                className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
              >
                Attach from Drive
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
