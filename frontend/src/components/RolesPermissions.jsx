import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';
import { confirm } from '../utils/confirm.js';

const RESOURCE_LABELS = {
  contacts: '👥 Contacts',
  email:    '📧 Email',
  jobs:     '💼 Jobs & Scraper',
  profile:  '👤 Profile',
  admin:    '🔐 Admin',
};

const ROLE_COLORS = {
  admin: 'bg-red-100 text-red-800 border-red-300',
  user:  'bg-blue-100 text-blue-800 border-blue-300',
  demo:  'bg-yellow-100 text-yellow-800 border-yellow-300',
  guest: 'bg-gray-100 text-gray-700 border-gray-300',
};
function roleColor(name) {
  return ROLE_COLORS[name] || 'bg-purple-100 text-purple-800 border-purple-300';
}

export default function RolesPermissions() {
  const [roles,       setRoles]       = useState([]);
  const [grouped,     setGrouped]     = useState({});
  const [allPerms,    setAllPerms]    = useState([]);
  const [selectedRole, setSelectedRole] = useState(null);
  const [draft,       setDraft]       = useState(new Set()); // permission names for selected role
  const [dirty,       setDirty]       = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [showCreate,  setShowCreate]  = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [creating,    setCreating]    = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const [r, p] = await Promise.all([
        api.get('/rbac/roles'),
        api.get('/rbac/permissions'),
      ]);
      setRoles(r);
      setGrouped(p.grouped);
      setAllPerms(p.permissions);
      if (r.length && !selectedRole) selectRole(r[0], r[0].permissions);
    } catch { toast.error('Failed to load roles'); }
  }

  function selectRole(role, perms) {
    setSelectedRole(role);
    setDraft(new Set(perms || role.permissions || []));
    setDirty(false);
  }

  function togglePerm(permName) {
    setDraft(prev => {
      const next = new Set(prev);
      next.has(permName) ? next.delete(permName) : next.add(permName);
      return next;
    });
    setDirty(true);
  }

  function toggleAll(resource, permsInGroup) {
    const names = permsInGroup.map(p => p.name);
    const allOn = names.every(n => draft.has(n));
    setDraft(prev => {
      const next = new Set(prev);
      names.forEach(n => allOn ? next.delete(n) : next.add(n));
      return next;
    });
    setDirty(true);
  }

  async function savePermissions() {
    if (!selectedRole) return;
    setSaving(true);
    try {
      await api.put(`/rbac/roles/${selectedRole.id}/permissions`, {
        permissions: [...draft],
      });
      toast.success(`Permissions saved for "${selectedRole.name}"`);
      setDirty(false);
      // Update local state
      setRoles(prev => prev.map(r =>
        r.id === selectedRole.id ? { ...r, permissions: [...draft] } : r
      ));
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save permissions');
    } finally { setSaving(false); }
  }

  async function createRole() {
    if (!newRoleName.trim()) return;
    setCreating(true);
    try {
      const created = await api.post('/rbac/roles', {
        name: newRoleName.trim(),
        description: newRoleDesc.trim(),
        permissions: [],
      });
      toast.success(`Role "${created.name}" created`);
      setRoles(prev => [...prev, created]);
      setShowCreate(false);
      setNewRoleName('');
      setNewRoleDesc('');
      selectRole(created, []);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to create role');
    } finally { setCreating(false); }
  }

  async function deleteRole(role) {
    if (!await confirm(`Delete role "${role.name}"? Users with this role will be moved to "user".`)) return;
    try {
      await api.delete(`/rbac/roles/${role.id}`);
      toast.success(`Role "${role.name}" deleted`);
      const next = roles.filter(r => r.id !== role.id);
      setRoles(next);
      if (selectedRole?.id === role.id) {
        const fallback = next[0];
        if (fallback) selectRole(fallback, fallback.permissions);
        else setSelectedRole(null);
      }
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to delete role');
    }
  }

  return (
    <div className="flex gap-4 h-full min-h-[500px]">
      {/* ── Left: Role list ─────────────────────────── */}
      <div className="w-56 flex-shrink-0 flex flex-col gap-2">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-bold text-gray-700">Roles</h3>
          <button
            onClick={() => setShowCreate(true)}
            className="text-xs px-2 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold"
          >+ New</button>
        </div>

        {roles.map(role => (
          <button
            key={role.id}
            onClick={() => selectRole(role, role.permissions)}
            className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all text-sm
              ${selectedRole?.id === role.id
                ? 'ring-2 ring-blue-400 border-blue-300 bg-blue-50'
                : 'border-gray-200 bg-white hover:bg-gray-50'}`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${roleColor(role.name)}`}>
                {role.name}
              </span>
              {role.is_system
                ? <span className="text-xs text-gray-400">system</span>
                : <button
                    onClick={e => { e.stopPropagation(); deleteRole(role); }}
                    className="text-red-400 hover:text-red-600 text-xs font-bold"
                    title="Delete role"
                  >✕</button>
              }
            </div>
            {role.description && (
              <p className="text-xs text-gray-500 mt-1 truncate">{role.description}</p>
            )}
            <p className="text-xs text-gray-400 mt-0.5">{role.permissions?.length || 0} permissions</p>
          </button>
        ))}

        {showCreate && (
          <div className="border border-blue-200 rounded-xl p-3 bg-blue-50 flex flex-col gap-2">
            <input
              autoFocus
              value={newRoleName}
              onChange={e => setNewRoleName(e.target.value)}
              placeholder="role name"
              className="w-full border rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-300 outline-none"
            />
            <input
              value={newRoleDesc}
              onChange={e => setNewRoleDesc(e.target.value)}
              placeholder="description (optional)"
              className="w-full border rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-300 outline-none"
            />
            <div className="flex gap-1.5">
              <button
                onClick={createRole}
                disabled={creating || !newRoleName.trim()}
                className="flex-1 text-xs py-1.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
              >{creating ? '…' : 'Create'}</button>
              <button
                onClick={() => { setShowCreate(false); setNewRoleName(''); setNewRoleDesc(''); }}
                className="text-xs px-2 py-1.5 border rounded-lg hover:bg-gray-100"
              >Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Right: Permission matrix ─────────────────── */}
      <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
        {!selectedRole ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Select a role to edit permissions
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div>
                <span className={`text-sm font-bold px-3 py-1 rounded-full border ${roleColor(selectedRole.name)}`}>
                  {selectedRole.name}
                </span>
                {selectedRole.is_system && (
                  <span className="ml-2 text-xs text-gray-400">(system role — permissions editable)</span>
                )}
              </div>
              <button
                onClick={savePermissions}
                disabled={!dirty || saving}
                className="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? 'Saving…' : dirty ? '💾 Save Changes' : '✓ Saved'}
              </button>
            </div>

            {/* Permission groups */}
            {Object.entries(grouped).map(([resource, perms]) => {
              const allOn  = perms.every(p => draft.has(p.name));
              const someOn = perms.some(p => draft.has(p.name));
              return (
                <div key={resource} className="bg-white border rounded-xl overflow-hidden">
                  <div
                    className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b cursor-pointer hover:bg-gray-100"
                    onClick={() => toggleAll(resource, perms)}
                  >
                    <span className="text-sm font-semibold text-gray-700">
                      {RESOURCE_LABELS[resource] || resource}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">
                        {perms.filter(p => draft.has(p.name)).length}/{perms.length}
                      </span>
                      <input
                        type="checkbox"
                        readOnly
                        checked={allOn}
                        ref={el => { if (el) el.indeterminate = someOn && !allOn; }}
                        className="w-4 h-4 accent-blue-600 cursor-pointer"
                      />
                    </div>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {perms.map(perm => (
                      <label
                        key={perm.id}
                        className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-gray-50 group"
                      >
                        <div>
                          <p className="text-sm font-medium text-gray-800 group-hover:text-blue-700">
                            {perm.name}
                          </p>
                          <p className="text-xs text-gray-400">{perm.description}</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={draft.has(perm.name)}
                          onChange={() => togglePerm(perm.name)}
                          className="w-4 h-4 accent-blue-600 cursor-pointer"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
