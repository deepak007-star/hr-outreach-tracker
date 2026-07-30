'use strict';
const request  = require('supertest');
const { v4: uuidv4 } = require('crypto').randomUUID ? { v4: () => require('crypto').randomUUID() } : require('crypto');
const database = require('../src/db/database');
const { buildApp, generateToken } = require('./helpers');

// crypto.randomUUID() is built-in in Node 14.17+ — use it directly
const randomUUID = () => require('crypto').randomUUID();

let app;
const TEST_EMAIL  = `jest_user_${Date.now()}@test.com`;
let token;
let userId;
let createdContactId;

beforeAll(async () => {
  await database.initialize();

  // Create a test user so auth middleware can look them up
  const bcrypt = require('bcryptjs');
  userId = randomUUID();
  const hash = await bcrypt.hash('TestPass1234!', 10);
  await database.prepare('DELETE FROM users WHERE email = ?').run(TEST_EMAIL);
  await database.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, plan, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, TEST_EMAIL, hash, 'Jest Contact User', 'user', 'demo',
    new Date().toISOString().replace('T', ' ').slice(0, 19));

  token = generateToken({ userId, email: TEST_EMAIL, role: 'user', plan: 'demo' });

  const { setPermCacheDb } = require('../src/middleware/auth');
  setPermCacheDb(database);

  const contactsRouter = require('../src/routes/contacts');
  app = buildApp(a => a.use('/api/contacts', contactsRouter));
});

afterAll(async () => {
  await database.prepare('DELETE FROM contacts WHERE added_by = ?').run(userId);
  await database.prepare('DELETE FROM users WHERE email = ?').run(TEST_EMAIL);
});

describe('POST /api/contacts — create', () => {
  it('creates a contact with required fields', async () => {
    const res = await request(app)
      .post('/api/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name:    'Jest Test HR',
        email:   `hr_${Date.now()}@company.com`,
        company: 'Acme Corp',
        status:  'new',
      });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Jest Test HR');
    createdContactId = res.body.id;
  });

  it('rejects missing email', async () => {
    const res = await request(app)
      .post('/api/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'No Email HR', company: 'Foo', status: 'new' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects unauthenticated request', async () => {
    const res = await request(app)
      .post('/api/contacts')
      .send({ name: 'Ghost', email: 'ghost@test.com', company: 'X', status: 'new' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/contacts — list', () => {
  it('returns contacts array', async () => {
    const res = await request(app)
      .get('/api/contacts')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('rejects unauthenticated request', async () => {
    const res = await request(app).get('/api/contacts');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/contacts/:id — update', () => {
  it('updates a contact field', async () => {
    if (!createdContactId) return;
    const res = await request(app)
      .put(`/api/contacts/${createdContactId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'contacted' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('contacted');
  });
});

describe('DELETE /api/contacts/:id — delete', () => {
  it('deletes the contact', async () => {
    if (!createdContactId) return;
    const res = await request(app)
      .delete(`/api/contacts/${createdContactId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    createdContactId = null;
  });
});
