import mongoose from 'mongoose';

type HeatCell = number; // 0..100
type Matrix = HeatCell[][]; // [7][24], Monday=0..Sunday=6

const CACHE_TTL_MS = 15 * 60 * 1000;
let cache: { key: string; data: any; ts: number } | null = null;

function dayOfWeekMonday0(date: Date): number {
  // JS: 0=Sun..6=Sat; convert to Mon=0..Sun=6
  const js = date.getDay();
  return (js + 6) % 7;
}

export async function computeWeeklyHeatmap(weights?: { viewerActivity?: number; postPerformance?: number }): Promise<any> {
  const wViewer = typeof weights?.viewerActivity === 'number' ? weights!.viewerActivity : 0.6;
  const wPerf = typeof weights?.postPerformance === 'number' ? weights!.postPerformance : 0.4;

  const key = `weekly:${wViewer}:${wPerf}`;
  if (cache && cache.key === key && Date.now() - cache.ts < CACHE_TTL_MS) {
    return cache.data;
  }

  // Models defined in server.ts
  const AudienceActivityModel = mongoose.models.AudienceActivity || mongoose.model('AudienceActivity');
  const SchedulerQueueModel = mongoose.models.SchedulerQueue || mongoose.model('SchedulerQueue');

  // Viewer activity: average score per hour/day across platforms
  const viewerAgg = await AudienceActivityModel.aggregate([
    { $group: { _id: { d: '$dayOfWeek', h: '$hour' }, avgScore: { $avg: '$score' }, count: { $sum: 1 } } },
    { $project: { dayOfWeek: '$_id.d', hour: '$_id.h', avgScore: 1, count: 1, _id: 0 } }
  ]);

  // Post performance: approximate via average engagement per posted hour (posted/completed)
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days
  const perfAgg = await SchedulerQueueModel.aggregate([
    { $match: { status: { $in: ['posted', 'completed'] }, postedAt: { $gte: since } } },
    { $project: { postedAt: 1, engagement: { $ifNull: ['$engagement', 0] } } },
    { $project: { d: { $subtract: [{ $dayOfWeek: '$postedAt' }, 2] }, h: { $hour: '$postedAt' }, engagement: 1 } }, // Mon=0..Sun=6
    { $group: { _id: { d: { $mod: ['$d', 7] }, h: '$h' }, avgEng: { $avg: '$engagement' }, count: { $sum: 1 } } },
    { $project: { dayOfWeek: '$_id.d', hour: '$_id.h', avgEng: 1, count: 1, _id: 0 } }
  ]);

  // Build matrices and normalize to 0..100
  const mk = () => Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const viewer: number[][] = mk();
  const perf: number[][] = mk();

  let vMax = 0, vMin = Infinity, pMax = 0, pMin = Infinity;
  viewerAgg.forEach((r: any) => { const d = Math.max(0, Math.min(6, r.dayOfWeek)); const h = Math.max(0, Math.min(23, r.hour)); viewer[d][h] = r.avgScore || 0; vMax = Math.max(vMax, viewer[d][h]); vMin = Math.min(vMin, viewer[d][h]); });
  perfAgg.forEach((r: any) => { const d = Math.max(0, Math.min(6, r.dayOfWeek)); const h = Math.max(0, Math.min(23, r.hour)); perf[d][h] = r.avgEng || 0; pMax = Math.max(pMax, perf[d][h]); pMin = Math.min(pMin, perf[d][h]); });

  function norm(val: number, min: number, max: number): number {
    if (!isFinite(val) || max <= min) return 0;
    return Math.round(((val - min) / (max - min)) * 100);
  }

  const matrix: Matrix = mk();
  const viewerMatrix: Matrix = mk();
  const performanceMatrix: Matrix = mk();
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const vN = norm(viewer[d][h], vMin === Infinity ? 0 : vMin, vMax === 0 ? 1 : vMax);
      const pN = norm(perf[d][h], pMin === Infinity ? 0 : pMin, pMax === 0 ? 1 : pMax);
      matrix[d][h] = Math.round(vN * wViewer + pN * wPerf);
      viewerMatrix[d][h] = vN;
      performanceMatrix[d][h] = pN;
    }
  }

  // Top slots
  const flat: Array<{ dayIndex: number; hour: number; score: number }> = [];
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) flat.push({ dayIndex: d, hour: h, score: matrix[d][h] });
  flat.sort((a, b) => b.score - a.score);
  const topSlots = flat.slice(0, 12);

  const result = {
    matrix,
    meta: {
      scale: { min: 0, max: 100 },
      generatedAt: new Date().toISOString(),
      method: 'weighted',
      weights: { viewerActivity: wViewer, postPerformance: wPerf }
    },
    viewerMatrix,
    performanceMatrix,
    topSlots
  };
  cache = { key, data: result, ts: Date.now() };
  return result;
}

export async function computeOptimalTimes(limitPerPlatform: number = 5) {
  const SettingsModel = mongoose.models.SettingsClean || mongoose.model('SettingsClean');
  const SchedulerQueueModel = mongoose.models.SchedulerQueue || mongoose.model('SchedulerQueue');
  const { DailyCounterModel } = require('../models/DailyCounter');
  const settings = await SettingsModel.findOne({});
  const heat = await computeWeeklyHeatmap();
  const platforms: Array<'instagram' | 'youtube'> = (settings?.postToInstagram === false && settings?.postToYouTube) ? ['youtube'] : (settings?.postToYouTube ? ['instagram','youtube'] : ['instagram']);
  const tz = 'America/Chicago';
  const limit = Number(settings?.maxPosts || limitPerPlatform);

  const slots: Array<{ platform: string; iso: string; localLabel: string; score: number }> = [];
  const now = new Date();

  function toNextDate(dayIndex: number, hour: number): Date {
    // Map Monday=0..Sunday=6 to actual next occurrence in CT
    const date = new Date();
    const ct = new Date(date.toLocaleString('en-US', { timeZone: tz }));
    const currentDow = dayOfWeekMonday0(ct);
    let diff = dayIndex - currentDow;
    if (diff < 0) diff += 7;
    const target = new Date(ct);
    target.setDate(ct.getDate() + diff);
    target.setHours(hour, 0, 0, 0);
    return new Date(new Date(target.toLocaleString('en-US', { timeZone: 'UTC' })));
  }

  // Avoid conflicts with already scheduled
  const existing = await SchedulerQueueModel.find({ status: { $in: ['scheduled','processing','pending'] } }).select('platform scheduledTime').lean();

  for (const platform of platforms) {
    const todaysCount = await (async () => {
      const d = new Date(); const dateKey = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
      const c = await DailyCounterModel.findOne({ platform, dateKey }).lean();
      return c?.count || 0;
    })();
    const perDayLimit = Number(settings?.maxPosts || limitPerPlatform);
    let added = 0;
    for (const s of heat.topSlots) {
      if (added >= perDayLimit) break;
      const dt = toNextDate(s.dayIndex, s.hour);
      // Skip past times
      if (+dt <= +now) continue;
      // Skip conflicts
      if (existing.some(e => e.platform === platform && e.scheduledTime && Math.abs(new Date(e.scheduledTime).getTime() - dt.getTime()) < 30 * 60 * 1000)) continue;
      const localLabel = new Date(dt).toLocaleString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
      slots.push({ platform, iso: dt.toISOString(), localLabel: `${localLabel} CT`, score: s.score });
      added++;
      if (slots.filter(x => x.platform === platform).length >= limit) break;
    }
  }

  // Fallback window 17..22 CT if not enough; merge into slots until limits satisfied
  if (slots.length < platforms.length * limit) {
    for (const platform of platforms) {
      const existingForPlatform = slots.filter(s => s.platform === platform).length;
      if (existingForPlatform >= limit) continue;
      for (let h = 17; h <= 22 && slots.filter(s => s.platform === platform).length < limit; h++) {
        const ctNow = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
        const dt = toNextDate(dayOfWeekMonday0(ctNow), h);
        if (+dt <= +now) continue;
        // Skip conflicts
        if (existing.some(e => e.platform === platform && e.scheduledTime && Math.abs(new Date(e.scheduledTime).getTime() - dt.getTime()) < 30 * 60 * 1000)) continue;
        const localLabel = new Date(dt).toLocaleString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
        slots.push({ platform, iso: dt.toISOString(), localLabel: `${localLabel} CT`, score: 50 });
      }
    }
  }

  return {
    platforms,
    limitPerPlatform: limit,
    slots,
    fallbackUsed: true,
    generatedAt: new Date().toISOString()
  };
}

module.exports = { computeWeeklyHeatmap, computeOptimalTimes };


