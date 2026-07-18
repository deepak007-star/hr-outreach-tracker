'use strict';

const express = require('express');
const { randomUUID } = require('crypto');
const db = require('../db/database');
const { requireAuth, requireAdmin, invalidatePermCache } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// ── GET /api/rbac/roles ───────────────────────────────────────────────────────
router.get('/roles', async (req, res) => {
  const roles = await db.prepare('SELECT * FROM roles ORDER BY is_system DESC, name ASC').all();
  const perms = await db.prepare(`
    SELECT rp.role_id, p.id, p.name, p.description, p.resource
    FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
  `).all();

  const permMap = {};
  for (const p of perms) {
    if (!permMap[p.role_id]) permMap[p.role_id] = [];
    permMap[p.role_id].push(p.name);
  }

  res.json(roles.map(r => ({ ...r, permissions: permMap[r.id] || [] })));
});

// ── GET /api/rbac/permissions ─────────────────────────────────────────────────
router.get('/permissions', async (req, res) => {
  const perms = await db.prepare('SELECT * FROM permissions ORDER BY resource, name').all();
  // Group by resource
  const grouped = {};
  for (const p of perms) {
    if (!grouped[p.resource]) grouped[p.resource] = [];
    grouped[p.resource].push(p);
  }
  res.json({ permissions: perms, grouped });
});

// ── POST /api/rbac/roles ──────────────────────────────────────────────────────
router.post('/roles', async (req, res) => {
  const { name, description = '', permissions = [] } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Role name is required' });
  const safeName = name.trim().toLowerCase().replace(/\s+/g, '_');

  const existing = await db.prepare('SELECT id FROM roles WHERE name = ?').get(safeName);
  if (existing) return res.status(409).json({ error: 'Role name already exists' });

  const id = 'role_' + randomUUID().replace(/-/g, '').slice(0, 16);
  await db.prepare('INSERT INTO roles (id, name, description, is_system) VALUES (?,?,?,0)')
    .run(id, safeName, description);

  // Assign permissions
  const allPerms = await db.prepare('SELECT id, name FROM permissions').all();
  const permMap = Object.fromEntries(allPerms.map(p => [p.name, p.id]));
  const ins = db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?,?) ON CONFLICT DO NOTHING');
  for (const pName of permissions) {
    if (permMap[pName]) await ins.run(id, permMap[pName]);
  }

  invalidatePermCache(safeName);
  const created = await db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
  res.status(201).json({ ...created, permissions });
});

// ── PUT /api/rbac/roles/:id ───────────────────────────────────────────────────
router.put('/roles/:id', async (req, res) => {
  const { description } = req.body;
  const role = await db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role not found' });

  await db.prepare('UPDATE roles SET description = ? WHERE id = ?')
    .run(description ?? role.description, req.params.id);

  invalidatePermCache(role.name);
  res.json({ ok: true });
});

// ── PUT /api/rbac/roles/:id/permissions ───────────────────────────────────────
router.put('/roles/:id/permissions', async (req, res) => {
  const { permissions } = req.body; // array of permission names
  if (!Array.isArray(permissions)) return res.status(400).json({ error: 'permissions must be an array' });

  const role = await db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role not found' });

  const allPerms = await db.prepare('SELECT id, name FROM permissions').all();
  const permMap = Object.fromEntries(allPerms.map(p => [p.name, p.id]));

  // Full replace
  await db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(req.params.id);
  const ins = db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?,?) ON CONFLICT DO NOTHING');
  for (const pName of permissions) {
    if (permMap[pName]) await ins.run(req.params.id, permMap[pName]);
  }

  invalidatePermCache(role.name);
  res.json({ ok: true, permissions });
});

// ── DELETE /api/rbac/roles/:id ────────────────────────────────────────────────
router.delete('/roles/:id', async (req, res) => {
  const role = await db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  if (role.is_system) return res.status(400).json({ error: 'Cannot delete a system role' });

  // Move users with this role to 'user'
  await db.prepare("UPDATE users SET role = 'user' WHERE role = ?").run(role.name);
  await db.prepare('DELETE FROM roles WHERE id = ?').run(req.params.id);

  invalidatePermCache(role.name);
  res.json({ ok: true });
});

// ── GET /api/rbac/users/:id/permissions ───────────────────────────────────────
router.get('/users/:id/permissions', async (req, res) => {
  const user = await db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const perms = await db.prepare(`
    SELECT p.name FROM permissions p
    JOIN role_permissions rp ON rp.permission_id = p.id
    JOIN roles r ON r.id = rp.role_id
    WHERE r.name = ?
  `).all(user.role);

  res.json({ user, permissions: perms.map(p => p.name) });
});

module.exports = router;
