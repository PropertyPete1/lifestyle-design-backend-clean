const fetch = (...a) => import('node-fetch').then(({ default: f }) => f(...a));
const BASE = process.env.BASE || 'https://lifestyle-design-backend-v2-clean.onrender.com';

(async () => {
  try {
    const r1 = await fetch(`${BASE}/health`); console.log('health', r1.status, await r1.text());
    const r2 = await fetch(`${BASE}/api/heatmap/weekly`); console.log('weekly', r2.status, await r2.text());
    const r3 = await fetch(`${BASE}/api/heatmap/optimal-times`); console.log('optimal', r3.status, await r3.text());
    const r4 = await fetch(`${BASE}/api/scheduler/status`); console.log('sched', r4.status, await r4.text());
    const r5 = await fetch(`${BASE}/api/autopilot/queue`); console.log('queue', r5.status, await r5.text());
    const r6 = await fetch(`${BASE}/api/autopilot/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"source":"manual-trigger"}' }); console.log('run', r6.status, await r6.text());
  } catch (e) {
    console.error('smoke error', e);
    process.exit(1);
  }
})();



