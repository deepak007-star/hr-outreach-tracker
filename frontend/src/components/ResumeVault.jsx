import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';
import toast from 'react-hot-toast';

const MAX = 5;

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str.replace(' ', 'T') + 'Z');
  return isNaN(d) ? str.slice(0, 10) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const CARD_COLORS = ['bg-blue-600', 'bg-purple-600', 'bg-green-600', 'bg-orange-600', 'bg-pink-600'];

// ── Preview Modal ─────────────────────────────────────────────────────────────

function PreviewModal({ versionId, onClose }) {
  const [text, setText]       = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get(`/resume-versions/${versionId}/text`)
      .then(r => setText(r.resume_text || ''))
      .catch(() => setText('Failed to load resume text.'))
      .finally(() => setLoading(false));
  }, [versionId]);
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h3 className="font-bold text-gray-900">Resume Preview</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center py-12 text-gray-400">Loading…</div>
          ) : (
            <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap leading-relaxed">{text}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Add Modal ─────────────────────────────────────────────────────────────────

function AddModal({ profileResume, vaultCount, onClose, onSaved }) {
  const [tab,        setTab]        = useState(profileResume?.resume_text ? 'profile' : 'paste');
  const [label,      setLabel]      = useState('');
  const [targetRole, setTargetRole] = useState('');
  const [pasteText,  setPasteText]  = useState('');
  const [saving,     setSaving]     = useState(false);

  const willReplaceOldest = vaultCount >= MAX;

  const getResumeText = () => tab === 'paste' ? pasteText.trim() : (profileResume?.resume_text || '');
  const getSkills     = () => tab === 'paste' ? [] : (Array.isArray(profileResume?.skills) ? profileResume.skills : []);
  const canSave       = () => tab === 'paste' ? pasteText.trim().length > 0 : !!profileResume?.resume_text;

  const handleSave = async () => {
    const resumeText = getResumeText();
    if (!resumeText) return;
    setSaving(true);
    try {
      const saved = await api.post('/resume-versions', {
        label:      label.trim() || `Version ${vaultCount >= MAX ? MAX : vaultCount + 1}`,
        resumeText,
        targetRole: targetRole.trim(),
        skills:     getSkills(),
        autoSaved:  false,
      });
      toast.success('Resume saved to vault!');
      onSaved(saved);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="px-6 py-4 border-b">
          <h3 className="font-bold text-gray-900">Save Resume to Vault</h3>
        </div>

        {/* Tabs */}
        <div className="flex border-b">
          <button
            onClick={() => setTab('profile')}
            className={`flex-1 py-2.5 text-sm font-medium transition ${tab === 'profile' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            From Profile Resume
          </button>
          <button
            onClick={() => setTab('paste')}
            className={`flex-1 py-2.5 text-sm font-medium transition ${tab === 'paste' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Paste Text
          </button>
        </div>

        <div className="p-6 space-y-4">
          {willReplaceOldest && (
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">
              ⚠ Vault is full (5/5). The oldest version will be automatically removed to make room.
            </div>
          )}

          {tab === 'profile' ? (
            profileResume?.resume_text ? (
              <p className="text-xs text-gray-500 bg-gray-50 border rounded-lg px-3 py-2">
                Uses your Profile resume: <strong>{profileResume.resume_filename || 'current resume'}</strong>
              </p>
            ) : (
              <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-4">
                No resume found in your Profile. Upload one on the <strong>Profile</strong> tab, or switch to <strong>Paste Text</strong> to add manually.
              </div>
            )
          ) : (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Paste your resume text</label>
              <textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                rows={9}
                placeholder="Paste your resume content here (plain text)…"
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-300 outline-none resize-y"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Version Label</label>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder={`e.g. Backend Dev v${vaultCount + 1}, Java + Microservices`}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none"
              maxLength={80}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Target Role / Job Type</label>
            <input
              value={targetRole}
              onChange={e => setTargetRole(e.target.value)}
              placeholder="e.g. Senior Backend Engineer, Fullstack Developer"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none"
              maxLength={80}
            />
          </div>
          {tab === 'profile' && (
            <p className="text-xs text-gray-400">Skills from your profile will be saved with this version for auto-matching.</p>
          )}
        </div>

        <div className="flex gap-3 px-6 pb-5">
          <button onClick={onClose} className="flex-1 border rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || !canSave()}
            className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {saving ? 'Saving…' : 'Save to Vault'}
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
    <div className="bg-white border rounded-xl shadow-sm hover:shadow-md transition-all flex flex-col">
      {/* Top colour band with number */}
      <div className={`${CARD_COLORS[index % CARD_COLORS.length]} rounded-t-xl px-4 py-3 flex items-center justify-between`}>
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
              className="flex-1 text-sm font-semibold border rounded px-2 py-1 focus:ring-2 focus:ring-blue-300 outline-none"
              maxLength={80}
            />
            <button onClick={commitRename} disabled={saving} className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
              {saving ? '…' : '✓'}
            </button>
            <button onClick={() => setEditing(false)} className="text-xs px-2 py-1 border rounded hover:bg-gray-50">✕</button>
          </div>
        ) : (
          <div className="flex items-start gap-1.5 group">
            <p className="font-semibold text-gray-900 text-sm leading-snug flex-1">{version.label}</p>
            <button
              onClick={() => { setEditing(true); setEditLabel(version.label); }}
              className="text-gray-300 hover:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5"
              title="Rename"
            >
              ✏️
            </button>
          </div>
        )}

        {/* Target role */}
        {version.target_role && (
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <span className="text-gray-400">🎯</span> {version.target_role}
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
          className="flex-1 text-xs font-medium text-blue-600 border border-blue-200 rounded-lg py-1.5 hover:bg-blue-50 transition"
        >
          👁 Preview
        </button>
        <button
          onClick={onDelete}
          className="text-xs font-medium text-red-500 border border-red-100 rounded-lg px-3 py-1.5 hover:bg-red-50 transition"
          title="Remove from vault"
        >
          🗑
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
      className="border-2 border-dashed border-gray-200 rounded-xl p-6 flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50/50 transition disabled:opacity-40 disabled:cursor-not-allowed"
      title={disabled ? 'Upload a resume to your Profile first' : 'Save current resume'}
    >
      <span className="text-2xl">➕</span>
      <span className="text-xs font-medium">Add resume version</span>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ResumeVault() {
  const [versions,      setVersions]      = useState([]);
  const [profileResume, setProfileResume] = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [showAdd,       setShowAdd]       = useState(false);
  const [previewId,     setPreviewId]     = useState(null);

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
    if (!window.confirm('Remove this version from vault?')) return;
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
          <h2 className="text-2xl font-bold text-gray-900">📂 Resume Vault</h2>
          <p className="text-sm text-gray-500 mt-1">
            Store up to 5 tailored resume versions. The best match is auto-suggested in Job Analyzer.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className={`text-sm font-semibold px-3 py-1 rounded-full border ${
            versions.length >= MAX
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-blue-50 text-blue-700 border-blue-200'
          }`}>
            {versions.length}/{MAX} saved
          </span>
          <button
            onClick={() => setShowAdd(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition"
          >
            + Save Resume
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl p-4 flex gap-3">
        <span className="text-xl shrink-0">💡</span>
        <div className="text-sm text-blue-800 space-y-1">
          <p><strong>How it works:</strong> Save different resume versions here — each tailored for a specific job type or company.</p>
          <p>In <strong>Job Analyzer</strong>, the vault auto-suggests whichever version covers the most required skills for that role.</p>
          <p className="text-blue-600 text-xs">Add from your Profile resume or paste any text directly. First 5 Profile uploads are auto-saved.</p>
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
              onPreview={() => setPreviewId(v.id)}
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
              <p className="text-4xl">📂</p>
              <p className="font-medium text-gray-500">Your vault is empty</p>
              <p className="text-sm">Click "+ Save Resume" to add a version from your Profile or paste text directly.</p>
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

      {previewId && (
        <PreviewModal versionId={previewId} onClose={() => setPreviewId(null)} />
      )}
    </div>
  );
}
