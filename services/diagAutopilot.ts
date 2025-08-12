import mongoose from 'mongoose';

export async function collectAutopilotReport() {
  const now = new Date();
  const nowIso = now.toISOString();

  // Models (best-effort without mutating schema)
  let SettingsModel: any;
  let SchedulerQueueModel: any;
  let DailyCounterModel: any;
  let LockModel: any;
  try { SettingsModel = mongoose.model('SettingsClean'); } catch { /* ignore */ }
  try { SchedulerQueueModel = mongoose.model('SchedulerQueue'); } catch { /* ignore */ }
  try { DailyCounterModel = mongoose.model('DailyCounter'); } catch { /* ignore */ }
  try { LockModel = mongoose.model('PostingLocks'); } catch { /* ignore */ }

  // Settings snapshot
  const settingsDoc = SettingsModel ? await SettingsModel.findOne({}).lean().catch(() => null) : null;
  const settings = {
    autopilotEnabled: !!settingsDoc?.autopilotEnabled,
    maxPosts: Number(settingsDoc?.maxPosts ?? 0),
    repostDelay: Number(settingsDoc?.repostDelay ?? 0),
    postTime: settingsDoc?.timeZone || 'America/Chicago',
    dailyLimit: Number(settingsDoc?.maxPosts ?? 0),
  };

  // Queue snapshot
  let total = 0, dueNow = 0, postingNow = 0, last10: any[] = [];
  if (SchedulerQueueModel) {
    total = await SchedulerQueueModel.countDocuments({}).catch(() => 0);
    dueNow = await SchedulerQueueModel.countDocuments({ status: { $in: ['scheduled','pending'] }, scheduledTime: { $lte: now } }).catch(() => 0);
    postingNow = await SchedulerQueueModel.countDocuments({ status: { $in: ['processing'] } }).catch(() => 0);
    const items = await SchedulerQueueModel.find({}).sort({ updatedAt: -1 }).limit(10).lean().catch(() => []);
    last10 = (items || []).map((it: any) => ({
      _id: String(it._id),
      platform: it.platform,
      status: it.status,
      lockedBy: it.lockedBy || null,
      lockedAtIso: it.lockedAt ? new Date(it.lockedAt).toISOString() : null,
      postedAtIso: it.postedAt ? new Date(it.postedAt).toISOString() : null,
      visualHash: it.visualHash || it.thumbnailHash || null,
    }));
  }

  // Posts in last hour (derive from SchedulerQueue posted/completed)
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  let postsLastHour = { count: 0, byPlatform: { instagram: 0, youtube: 0 }, samples: [] as any[] };
  if (SchedulerQueueModel) {
    const samples = await SchedulerQueueModel.find({ status: { $in: ['posted','completed'] }, postedAt: { $gte: oneHourAgo } })
      .sort({ postedAt: -1 }).limit(10).lean().catch(() => []);
    const ig = await SchedulerQueueModel.countDocuments({ platform: 'instagram', status: { $in: ['posted','completed'] }, postedAt: { $gte: oneHourAgo } }).catch(() => 0);
    const yt = await SchedulerQueueModel.countDocuments({ platform: 'youtube', status: { $in: ['posted','completed'] }, postedAt: { $gte: oneHourAgo } }).catch(() => 0);
    postsLastHour = {
      count: (ig + yt),
      byPlatform: { instagram: ig, youtube: yt },
      samples: (samples || []).map((s: any) => ({ _id: String(s._id), platform: s.platform, postedAtIso: s.postedAt ? new Date(s.postedAt).toISOString() : null }))
    };
  }

  // Counters today (fallback to counting from queue if DailyCounter not available)
  let countersToday = { instagram: 0, youtube: 0, total: 0 };
  if (DailyCounterModel) {
    const d = new Date();
    const dateKey = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    try {
      const rows = await DailyCounterModel.find({ dateKey }).lean();
      const ig = rows.find((r: any) => r.platform === 'instagram')?.count || 0;
      const yt = rows.find((r: any) => r.platform === 'youtube')?.count || 0;
      countersToday = { instagram: ig, youtube: yt, total: ig + yt };
    } catch {}
  } else if (SchedulerQueueModel) {
    const start = new Date(now); start.setHours(0,0,0,0);
    const end = new Date(now); end.setHours(23,59,59,999);
    const [ig, yt] = await Promise.all([
      SchedulerQueueModel.countDocuments({ platform: 'instagram', status: { $in: ['posted','completed'] }, postedAt: { $gte: start, $lte: end } }).catch(() => 0),
      SchedulerQueueModel.countDocuments({ platform: 'youtube', status: { $in: ['posted','completed'] }, postedAt: { $gte: start, $lte: end } }).catch(() => 0)
    ]);
    countersToday = { instagram: ig, youtube: yt, total: ig + yt };
  }

  // Locks
  let schedulerLock: any = null; let postOnceLocks = 0; let activeLocks: any[] = [];
  if (LockModel) {
    try {
      const nowPlus = new Date(now.getTime());
      const locks = await LockModel.find({}).limit(50).lean();
      postOnceLocks = locks.length;
      schedulerLock = locks.find((l: any) => String(l.key || '').includes('scheduler')) || null;
      if (schedulerLock) {
        schedulerLock = { holder: schedulerLock.key || null, expiresIso: schedulerLock.expiresAt ? new Date(schedulerLock.expiresAt).toISOString() : null };
      }
    } catch {}
  }
  if (SchedulerQueueModel) {
    try {
      const procs = await SchedulerQueueModel.find({ status: { $in: ['processing'] } }).limit(10).lean();
      activeLocks = (procs || []).map((p: any) => ({ id: String(p._id), platform: p.platform, status: p.status, scheduledTime: p.scheduledTime }));
    } catch {}
  }

  // Scheduler heartbeat (via internal HTTP)
  let scheduler = { running: false, lastTickIso: null as any, tickEverySec: 60, activeLocks };
  try {
    const port = process.env.PORT || '10000';
    const base = `http://127.0.0.1:${port}`;
    const hb = await fetch(`${base}/api/scheduler/heartbeat`).then(r => r.json()).catch(() => null as any);
    if (hb && hb.lastTickAtISO) {
      scheduler.running = true;
      scheduler.lastTickIso = hb.lastTickAtISO;
    }
  } catch {}

  // Render info via /health
  let render: any = {};
  try {
    const port = process.env.PORT || '10000';
    const base = `http://127.0.0.1:${port}`;
    const h = await fetch(`${base}/health`).then(r => r.json()).catch(() => null as any);
    if (h) render = { version: h.version || null, buildTime: h.buildTime || null };
  } catch {}

  // Instance id best-effort
  const instanceId = (Math.random().toString(36).slice(2, 10));

  return {
    nowIso,
    instanceId,
    env: { NODE_ENV: process.env.NODE_ENV, RENDER: process.env.RENDER || process.env.RENDER_SERVICE_ID ? 'true' : 'false' },
    settings,
    scheduler,
    queue: { total, dueNow, postingNow, last10 },
    postsLastHour,
    countersToday,
    locks: { schedulerLock, postOnceLocks },
    render
  };
}

module.exports = { collectAutopilotReport };

