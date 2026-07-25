import { useState, useEffect, useCallback, useRef } from 'react';
import { api, API_ROOT } from '../api/client.js';
import { confirm } from '../utils/confirm.js';
import toast from 'react-hot-toast';
import { X, Eye, Pencil, Trash2, Plus, FolderOpen, Upload, Target } from 'lucide-react';

const MAX = 5;

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str.replace(' ', 'T') + 'Z');
  return isNaN(d) ? str.slice(0, 10) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const CARD_COLORS = ['bg-brand-600', 'bg-purple-600', 'bg-green-600', 'bg-orange-600', 'bg-pink-600'];

// ── Preview Modal ─────────────────────────────────────────────────────────────

function PreviewModal({ version, onClose }) {
  const [blobUrl,  setBlobUrl]  = useState(null);
  const [fallback, setFallback] = useState('');
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    let objUrl = null;

    async function load() {
      setLoading(true);
      // Try rich file preview first when the version has a stored file
      if (version.has_file) {
        try {
          const token = localStorage.getItem('hr_token');
          const resp = await fetch(`${API_ROOT}/api/resume-versions/${version.id}/file`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (resp.ok) {
            const blob = await resp.blob();
            objUrl = URL.createObjectURL(blob);
            setBlobUrl(objUrl);
            setLoading(false);
            return;
          }
        } catch { /* fall through to text */ }
      }
      // Fall back to extracted plain text
      try {
        const r = await api.get(`/resume-versions/${version.id}/text`);
        setFallback(r.resume_text || '');
      } catch {
        setFallback('Failed to load resume preview.');
      }
      setLoading(false);
    }

    load();
    return () => { if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [version.id, version.has_file]);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-md shadow-modal w-full max-w-4xl h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <h3 className="font-bold text-gray-900">{version.label || 'Resume Preview'}</h3>
            {version.target_role && <p className="text-xs text-gray-400 mt-0.5">Target: {version.target_role}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors"><X size={18} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden rounded-b-md">
          {loading ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading preview…</div>
          ) : blobUrl ? (
            <iframe
              src={blobUrl}
              className="w-full h-full border-0"
              title="Resume Preview"
            />
          ) : (
            <div className="h-full overflow-y-auto p-6">
              <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap leading-relaxed">{fallback}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Add Modal ─────────────────────────────────────────────────────────────────

const ADD_TABS = [
  { id: 'profile', label: 'Profile Resume' },
  { id: 'upload',  label: 'Upload File' },
  { id: 'drive',   label: 'Google Drive' },
  { id: 'paste',   label: 'Paste Text' },
];

function AddModal({ profileResume, vaultCount, onClose, onSaved }) {
  const [tab,          setTab]          = useState(profileResume?.resume_text ? 'profile' : 'upload');
  const [label,        setLabel]        = useState('');
  const [targetRole,   setTargetRole]   = useState('');
  const [pasteText,    setPasteText]    = useState('');
  const [driveUrl,     setDriveUrl]     = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [saving,       setSaving]       = useState(false);
  const fileRef = useRef(null);

  const willReplaceOldest = vaultCount >= MAX;

  const canSave = () => {
    if (tab === 'profile') return !!profileResume?.resume_text;
    if (tab === 'paste')   return pasteText.trim().length > 0;
    if (tab === 'upload')  return !!selectedFile;
    if (tab === 'drive')   return driveUrl.trim().length > 0;
    return false;
  };

  const handleSave = async () => {
    if (!canSave()) return;
    setSaving(true);
    try {
      let saved;

      if (tab === 'profile') {
        saved = await api.post('/resume-versions', {
          label:       label.trim() || `Profile Backup v${vaultCount + 1}`,
          resumeText:  profileResume.resume_text,
          targetRole:  targetRole.trim(),
          skills:      Array.isArray(profileResume?.skills) ? profileResume.skills : [],
          autoSaved:   false,
          fromProfile: true,
        });

      } else if (tab === 'paste') {
        saved = await api.post('/resume-versions', {
          label:      label.trim() || `Paste v${vaultCount + 1}`,
          resumeText: pasteText.trim(),
          targetRole: targetRole.trim(),
          skills:     [],
          autoSaved:  false,
        });

      } else if (tab === 'upload') {
        const formData = new FormData();
        formData.append('resume', selectedFile);
        formData.append('label', label.trim() || selectedFile.name);
        formData.append('targetRole', targetRole.trim());
        const token = localStorage.getItem('hr_token');
        const res = await fetch(`${API_ROOT}/api/resume-versions/upload`, {
          method:  'POST',
          headers: { Authorization: `Bearer ${token}` },
          body:    formData,
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
        saved = await res.json();

      } else if (tab === 'drive') {
        saved = await api.post('/resume-versions/from-drive', {
          driveUrl:   driveUrl.trim(),
          label:      label.trim() || 'Drive Import',
          targetRole: targetRole.trim(),
        });
      }

      toast.success('Resume saved to vault!');
      onSaved(saved);
    } catch (e) {
      toast.error(e.response?.data?.error || e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-md shadow-modal w-full max-w-lg">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="font-bold text-gray-900">Save Resume to Vault</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={18} /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b">
          {ADD_TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 py-2.5 text-xs font-semibold transition ${
                tab === t.id ? 'border-b-2 border-brand-600 text-brand-600' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-6 space-y-4">
          {willReplaceOldest && (
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">
              Vault is full (5/5). The oldest version will be automatically removed to make room.
            </div>
          )}

          {/* Profile tab */}
          {tab === 'profile' && (
            profileResume?.resume_text ? (
              <div className="bg-brand-50 border border-brand-200 rounded-sm px-4 py-3 text-sm text-brand-800">
                Uses your Profile resume: <strong>{profileResume.resume_filename || 'current resume'}</strong>
                <p className="text-xs text-brand-500 mt-1">Skills from your profile will be saved for auto-matching.</p>
              </div>
            ) : (
              <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-4">
                No resume found in your Profile. Upload one on the <strong>Profile</strong> tab, or use <strong>Upload File</strong> here.
              </div>
            )
          )}

          {/* Upload file tab */}
          {tab === 'upload' && (
            <div>
              <p className="text-xs text-gray-500 mb-3">Upload a PDF, DOCX, or TXT resume file from your device. Text will be extracted automatically.</p>
              <input ref={fileRef} type="file" accept=".pdf,.docx,.doc,.txt" className="hidden"
                onChange={e => { if (e.target.files[0]) { setSelectedFile(e.target.files[0]); if (!label.trim()) setLabel(e.target.files[0].name.replace(/\.[^.]+$/, '')); } }} />
              {selectedFile ? (
                <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-sm">
                  <Upload size={20} className="text-green-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-green-800 truncate">{selectedFile.name}</p>
                    <p className="text-xs text-green-600">{(selectedFile.size / 1024).toFixed(0)} KB</p>
                  </div>
                  <button onClick={() => setSelectedFile(null)} className="text-green-600 hover:text-red-500"><X size={14} /></button>
                </div>
              ) : (
                <button onClick={() => fileRef.current?.click()}
                  className="w-full py-6 border-2 border-dashed border-gray-300 rounded-sm text-sm text-gray-500 hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50/50 transition text-center">
                  <Upload size={28} className="mx-auto mb-1.5 opacity-50" />
                  <div className="font-medium">Click to browse files</div>
                  <div className="text-xs text-gray-400 mt-1">PDF, DOCX, DOC, TXT (max 10 MB)</div>
                </button>
              )}
            </div>
          )}

          {/* Google Drive tab */}
          {tab === 'drive' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Google Drive Share Link</label>
                <input value={driveUrl} onChange={e => setDriveUrl(e.target.value)}
                  placeholder="https://drive.google.com/file/d/..."
                  className="w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none" />
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                The file must be shared as <strong>"Anyone with the link"</strong> in Google Drive. Works with PDF and DOCX files.
              </div>
            </div>
          )}

          {/* Paste text tab */}
          {tab === 'paste' && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Paste your resume text</label>
              <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={9}
                placeholder="Paste your resume content here (plain text)…"
                className="w-full border rounded-sm px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-brand-300 outline-none resize-y" />
            </div>
          )}

          {/* Common label + role fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Version Label</label>
              <input value={label} onChange={e => setLabel(e.target.value)}
                placeholder="e.g. Java Backend v2"
                className="w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none" maxLength={80} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Target Role</label>
              <input value={targetRole} onChange={e => setTargetRole(e.target.value)}
                placeholder="e.g. Senior Backend Engineer"
                className="w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none" maxLength={80} />
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-6 pb-5">
          <button onClick={onClose} className="flex-1 border rounded-sm py-2.5 text-sm font-medium hover:bg-gray-50 transition">Cancel</button>
          <button onClick={handleSave} disabled={saving || !canSave()}
            className="flex-1 bg-brand-600 text-white rounded-sm py-2.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 transition">
            {saving
              ? (tab === 'drive' ? 'Importing from Drive…' : tab === 'upload' ? 'Uploading…' : 'Saving…')
              : 'Save to Vault'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Version Card ──────────────────────────────────────────────────────────────

function VersionCard({ version, index, onPreview, onDelete, onRename }) {
  const [editing,   setEditing]   = useState(false);
  const [editLabel, setEditLabel] = useState(version.label);
  const [saving,    setSaving]    = useState(false);

  const skills = Array.isArray(version.skills) ? version.skills : [];

  const commitRename = async () => {
    if (!editLabel.trim() || editLabel === version.label) { setEditing(false); return; }
    setSaving(true);
    try {
      await api.put(`/resume-versions/${version.id}`, { label: editLabel.trim() });
      onRename(version.id, editLabel.trim());
      setEditing(false);
    } catch { toast.error('Failed to rename'); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-white border rounded-md shadow-card hover:shadow-md transition-all flex flex-col">
      {/* Top colour band with number */}
      <div className={`${CARD_COLORS[index % CARD_COLORS.length]} rounded-t-md px-4 py-3 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-bold">
            {index + 1}
          </span>
          {version.auto_saved === 1 && (
            <span className="text-xs bg-white/20 text-white px-1.5 py-0.5 rounded">auto</span>
          )}
        </div>
        <span className="text-xs text-white/80">{formatDate(version.created_at)}</span>
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* Label */}
        {editing ? (
          <div className="flex gap-1.5">
            <input
              autoFocus
              value={editLabel}
              onChange={e => setEditLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(false); }}
              className="flex-1 text-sm font-semibold border rounded-sm px-2 py-1 focus:ring-2 focus:ring-brand-300 outline-none"
              maxLength={80}
            />
            <button onClick={commitRename} disabled={saving} className="text-xs px-2 py-1 bg-brand-600 text-white rounded-sm hover:bg-brand-700 disabled:opacity-50">
              {saving ? '…' : '✓'}
            </button>
            <button onClick={() => setEditing(false)} className="text-xs px-2 py-1 border rounded-sm hover:bg-gray-50"><X size={12} /></button>
          </div>
        ) : (
          <div className="flex items-start gap-1.5 group">
            <p className="font-semibold text-gray-900 text-sm leading-snug flex-1">{version.label}</p>
            <button
              onClick={() => { setEditing(true); setEditLabel(version.label); }}
              className="text-gray-300 hover:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5"
              title="Rename"
            >
              <Pencil size={12} />
            </button>
          </div>
        )}

        {/* Target role */}
        {version.target_role && (
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <Target size={11} className="text-gray-400 shrink-0" /> {version.target_role}
          </p>
        )}

        {/* Skills */}
        {skills.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {skills.slice(0, 5).map(s => (
              <span key={s} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">{s}</span>
            ))}
            {skills.length > 5 && (
              <span className="text-xs text-gray-400">+{skills.length - 5} more</span>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">No skills extracted</p>
        )}
      </div>

      {/* Footer actions */}
      <div className="border-t px-4 py-3 flex gap-2">
        <button
          onClick={onPreview}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium text-brand-600 border border-brand-200 rounded-sm py-1.5 hover:bg-brand-50 transition"
        >
          <Eye size={12} /> Preview
        </button>
        <button
          onClick={onDelete}
          className="flex items-center justify-center text-xs font-medium text-red-500 border border-red-100 rounded-sm px-3 py-1.5 hover:bg-red-50 transition"
          title="Remove from vault"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

// ── Empty Add Slot ────────────────────────────────────────────────────────────

function AddSlot({ onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="border-2 border-dashed border-gray-200 rounded-md p-6 flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-brand-300 hover:text-brand-500 hover:bg-brand-50/50 transition disabled:opacity-40 disabled:cursor-not-allowed"
      title={disabled ? 'Upload a resume to your Profile first' : 'Save current resume'}
    >
      <Plus size={24} className="opacity-70" />
      <span className="text-xs font-medium">Add resume version</span>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ResumeVault() {
  const [versions,       setVersions]       = useState([]);
  const [profileResume,  setProfileResume]  = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [showAdd,        setShowAdd]        = useState(false);
  const [previewVersion, setPreviewVersion] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [versionsRes, profileRes] = await Promise.all([
        api.get('/resume-versions'),
        api.get('/profile').catch(() => ({})),
      ]);
      setVersions(Array.isArray(versionsRes) ? versionsRes : []);
      setProfileResume(profileRes?.resume_text ? profileRes : null);
    } catch {
      toast.error('Failed to load Resume Vault');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    if (!await confirm('Remove this version from vault?')) return;
    try {
      await api.delete(`/resume-versions/${id}`);
      setVersions(prev => prev.filter(v => v.id !== id));
      toast.success('Version removed');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to remove');
    }
  };

  const handleRename = (id, newLabel) => {
    setVersions(prev => prev.map(v => v.id === id ? { ...v, label: newLabel } : v));
  };

  const handleSaved = (newVersion) => {
    setVersions(prev => {
      // If was full, drop the oldest displayed (server already removed it from DB)
      const trimmed = prev.length >= MAX ? prev.slice(0, MAX - 1) : prev;
      return [newVersion, ...trimmed];
    });
    setShowAdd(false);
  };

  const canAdd = versions.length < MAX;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Resume Vault</h2>
          <p className="text-sm text-gray-500 mt-1">
            Store up to 5 tailored resume versions. The best match is auto-suggested in Job Analyzer.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className={`text-sm font-semibold px-3 py-1 rounded-full border ${
            versions.length >= MAX
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-brand-50 text-brand-700 border-brand-200'
          }`}>
            {versions.length}/{MAX} saved
          </span>
          <button
            onClick={() => setShowAdd(true)}
            className="px-4 py-2 bg-brand-600 text-white text-sm font-semibold rounded-sm hover:bg-brand-700 transition"
          >
            + Save Resume
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="bg-brand-50 border border-brand-100 rounded-md p-4 flex gap-3">
        <FolderOpen size={18} className="text-brand-600 shrink-0 mt-0.5" />
        <div className="text-sm text-brand-800 space-y-1">
          <p><strong>How it works:</strong> Save different resume versions here — each tailored for a specific job type or company.</p>
          <p>In <strong>Job Analyzer</strong>, the vault auto-suggests whichever version covers the most required skills for that role.</p>
          <p className="text-brand-600 text-xs">Add from your Profile resume, upload a file (PDF/DOCX), import from Google Drive, or paste text directly.</p>
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Loading vault…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {versions.map((v, i) => (
            <VersionCard
              key={v.id}
              version={v}
              index={i}
              onPreview={() => setPreviewVersion(v)}
              onDelete={() => handleDelete(v.id)}
              onRename={handleRename}
            />
          ))}

          {/* Show empty slots up to MAX */}
          {versions.length < MAX && (
            <AddSlot disabled={false} onClick={() => setShowAdd(true)} />
          )}

          {versions.length === 0 && (
            <div className="col-span-full text-center py-16 text-gray-400 space-y-2">
              <FolderOpen size={40} className="mx-auto text-gray-300" />
              <p className="font-medium text-gray-600">Khaali table ek shuruaat hai, haar nahi.</p>
              <p className="text-sm text-gray-400">Click "+ Save Resume" to add a version from your Profile or paste text directly.</p>
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <AddModal
          profileResume={profileResume}
          vaultCount={versions.length}
          onClose={() => setShowAdd(false)}
          onSaved={handleSaved}
        />
      )}

      {previewVersion && (
        <PreviewModal version={previewVersion} onClose={() => setPreviewVersion(null)} />
      )}
    </div>
  );
}
