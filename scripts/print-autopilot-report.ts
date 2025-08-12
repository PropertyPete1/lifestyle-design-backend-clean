#!/usr/bin/env ts-node
import fetch from 'node-fetch';

(async () => {
  try {
    const base = process.env.BASE_URL || 'http://localhost:10000';
    const r = await fetch(`${base}/api/diag/autopilot-report`);
    const j = await r.json();
    console.log(JSON.stringify(j, null, 2));
  } catch (e:any) {
    console.error('Failed to fetch report:', e?.message || e);
    process.exit(1);
  }
})();


