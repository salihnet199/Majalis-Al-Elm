import axios from 'axios';

// The app mounts everything under the ADR-011 global prefix (see main.ts:
// app.setGlobalPrefix('api/v1')). /health is a public route (bypasses the
// JWT guard) and checks Postgres connectivity, so it's a good smoke check
// that the server booted and the DB is reachable.
describe('GET /api/v1/health', () => {
  it('reports the app is up and the database is reachable', async () => {
    const res = await axios.get(`/api/v1/health`);

    expect(res.status).toBe(200);
    expect(res.data.status).toBe('ok');
  });
});
