require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 10000;
let fetchFn: any;
try { fetchFn = (global as any).fetch || require('node-fetch'); } catch { fetchFn = require('node-fetch'); }

// Settings Model
const settingsSchema = new mongoose.Schema({
  instagramToken: String,
  igBusinessId: String,
  facebookPage: String,
  youtubeClientId: String,
  youtubeClientSecret: String,
  youtubeAccessToken: String,
  youtubeRefreshToken: String,
  youtubeChannelId: String,
  s3AccessKey: String,
  s3SecretKey: String,
  s3BucketName: String,
  s3Region: String,
  mongoURI: String,
  openaiApiKey: String,
  dropboxToken: String,
  runwayApiKey: String,
  maxPosts: { type: Number, default: 4 },
  autopilotEnabled: { type: Boolean, default: false },
  cartoonMode: { type: Boolean, default: false },
  schedulerType: { type: String, default: 'daily' },
}, { timestamps: true, collection: 'SettingsClean' });

const SettingsModel = mongoose.model('SettingsClean', settingsSchema);

// CORS configuration for frontend-v2
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001', 
    'https://frontend-v2-sage.vercel.app',
    'https://lifestyle-design-social.vercel.app',
    'https://lifestyle-design-frontend-clean.vercel.app',
    'https://lifestyle-design-frontend-v2.vercel.app'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// MongoDB connection
const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/lifestyle-design';
    await mongoose.connect(mongoUri);
    console.log('✅ [DATABASE] MongoDB connected successfully');
  } catch (error) {
    console.error('❌ [DATABASE] MongoDB connection failed:', error);
    process.exit(1);
  }
};

// ============ Index initialization (models) ============
let DailyCounterModel, PostModel, LockModel;
try { DailyCounterModel = require('./models/DailyCounter').DailyCounterModel; } catch(_) {}
try { PostModel = require('./models/Post').PostModel; } catch(_) {}
try { LockModel = require('./models/Lock').LockModel; } catch(_) {}

// SchedulerQueue model (shared) with dedupe-oriented fields and indexes
let SchedulerQueueModel;
try { SchedulerQueueModel = mongoose.model('SchedulerQueue'); } catch (_) {}
if (!SchedulerQueueModel) {
  const schedulerQueueSchema = new mongoose.Schema({
    filename: String,
    caption: String,
    platform: { type: String, enum: ['instagram','youtube'], default: 'instagram', index: true },
    scheduledTime: { type: Date, required: true, index: true },
    status: { type: String, enum: ['pending','scheduled','processing','posted','failed','completed'], default: 'scheduled', index: true },
    source: { type: String, enum: ['autopilot','manual'], default: 'autopilot' },
    videoUrl: String,
    thumbnailUrl: String,
    s3Url: String,
    // Dedupe signals
    visualHash: { type: String, index: true },
    audioKey: { type: String },
    captionNorm: { type: String },
    durationSec: { type: Number },
    engagement: Number,
    // Legacy fields (kept non-indexed; do not use for dedupe)
    originalVideoId: String,
    postedAt: { type: Date },
    hashtags: [String],
    retryCount: { type: Number, default: 0 },
    errorMessage: String,
    autofill: { type: Boolean, default: false }
  }, { timestamps: true, collection: 'SchedulerQueue' });

  // Replace any uniqueness relying on originalVideoId with visualHash+scheduledTime
  try {
    schedulerQueueSchema.index({ platform: 1, visualHash: 1, scheduledTime: 1 }, { unique: true, partialFilterExpression: { visualHash: { $exists: true, $type: 'string' } } });
  } catch {}

  SchedulerQueueModel = mongoose.model('SchedulerQueue', schedulerQueueSchema);
}

// Audience Activity model (needed for heatmap/optimal-times)
let AudienceActivityModel;
try { AudienceActivityModel = mongoose.model('AudienceActivity'); } catch (_) {}
if (!AudienceActivityModel) {
  const audienceActivitySchema = new mongoose.Schema({
    platform: { type: String, enum: ['instagram', 'youtube'], required: true },
    hour: { type: Number, min: 0, max: 23, required: true },
    dayOfWeek: { type: Number, min: 0, max: 6, required: true },
    score: { type: Number, min: 0, max: 1, required: true },
    raw: { type: mongoose.Schema.Types.Mixed }
  }, { timestamps: true, collection: 'AudienceActivity' });
  AudienceActivityModel = mongoose.model('AudienceActivity', audienceActivitySchema);
}

async function ensureIndexes() {
  try {
    if (PostModel) {
      await PostModel.syncIndexes();
      console.log('✅ [INDEX] Posts indexes synced');
    }
    if (LockModel) {
      await LockModel.syncIndexes();
      console.log('✅ [INDEX] PostingLocks indexes synced');
    }
    if (DailyCounterModel) {
      await DailyCounterModel.syncIndexes();
      console.log('✅ [INDEX] DailyCounters indexes synced');
    }
    if (SchedulerQueueModel) {
      await SchedulerQueueModel.syncIndexes();
      console.log('✅ [INDEX] SchedulerQueue indexes synced');
    }
  } catch (e) {
    console.warn('⚠️ [INDEX] Sync failed:', e?.message || e);
  }
}

// ============ Core Routes ============
// In-memory heartbeat
const instanceId = Math.random().toString(36).slice(2, 10);
const schedulerHeartbeat: { instanceId: string; lastTickAtISO: string | null; ticksLastHour: number; serverTz: string } = {
  instanceId,
  lastTickAtISO: null,
  ticksLastHour: 0,
  serverTz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
};

function formatCT(date = new Date()): { nowCT: string; dateKeyCT: string } {
  const nowCT = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(date);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
    .reduce((acc: any, p: any) => (acc[p.type] = p.value, acc), {} as any);
  const dateKeyCT = `${parts.year}-${parts.month}-${parts.day}`;
  return { nowCT, dateKeyCT };
}
// Settings endpoints
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await SettingsModel.findOne();
    return res.json(settings || {});
  } catch (e) {
    return res.status(500).json({ error: 'Failed to get settings' });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const settings = await SettingsModel.findOneAndUpdate({}, req.body, { new: true, upsert: true });
    return res.json(settings);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to update settings' });
  }
});

// AutoPilot routes - Direct implementation
app.get('/api/autopilot/status', async (req, res) => {
  try {
    const settings = await SettingsModel.findOne();
    res.json({
      autopilotEnabled: settings?.autopilotEnabled || false,
      lastRun: settings?.lastAutopilotRun || null,
      status: settings?.autopilotEnabled ? 'active' : 'inactive',
      queueCount: 0,
      message: 'AutoPilot system operational'
    });
  } catch (error) {
    console.error('❌ [AUTOPILOT STATUS ERROR]', error);
    res.status(500).json({ error: 'Failed to get AutoPilot status' });
  }
});

app.get('/api/autopilot/queue', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const items = await SchedulerQueueModel.find({ status: { $in: ['scheduled','pending','processing'] } })
      .sort({ scheduledTime: 1 })
      .limit(100)
      .lean();
    const queue = items.map((it:any) => ({
      id: it._id,
      platform: it.platform,
      caption: it.caption || '',
      scheduledTime: it.scheduledTime,
      status: it.status,
      videoUrl: it.videoUrl || it.s3Url,
      thumbnailUrl: it.thumbnailUrl || it.s3Url,
      engagement: it.engagement || 0,
      visualHash: it.visualHash || null
    }));
    return res.json({ queue, totalCount: queue.length });
  } catch (error) {
    console.error('❌ [AUTOPILOT QUEUE ERROR]', error);
    res.status(500).json({ error: 'Failed to get AutoPilot queue' });
  }
});

app.post('/api/autopilot/run', async (req, res) => {
  try {
    console.log('🚀 [AUTOPILOT] Starting AutoPilot run...');
    const settings = await SettingsModel.findOne();
    if (!settings) return res.status(400).json({ success:false, error: 'No settings found. Please configure your credentials first.' });
    if (!settings.autopilotEnabled) return res.status(400).json({ success:false, error: 'AutoPilot is disabled. Enable it in settings first.' });
    const path = require('path');
    let runAutopilotOnce;
    try {
      // When running from dist/server.js, services folder is one level up
      ({ runAutopilotOnce } = require(path.resolve(__dirname, '..', 'services', 'autopilot')));
    } catch (_) {
      ({ runAutopilotOnce } = require('./services/autopilot'));
    }
    const result = await runAutopilotOnce();
    settings.lastAutopilotRun = new Date(); await settings.save();
    return res.json({ success: true, scheduled: result.scheduled ?? result.processed ?? 0, skipped: result.skipped ?? 0, reasons: result.reasons || [] });
  } catch (error:any) {
    console.error('❌ [AUTOPILOT RUN ERROR]', error);
    res.status(500).json({ success:false, error: error?.message || 'AutoPilot run failed' });
  }
});

// Clear autopilot queue (testing/ops)
app.delete('/api/autopilot/queue', async (req, res) => {
  try {
    const result = await SchedulerQueueModel.deleteMany({});
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (e:any) {
    res.status(500).json({ success: false, error: e?.message || 'Failed to clear queue' });
  }
});

// ============ Post Now (canonical + aliases) ============
const { enqueue, getJobStatus } = (() => { try { return require('./services/jobQueue'); } catch { return { enqueue: null, getJobStatus: null }; } })();

async function handlePostNow(req, res) {
  try {
    const settings = await SettingsModel.findOne({});
    if (!settings || !settings.instagramToken || !settings.igBusinessId) {
      return res.status(400).json({ success: false, error: 'Missing Instagram credentials in settings' });
    }
    // Execute inline to return counts
    const { executePostNow } = require('./services/postNow');
    const r = await executePostNow(settings);
    const posted = r?.success ? 1 : 0;
    const skipped = r?.success ? 0 : 1;
    return res.status(200).json({ success: true, posted, skipped, reasons: r?.duplicateProtection ? [] : [] });
  } catch (e) {
    return res.status(500).json({ success: false, error: e?.message || 'post-now failed' });
  }
}

// Canonical post-now: also supports queueItemIds to force-execute specific items via exactly-once
app.post('/api/post-now', async (req, res) => {
  const ids: string[] = Array.isArray(req.body?.queueItemIds) ? req.body.queueItemIds : [];
  if (!ids.length) return handlePostNow(req, res);
  try {
    const settings = await SettingsModel.findOne({});
    if (!settings) return res.status(400).json({ success: false, error: 'missing settings' });
    const items = await SchedulerQueueModel.find({ _id: { $in: ids } }).lean();
    const { executeQueueItemOnce } = require('./services/scheduler');
    const results = [] as any[];
    for (const item of items) {
      try {
        const r = await executeQueueItemOnce(item, settings);
        results.push({ id: String(item._id), success: !!r.success, deduped: !!r.deduped, note: r.note || null, externalPostId: r.externalPostId || null });
      } catch (e:any) {
        results.push({ id: String(item._id), success: false, note: e?.message || 'error' });
      }
    }
    const posted = results.filter(r => r.success).length;
    const skipped = results.length - posted;
    return res.json({ success: posted > 0, posted, skipped, results });
  } catch (e:any) {
    return res.status(500).json({ success: false, error: e?.message || 'post-now failed' });
  }
});
app.post('/api/autopilot/manual-post', handlePostNow);
app.post('/phase9/post-now', handlePostNow);
app.post('/api/manual/post-now/:videoId', handlePostNow);

// Optional: job status
app.get('/api/post-now/status/:jobId', (req, res) => {
  try {
    if (!getJobStatus) return res.status(404).json({ error: 'job status unavailable' });
    const st = getJobStatus(req.params.jobId);
    return st ? res.json(st) : res.status(404).json({ error: 'not found' });
  } catch (e) {
    return res.status(500).json({ error: 'failed' });
  }
});

// ============ Scheduler status used by UI ============
app.get('/api/scheduler/status', async (req, res) => {
  try {
    const now = new Date();
    const start = new Date(now); start.setHours(0,0,0,0);
    const end = new Date(now); end.setHours(23,59,59,999);
    const queueSize = await SchedulerQueueModel.countDocuments({ status: { $in: ['scheduled','processing','pending'] } });
    let igToday = 0, ytToday = 0;
    try {
      if (DailyCounterModel) {
        const dateKey = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
        const counters = await DailyCounterModel.find({ dateKey }).lean();
        igToday = counters.find(c=>c.platform==='instagram')?.count || 0;
        ytToday = counters.find(c=>c.platform==='youtube')?.count || 0;
      }
    } catch {}
    const settingsDoc = await SettingsModel.findOne({});
    const limit = Number(settingsDoc?.maxPosts || 5);
    const nextRun = new Date(Date.now()+60*1000).toISOString();
    return res.json({
      queueSize,
      today: { instagram: igToday, youtube: ytToday },
      nextRun,
      instagram: { used: igToday, limit },
      youtube: { used: ytToday, limit }
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to get scheduler status' });
  }
});

// ============ Settings test endpoints ============
app.post('/api/test/mongodb', async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    return res.json({ ok: true, message: 'MongoDB OK' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'MongoDB error' });
  }
});

app.post('/api/test/upload', async (req, res) => {
  try {
    const { uploadBufferToS3 } = require('./utils/s3Uploader');
    const buf = Buffer.from('hello-world');
    const key = `tests/${Date.now()}_ping.txt`;
    const url = await uploadBufferToS3(buf, key, 'text/plain');
    return res.json({ ok: true, url });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'S3 upload failed' });
  }
});

app.post('/api/test/validate-apis', async (req, res) => {
  try {
    const s = await SettingsModel.findOne();
    const status = {
      instagram: !!(s?.instagramToken && s?.igBusinessId),
      youtube: !!(s?.youtubeAccessToken || (s?.youtubeClientId && s?.youtubeClientSecret && s?.youtubeRefreshToken)),
      s3: !!(s?.s3AccessKey && s?.s3SecretKey && s?.s3BucketName),
      openai: !!(s?.openaiApiKey)
    };
    return res.json({ ok: true, status });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'Validation failed' });
  }
});

console.log('✅ AutoPilot and core routes registered');

// ---- Minimal analytics for dashboard (inline, safe) ----
function formatCTKey(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' })
    .formatToParts(d)
    .reduce((acc: any, p: any) => (acc[p.type] = p.value, acc), {} as any);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

app.get('/api/analytics', async (_req, res) => {
  try {
    const settings: any = await SettingsModel.findOne();

    // Build 14-day label scaffold for compatibility
    const days = 14;
    const labels: string[] = [];
    const igSeries: number[] = [];
    const ytSeries: number[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      labels.push(formatCTKey(d));
      igSeries.push(0);
      ytSeries.push(0);
    }

    // Resolve analytics services both in ts-node and dist contexts
    const path = require('path');
    let getInstagramAnalytics: any; let getYouTubeAnalytics: any;
    try {
      ({ getInstagramAnalytics } = require(path.resolve(__dirname, '..', 'services', 'instagramAnalytics')));
    } catch (_) {
      ({ getInstagramAnalytics } = require('./services/instagramAnalytics'));
    }
    try {
      ({ getYouTubeAnalytics } = require(path.resolve(__dirname, '..', 'services', 'youtubeAnalytics')));
    } catch (_) {
      ({ getYouTubeAnalytics } = require('./services/youtubeAnalytics'));
    }

    const [ig, yt] = await Promise.all([
      getInstagramAnalytics?.(SettingsModel).catch(() => ({})),
      getYouTubeAnalytics?.(SettingsModel).catch(() => ({}))
    ]);

    // Normalize fields expected by the frontend
    const instagram = {
      connected: !!(settings?.instagramToken && settings?.igBusinessId),
      followers: ig?.followers ?? null,
      reach: ig?.reach ?? null,
      engagementRate: typeof ig?.engagement === 'number' ? (ig.engagement / 100) : (ig?.engagementRate ?? null),
      lastSync: ig?.lastUpdated ?? null,
      autopilotEnabled: !!settings?.autopilotEnabled
    };

    const youtube = {
      connected: !!(settings?.youtubeAccessToken || (settings?.youtubeClientId && settings?.youtubeClientSecret && settings?.youtubeRefreshToken)),
      subscribers: yt?.subscribers ?? null,
      views: yt?.views ?? null,
      watchTimeHours: yt?.watchTimeHours ?? yt?.watchTime ?? null,
      lastSync: yt?.lastUpdated ?? null,
      autopilotEnabled: !!settings?.autopilotEnabled
    };

    return res.json({ instagram, youtube, timeseries: { labels, instagram: igSeries, youtube: ytSeries, combined: igSeries.map((v,i)=>v+(ytSeries[i]||0)) } });
  } catch (err: any) {
    console.error('Analytics error', err);
    return res.json({
      instagram: { connected: false, followers: null, engagementRate: null, lastSync: null },
      youtube:   { connected: false, subscribers: null, views: null, watchTimeHours: null, lastSync: null },
      timeseries: { labels: [], instagram: [], youtube: [], combined: [] }
    });
  }
});

// ============ Heatmap endpoints ============
app.get('/api/heatmap/weekly', async (req, res) => {
  try {
    const { computeWeeklyHeatmap } = require('./services/heatmap');
    const data = await computeWeeklyHeatmap();
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to compute weekly heatmap' });
  }
});

app.get('/api/heatmap/optimal-times', async (req, res) => {
  try {
    const { computeOptimalTimes } = require('./services/heatmap');
    const limit = Number(req.query.limit || 5);
    const data = await computeOptimalTimes(limit);
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to compute optimal times' });
  }
});

// Heartbeat + time debug
app.get('/api/scheduler/heartbeat', (_req, res) => {
  res.json(schedulerHeartbeat);
});

app.get('/api/time/debug', (_req, res) => {
  const nowUTC = new Date().toISOString();
  const { nowCT, dateKeyCT } = formatCT(new Date());
  res.json({ serverTz: schedulerHeartbeat.serverTz, nowUTC, nowCT, dateKeyCT });
});

// Diagnostics: last-30 per platform (read-only)
app.get('/api/diagnostics/instagram/last-30', async (_req, res) => {
  try {
    const s = await SettingsModel.findOne({}).lean();
    const { scrapeInstagramEngagement, generateThumbnailHash } = require('./utils/instagramScraper');
    const list = await scrapeInstagramEngagement(s.igBusinessId, s.instagramToken, 30);
    const out:any[] = [];
    for (const v of list) {
      let vh = null;
      try { vh = await generateThumbnailHash(v.thumbnailUrl || v.url || ''); } catch {}
      out.push({ postedAt: v.timestamp ? new Date(v.timestamp) : null, visualHash: vh, captionNorm: (v.caption||'').toLowerCase(), audioKey: v.audioId || v.music_metadata?.music_product_id || null, durationSec: typeof v.duration==='number'?Math.round(v.duration):null });
    }
    res.json(out);
  } catch (e:any) {
    res.status(500).json({ error: e?.message || 'failed' });
  }
});

app.get('/api/diagnostics/youtube/last-30', async (_req, res) => {
  try {
    // Placeholder: without YouTube analytics scope to list recent uploads tied to channel, return []
    res.json([]);
  } catch (e:any) {
    res.status(500).json({ error: e?.message || 'failed' });
  }
});

// Why-no-posts diagnostics
try {
  const { runAutopilotDiagnostics } = require('./services/diagnostics');
  app.get('/api/diag/why-no-posts-today', async (_req, res) => {
    try {
      const out = await runAutopilotDiagnostics();
      res.json(out);
    } catch (e:any) {
      res.status(500).json({ error: 'Diagnostic failed', details: e?.message || 'error' });
    }
  });
} catch { }

// Dev-only similarity check
app.post('/api/debug/similarity-check', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_DEBUG_SIMILARITY) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const { platform, videoUrl, caption, audioKey, durationSec } = req.body || {};
    const { normalizeCaption } = require('./services/candidateBuilder');
    const { computeWeeklyHeatmap } = require('./services/heatmap'); // not used, but keeps warm
    const normCaption = normalizeCaption(caption || '');
    const { computeAverageHashFromImageUrl, hammingDistance } = require('./utils/visualHash');
    let visualHash = null;
    try { visualHash = await computeAverageHashFromImageUrl(videoUrl); } catch {}
    const candidate = { visualHash, captionNorm: normCaption, audioKey: audioKey || null, durationSec: typeof durationSec === 'number' ? durationSec : null };

    // Build last-30 set (reuse candidateBuilder helpers)
    const Settings = mongoose.model('SettingsClean');
    const settings = await Settings.findOne({});
    const last = platform === 'instagram'
      ? await (async () => { const { scrapeInstagramEngagement, generateThumbnailHash } = require('./utils/instagramScraper'); const list = await scrapeInstagramEngagement(settings.igBusinessId, settings.instagramToken, 30); const out:any[]=[]; for (const v of list){ let vh=null; try{ vh = await generateThumbnailHash(v.thumbnailUrl||v.url);}catch{} out.push({ postedAt: v.timestamp?new Date(v.timestamp):null, visualHash: vh, captionNorm: normalizeCaption(v.caption||''), audioKey: v.audioId || v.music_metadata?.music_product_id || null, durationSec: typeof v.duration==='number'?Math.round(v.duration):null, url: v.url }); } return out; })()
      : [];

    const CAPTION_MIN = 0.85;
    const distances = (last || []).slice(0, 5).map((p:any) => ({
      postedAt: p.postedAt,
      visualHash: p.visualHash,
      captionNorm: p.captionNorm,
      audioKey: p.audioKey,
      durationSec: p.durationSec,
      distances: {
        visualHamming: (visualHash && p.visualHash) ? hammingDistance(visualHash, p.visualHash) : null,
        captionSim: require('string-similarity').compareTwoStrings(normCaption, p.captionNorm || ''),
        durationDelta: (typeof durationSec==='number' && typeof p.durationSec==='number') ? Math.abs(durationSec - p.durationSec) : null
      }
    }));

    const visualMatch = distances.some((d:any) => typeof d.distances.visualHamming === 'number' && d.distances.visualHamming <= Number(process.env.VISUAL_HASH_MAX_DISTANCE || 6));
    const audioCaptionDur = distances.some((d:any) => (candidate.audioKey && d.audioKey && candidate.audioKey===d.audioKey) || (d.distances.captionSim >= CAPTION_MIN && (d.distances.durationDelta ?? 99) <= 1));
    const duplicate = !!visualMatch || !!audioCaptionDur;
    const reason = visualMatch ? 'VISUAL_MATCH' : (audioCaptionDur ? 'AUDIO_CAPTION_DURATION_MATCH' : null);
    return res.json({ candidate, recentSample: distances, decision: { duplicate, reason } });
  } catch (e:any) {
    return res.status(500).json({ error: e?.message || 'similarity-check failed' });
  }
});

// ============ Minimal Manual endpoints (functional placeholders using candidate builder later) ============
app.get('/api/manual/videos', async (req, res) => {
  try {
    // Provide minimal empty list to satisfy UI; real implementation can read from S3 or DB
    return res.json({ success: true, videos: [] });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Failed to load videos' });
  }
});

app.post('/api/manual/refresh-caption/:videoId', async (req, res) => {
  try {
    const { generateSmartCaptionWithKey } = require('./services/captionAI');
    const s = await SettingsModel.findOne();
    const out = await generateSmartCaptionWithKey('', s?.openaiApiKey || '');
    return res.json({ success: true, captions: { clickbait: out, informational: out, emotional: out } });
  } catch {
    return res.status(500).json({ success: false, error: 'Failed to refresh caption' });
  }
});

app.post('/api/manual/refresh-audio/:videoId', async (req, res) => {
  try {
    return res.json({ success: true, currentAudio: 'Trending Beat #247' });
  } catch {
    return res.status(500).json({ success: false, error: 'Failed to refresh audio' });
  }
});

app.post('/api/manual/schedule/:videoId', async (req, res) => {
  try {
    // Accept schedule request; in future integrate with SchedulerQueueModel
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ success: false, error: 'Failed to schedule' });
  }
});

// Activity feed endpoints (for dashboard)
app.get('/api/activity/feed', async (req, res) => {
  try {
    // Minimal empty dataset shape compatible with frontend expectations
    const data = [] as any[];
    res.json({ data });
  } catch (error) {
    console.error('❌ [ACTIVITY FEED ERROR]', error);
    res.status(500).json({ error: 'Failed to fetch activity feed' });
  }
});

app.get('/api/events/recent', async (req, res) => {
  try {
    // Mock recent events for dashboard
    res.json([
      { id: 1, type: 'autopilot_run', status: 'success', timestamp: new Date() },
      { id: 2, type: 'post_scheduled', platform: 'instagram', timestamp: new Date() }
    ]);
  } catch (error) {
    console.error('❌ [RECENT EVENTS ERROR]', error);
    res.status(500).json({ error: 'Failed to fetch recent events' });
  }
});

// Lightweight chart/status endpoint for dashboard waves/controls
app.get('/api/chart/status', async (_req, res) => {
  try {
    const settings: any = await SettingsModel.findOne();
    // Count today's posted items by platform for basic activity
    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
    const endOfDay = new Date(); endOfDay.setHours(23,59,59,999);
    const [igToday, ytToday, lastPosted] = await Promise.all([
      SchedulerQueueModel.countDocuments({ platform: 'instagram', status: { $in: ['posted','completed'] }, postedAt: { $gte: startOfDay, $lte: endOfDay } }),
      SchedulerQueueModel.countDocuments({ platform: 'youtube', status: { $in: ['posted','completed'] }, postedAt: { $gte: startOfDay, $lte: endOfDay } }),
      SchedulerQueueModel.findOne({ status: { $in: ['posted','completed'] } }).sort({ postedAt: -1 }).select('postedAt')
    ]);

    // Simple engagement proxy from AudienceActivity if available
    let engagementScore = 0.5;
    try {
      const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const recent = await AudienceActivityModel.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: null, avg: { $avg: '$score' } } }
      ]);
      engagementScore = Number(((recent?.[0]?.avg) || 0.5).toFixed(3));
    } catch {}

    return res.json({
      engagementScore,
      newHighScore: false,
      lastPostTime: lastPosted?.postedAt || null,
      autopilotRunning: !!settings?.autopilotEnabled,
      settings: { dailyPostLimit: Number(settings?.maxPosts || 3) },
      platformData: {
        instagram: { active: !!settings?.autopilotEnabled, todayPosts: igToday, reach: 0 },
        youtube: { active: !!settings?.autopilotEnabled, todayPosts: ytToday, reach: 0 }
      }
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to get chart status' });
  }
});

// Audience Heatmap (weekly)
app.get('/api/audience-heatmap', async (req, res) => {
  try {
    const platform = (req.query.platform || 'instagram').toString();
    const daysBack = Number(req.query.days || 30);
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    const rows = await AudienceActivityModel.aggregate([
      { $match: { platform, createdAt: { $gte: since } } },
      { $group: { _id: { d: '$dayOfWeek', h: '$hour' }, avgScore: { $avg: '$score' }, count: { $sum: 1 } } },
      { $project: { dayOfWeek: '$_id.d', hour: '$_id.h', avgScore: 1, count: 1, _id: 0 } },
    ]);

    const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ score: 0, reach: 0, level: 'minimal', count: 0 })));
    const classify = (reach: number) => {
      if (reach >= 851) return 'extreme';
      if (reach >= 601) return 'very-high';
      if (reach >= 401) return 'high';
      if (reach >= 251) return 'medium';
      if (reach >= 101) return 'low';
      return 'minimal';
    };
    rows.forEach((r: any) => {
      const d = Math.max(0, Math.min(6, r.dayOfWeek));
      const h = Math.max(0, Math.min(23, r.hour));
      const reach = Math.round((r.avgScore || 0) * 1000);
      grid[d][h] = { score: Number((r.avgScore || 0).toFixed(3)), reach, level: classify(reach), count: r.count };
    });

    res.json({ platform, daysBack, grid });
  } catch (err) {
    res.status(500).json({ error: 'Failed to build audience heatmap' });
  }
});

// Optimal Post Times (top 3)
app.get('/api/optimal-times', async (req, res) => {
  try {
    const platform = (req.query.platform || 'instagram').toString();
    const daysBack = Number(req.query.days || 7);
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const agg = await AudienceActivityModel.aggregate([
      { $match: { platform, createdAt: { $gte: since } } },
      { $group: { _id: { d: '$dayOfWeek', h: '$hour' }, avgScore: { $avg: '$score' }, count: { $sum: 1 } } },
      { $project: { dayOfWeek: '$_id.d', hour: '$_id.h', avgScore: 1, count: 1, _id: 0 } },
    ]);
    const weekdayBonus = (d: number) => (d >= 1 && d <= 5 ? 1.05 : 1);
    const scored = agg.map((r: any) => ({ dayOfWeek: r.dayOfWeek, hour: r.hour, score: (r.avgScore || 0) * weekdayBonus(r.dayOfWeek) }));
    scored.sort((a, b) => b.score - a.score);
    const top3 = scored.slice(0, 3).map((s) => {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const hh = String(s.hour).padStart(2, '0');
      return `${dayNames[s.dayOfWeek]} ${hh}:00`;
    });
    res.json({ platform, top3 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute optimal times' });
  }
});

// Audience AI/Template Summary
app.get('/api/audience-summary', async (req, res) => {
  try {
    const platform = (req.query.platform || 'instagram').toString();
    const daysBack = Number(req.query.days || 14);
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const activity = await AudienceActivityModel.aggregate([
      { $match: { platform, createdAt: { $gte: since } } },
      { $group: { _id: { d: '$dayOfWeek', h: '$hour' }, avg: { $avg: '$score' } } },
      { $project: { dayOfWeek: '$_id.d', hour: '$_id.h', avg: 1, _id: 0 } },
      { $sort: { avg: -1 } },
    ]);
    const top = activity.slice(0, 3);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const best = top.map((t: any) => `${dayNames[t.dayOfWeek]} ${String(t.hour).padStart(2, '0')}:00`);
    res.json({ platform, summary: `Peak audience windows: ${best.join(', ')}`, topTimes: best, matched: 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate audience summary' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'backend-v2',
    version: '2.0.1',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'backend-v2',
    version: '2.0.1',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    autopilotRoutes: 'enabled'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    service: 'backend-v2',
    path: req.originalUrl
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ [SERVER ERROR]', err);
  res.status(500).json({
    error: 'Internal server error',
    service: 'backend-v2',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Start server
const startServer = async () => {
  await connectDB();
  // Start cron and wire heartbeat
  try {
    // Resolve correctly when running from dist/server.js
    const path = require('path');
    let startCronScheduler: any;
    try {
      ({ startCronScheduler } = require(path.resolve(__dirname, '..', 'services', 'cronScheduler')));
    } catch (_) {
      ({ startCronScheduler } = require('./services/cronScheduler'));
    }
    setInterval(() => { schedulerHeartbeat.ticksLastHour = 0; }, 60 * 60 * 1000);
    startCronScheduler(SchedulerQueueModel, SettingsModel, () => {
      schedulerHeartbeat.lastTickAtISO = new Date().toISOString();
      schedulerHeartbeat.ticksLastHour += 1;
    });
    // Fallback tick: ensure a heartbeat and due-post check every 60s even if cron missed
    try {
      const path = require('path');
      let checkAndExecuteDuePosts: any;
      try {
        ({ checkAndExecuteDuePosts } = require(path.resolve(__dirname, '..', 'services', 'cronScheduler')));
      } catch (_) {
        ({ checkAndExecuteDuePosts } = require('./services/cronScheduler'));
      }
      setInterval(() => {
        schedulerHeartbeat.lastTickAtISO = new Date().toISOString();
        schedulerHeartbeat.ticksLastHour += 1;
        checkAndExecuteDuePosts(SchedulerQueueModel, SettingsModel);
      }, 60 * 1000);
    } catch (_) {}
  } catch (e:any) {
    console.warn('⚠️ Cron start failed:', e?.message || e);
  }

// Manual tick endpoint for Render Cron Jobs
app.get('/api/scheduler/tick', async (_req, res) => {
  try {
    const path = require('path');
    let checkAndExecuteDuePosts: any;
    try {
      ({ checkAndExecuteDuePosts } = require(path.resolve(__dirname, '..', 'services', 'cronScheduler')));
    } catch (_) {
      ({ checkAndExecuteDuePosts } = require('./services/cronScheduler'));
    }
    schedulerHeartbeat.lastTickAtISO = new Date().toISOString();
    schedulerHeartbeat.ticksLastHour += 1;
    await checkAndExecuteDuePosts(SchedulerQueueModel, SettingsModel);
    res.json({ ok: true, tickedAt: schedulerHeartbeat.lastTickAtISO });
  } catch (e:any) {
    res.status(500).json({ ok: false, error: e?.message || 'tick failed' });
  }
});
  
  app.listen(PORT, () => {
    console.log('🚀 [SERVER] Backend v2 running on port', PORT);
    console.log('📋 [SERVER] Available endpoints:');
    console.log('   GET  /health - Health check');
    console.log('   GET  /api/settings - Load settings (DIRECT)');
    console.log('   POST /api/settings - Save settings (DIRECT)');
  });
};

startServer().catch(console.error);