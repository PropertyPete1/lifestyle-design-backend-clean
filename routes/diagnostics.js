const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

function iso(d) { return new Date(d).toISOString(); }
function median(xs) { const a = xs.filter(n=>Number.isFinite(n)).sort((x,y)=>x-y); if (!a.length) return undefined; const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; }
function weeksBetween(a, b) { const days = Math.max(1, (b - a) / 86400000); return days / 7; }

router.get('/report', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const SettingsModel = mongoose.model('SettingsClean');
    const s = await SettingsModel.findOne({}).lean();
    const igToken = s?.instagramToken;
    const igId = s?.igBusinessId;
    if (!igToken || !igId) return res.status(400).json({ error: 'Missing Instagram credentials' });

    const days = Math.max(7, Number(req.query.days || 90));
    const now = new Date();
    const currentStart = new Date(now.getTime() - days*24*60*60*1000);
    const baselineEnd = new Date(now.getTime() - 365*24*60*60*1000);
    const baselineStart = new Date(baselineEnd.getTime() - days*24*60*60*1000);

    async function fetchWindow(a, b) {
      let url = `https://graph.facebook.com/v19.0/${encodeURIComponent(igId)}/media?fields=id,caption,timestamp,like_count,comments_count&limit=50&access_token=${encodeURIComponent(igToken)}`;
      const out = [];
      while (url) {
        const r = await fetch(url);
        if (!r.ok) break;
        const j = await r.json();
        const data = Array.isArray(j?.data) ? j.data : [];
        for (const m of data) {
          const t = new Date(m.timestamp);
          if (t >= a && t <= b) {
            const caption = String(m.caption||'');
            out.push({
              id: m.id,
              caption,
              ts: t,
              likes: Number(m.like_count || 0),
              comments: Number(m.comments_count || 0),
              captionChars: caption.length,
              hashtagCount: (caption.match(/#[\p{L}\d_]+/gu) || []).length,
            });
          }
        }
        url = j?.paging?.next || null;
      }
      return out.sort((a,b)=> b.ts - a.ts);
    }

    const [baseline, current] = await Promise.all([
      fetchWindow(baselineStart, baselineEnd),
      fetchWindow(currentStart, now)
    ]);

    const playsB = baseline.map(p=>p.likes + p.comments);
    const playsC = current.map(p=>p.likes + p.comments);
    const medB = median(playsB);
    const medC = median(playsC);
    const change = (medB && medC!=null) ? Number((((medC-medB)/medB)*100).toFixed(1)) : undefined;

    // Heatmap by local hour (America/Chicago)
    function toCTHour(date) {
      try {
        const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false, weekday: 'short' });
        const parts = fmt.formatToParts(date).reduce((a,p)=>{a[p.type]=p.value; return a;},{});
        const h = Number(parts.hour||'0');
        const dowMap = {Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
        const dow = dowMap[parts.weekday] ?? 0;
        return { dow, hour: h };
      } catch { return { dow: 0, hour: date.getHours() }; }
    }
    const timeBuckets = new Map(); // key: dow-hour -> array of plays
    for (const p of baseline.concat(current)) {
      const v = (p.likes + p.comments);
      const { dow, hour } = toCTHour(p.ts);
      const key = `${dow}-${hour}`;
      const arr = timeBuckets.get(key) || [];
      arr.push(v);
      timeBuckets.set(key, arr);
    }
    const byTimeHeatmap = Array.from(timeBuckets.entries()).map(([k, vals])=>{
      const [dow, hour] = k.split('-').map(Number);
      return { dow, hour, medianPlays: median(vals), count: vals.length };
    }).sort((a,b)=> (a.dow - b.dow) || (a.hour - b.hour));

    const avg = xs => xs.length ? Number((xs.reduce((a,b)=>a+b,0)/xs.length).toFixed(1)) : 0;
    const B = { captionChars: avg(baseline.map(x=>x.captionChars)), hashtagCount: avg(baseline.map(x=>x.hashtagCount)) };
    const C = { captionChars: avg(current.map(x=>x.captionChars)), hashtagCount: avg(current.map(x=>x.hashtagCount)) };
    const topFeatureShifts = [
      { feature: 'Caption length (chars)', baselineValue: Math.round(B.captionChars), currentValue: Math.round(C.captionChars), change: (B.captionChars!==0?`${(((C.captionChars-B.captionChars)/B.captionChars)*100).toFixed(1)}%`:`${B.captionChars} → ${C.captionChars}`) },
      { feature: 'Hashtag count', baselineValue: B.hashtagCount, currentValue: C.hashtagCount, change: (B.hashtagCount!==0?`${(((C.hashtagCount-B.hashtagCount)/B.hashtagCount)*100).toFixed(1)}%`:`${B.hashtagCount} → ${C.hashtagCount}`) },
    ];

    const freqB = Number((baseline.length / Math.max(1, weeksBetween(baselineStart, baselineEnd))).toFixed(2));
    const freqC = Number((current.length / Math.max(1, weeksBetween(currentStart, now))).toFixed(2));

    const report = {
      baselineWindow: { start: iso(baselineStart), end: iso(baselineEnd), rationale: 'Reference window' },
      currentWindow: { start: iso(currentStart), end: iso(now) },
      sampleSizes: { baseline: baseline.length, current: current.length },
      deltas: {
        medianPlays: medC,
        medianPlaysChangePct: change,
        frequencyPerWeekBaseline: freqB,
        frequencyPerWeekCurrent: freqC,
      },
      byTimeHeatmap,
      topFeatureShifts,
      correlations: [],
      rankedRecommendations: [],
      todaySummary: change!=null ? (change>=0?`Views trend up ${change}% vs baseline.`:`Views trend down ${Math.abs(change)}% vs baseline.`) : undefined,
    };

    return res.json(report);
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Diagnostics failed' });
  }
});

module.exports = router;
