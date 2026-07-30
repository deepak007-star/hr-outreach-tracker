'use strict';
const request  = require('supertest');
const database = require('../src/db/database');
const { buildApp } = require('./helpers');

let app;

beforeAll(async () => {
  await database.initialize();
  app = buildApp(a => {
    a.get('/api/health', (_, res) =>
      res.json({ status: 'ok', timestamp: new Date().toISOString() }),
    );
  });
});

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.timestamp).toBe('string');
  });
});
