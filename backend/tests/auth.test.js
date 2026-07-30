'use strict';
const request  = require('supertest');
const database = require('../src/db/database');
const { buildApp } = require('./helpers');

let app;
const TEST_EMAIL = `jest_auth_${Date.now()}@test.com`;
const TEST_PASS  = 'TestPass1234!';
let authToken;

beforeAll(async () => {
  await database.initialize();
  const authRouter = require('../src/routes/auth');
  app = buildApp(a => a.use('/api/auth', authRouter));
  // Clean up any residual test user from previous run
  await database.prepare('DELETE FROM users WHERE email = ?').run(TEST_EMAIL);
});

afterAll(async () => {
  await database.prepare('DELETE FROM users WHERE email = ?').run(TEST_EMAIL);
});

describe('POST /api/auth/register', () => {
  it('creates a new user and returns token + user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: TEST_EMAIL, password: TEST_PASS, name: 'Jest Auth User' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe(TEST_EMAIL);
    authToken = res.body.token;
  });

  it('rejects duplicate registration', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: TEST_EMAIL, password: TEST_PASS });
    expect(res.status).toBe(409);
  });

  it('rejects missing password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: `other_${Date.now()}@test.com` });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('POST /api/auth/login', () => {
  it('returns token for valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASS });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    authToken = res.body.token;
  });

  it('rejects wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  it('rejects unknown email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@nowhere.com', password: 'whatever' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns user info for valid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(TEST_EMAIL);
  });

  it('rejects missing token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects tampered token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer this.is.fake');
    expect(res.status).toBe(401);
  });
});
