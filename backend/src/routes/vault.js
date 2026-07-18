'use strict';

const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { encrypt, decrypt } = require('../services/vaultCrypto');

const router = express.Router();
router.use(requireAuth);

// GET /api/vault — list all entries for the logged-in user (passwords omitted)
router.get('/', async (req, res) => {
  const rows = await db.prepare(
    'SELECT id, title, username, url, category, notes, created_at, updated_at FROM password_vault WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.user.userId);
  res.json(rows);
});

// POST /api/vault — create new entry
router.post('/', async (req, res) => {
  const { title, username, password, url, category, notes } = req.body;
  if (!title?.trim())   return res.status(400).json({ error: 'Title is required' });
  if (!password?.trim()) return res.status(400).json({ error: 'Password is required' });

  const id = crypto.randomUUID();
  const { iv, enc, tag } = encrypt(password);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  await db.prepare(
    `INSERT INTO password_vault (id, user_id, title, username, password_enc, iv, tag, url, category, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, req.user.userId, title.trim(), username || '', enc, iv, tag, url || '', category || 'general', notes || '', now, now);

  res.status(201).json({ id, title: title.trim(), username: username || '', url: url || '', category: category || 'general', notes: notes || '', created_at: now, updated_at: now });
});

// GET /api/vault/:id/reveal — return decrypted password (only for owner)
router.get('/:id/reveal', async (req, res) => {
  const row = await db.prepare('SELECT * FROM password_vault WHERE id = ? AND user_id = ?').get(req.params.id, req.user.userId);
  if (!row) return res.status(404).json({ error: 'Entry not found' });
  try {
    const password = decrypt({ iv: row.iv, enc: row.password_enc, tag: row.tag });
    res.json({ password });
  } catch {
    res.status(500).json({ error: 'Decryption failed' });
  }
});

// PUT /api/vault/:id — update entry (password optional — omit to keep existing)
router.put('/:id', async (req, res) => {
  const row = await db.prepare('SELECT id FROM password_vault WHERE id = ? AND user_id = ?').get(req.params.id, req.user.userId);
  if (!row) return res.status(404).json({ error: 'Entry not found' });

  const { title, username, password, url, category, notes } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  if (password?.trim()) {
    const { iv, enc, tag } = encrypt(password);
    await db.prepare(
      'UPDATE password_vault SET title=?, username=?, password_enc=?, iv=?, tag=?, url=?, category=?, notes=?, updated_at=? WHERE id=?'
    ).run(title.trim(), username || '', enc, iv, tag, url || '', category || 'general', notes || '', now, req.params.id);
  } else {
    await db.prepare(
      'UPDATE password_vault SET title=?, username=?, url=?, category=?, notes=?, updated_at=? WHERE id=?'
    ).run(title.trim(), username || '', url || '', category || 'general', notes || '', now, req.params.id);
  }

  res.json({ ok: true });
});

// DELETE /api/vault/:id
router.delete('/:id', async (req, res) => {
  const row = await db.prepare('SELECT id FROM password_vault WHERE id = ? AND user_id = ?').get(req.params.id, req.user.userId);
  if (!row) return res.status(404).json({ error: 'Entry not found' });
  await db.prepare('DELETE FROM password_vault WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
