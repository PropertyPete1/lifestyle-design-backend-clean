require('dotenv').config();
// Enable loading TypeScript service files (idempotency/locks)
try { require('ts-node/register/transpile-only'); } catch (e) { console.warn('⚠️ ts-node/register not available:', e?.message || e); }
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://frontend-v2-sage.vercel.app',
    'https://lifestyle-design-social.vercel.app',
    'https://lifestyle-design-frontend-clean.vercel.app',
    'https://lifestyle-design-frontend-v2.vercel.app'
  ],
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// MongoDB connection
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb+srv://peterallen:RDSTonopah1992@cluster0.7vqin.mongodb.net/lifestyle-design-social?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB connected'))
.catch(err => console.error('❌ MongoDB connection error:', err));

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
  timeZone: { type: String, default: 'America/Chicago' },
  repostDelay: { type: Number, default: 2 },
  postToYouTube: { type: Boolean, default: false },
  postToInstagram: { type: Boolean, default: true },
}, { timestamps: true, collection: 'SettingsClean' });

const SettingsModel = mongoose.model('SettingsClean', settingsSchema);

// Scheduler Queue schema for autopilot posts
const schedulerQueueSchema = new mongoose.Schema({
  filename: String,
  caption: String,
  platform: {
    type: String,
    enum: ['instagram', 'youtube'],
    default: 'instagram'
  },
  scheduledTime: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'scheduled', 'processing', 'posted', 'failed', 'completed'],
    default: 'scheduled'
  },
  source: {
    type: String,
    enum: ['autopilot', 'manual'],
    default: 'autopilot'
  },
  videoUrl: String,
  thumbnailUrl: String,
  thumbnailPath: String,
  s3Url: String,
  thumbnailHash: String,
  engagement: Number,
  originalVideoId: String,
  postedAt: { type: Date },
  hashtags: [String],
  retryCount: { type: Number, default: 0 },
  errorMessage: String
  ,
  autofill: { type: Boolean, default: false }
}, { timestamps: true, collection: 'SchedulerQueue' });

const SchedulerQueueModel = mongoose.model('SchedulerQueue', schedulerQueueSchema);

// Audience Activity schema for hourly engagement logging
const audienceActivitySchema = new mongoose.Schema({
  platform: { type: String, enum: ['instagram', 'youtube'], required: true },
  hour: { type: Number, min: 0, max: 23, required: true },
  dayOfWeek: { type: Number, min: 0, max: 6, required: true },
  score: { type: Number, min: 0, max: 1, required: true },
  raw: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true, collection: 'AudienceActivity' });

const AudienceActivityModel = mongoose.model('AudienceActivity', audienceActivitySchema);

// API Routes

// In-memory scheduler heartbeat (for quick smoke tests)
const instanceId = Math.random().toString(36).slice(2, 10);
const schedulerHeartbeat = {
  instanceId,
  lastTickAtISO: null,
  ticksLastHour: 0,
  serverTz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
};

// Time debug utility
function formatCTDateKey(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = fmt.formatToParts(date).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  return `${parts.year}${parts.month}${parts.day}`;
}

// Idempotent Post-Now debug endpoint: today counts + last 5 per platform
try {
  const { DailyCounterModel } = require('./models/DailyCounter');
  const { PostModel } = require('./models/Post');
  const { runAutopilotDiagnostics } = require('./services/diagnostics');
  app.get('/api/posting/debug', async (req, res) => {
    try {
      const today = new Date();
      const dateKey = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
      const counters = await DailyCounterModel.find({ dateKey }).lean();
      const lastIg = await PostModel.find({ platform: 'instagram' }).sort({ createdAt: -1 }).limit(5).lean();
      const lastYt = await PostModel.find({ platform: 'youtube' }).sort({ createdAt: -1 }).limit(5).lean();
      res.json({ dateKey, counters, last: { instagram: lastIg, youtube: lastYt } });
    } catch (e) {
      res.status(500).json({ error: e?.message || 'debug failed' });
    }
  });

  // Diagnostics: why no posts today
  app.get('/api/diag/why-no-posts-today', async (req, res) => {
    try {
      const result = await runAutopilotDiagnostics();
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Diagnostic failed', details: err?.message || String(err) });
    }
  });
} catch(_) {}

// Heartbeat + time debug routes
app.get('/api/scheduler/heartbeat', (req, res) => {
  res.json(schedulerHeartbeat);
});

app.get('/api/time/debug', (req, res) => {
  const now = new Date();
  const nowUTC = now.toISOString();
  const nowCT = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(now);
  res.json({
    serverTz: schedulerHeartbeat.serverTz,
    nowUTC,
    nowCT,
    dateKeyCT: formatCTDateKey(now)
  });
});

// Zillow Assistant routes removed per request

// Start cron scheduler (America/Chicago)
try {
  const { startCronScheduler } = require('./services/cronScheduler');
  const { checkAndExecuteDuePosts } = require('./services/cronScheduler');
  // Reset ticks hourly
  setInterval(() => { schedulerHeartbeat.ticksLastHour = 0; }, 60 * 60 * 1000);
  startCronScheduler(SchedulerQueueModel, SettingsModel, () => {
    schedulerHeartbeat.lastTickAtISO = new Date().toISOString();
    schedulerHeartbeat.ticksLastHour += 1;
  });
  // Fallback tick: ensure a heartbeat and due-post check every 60s even if cron missed
  setInterval(() => {
    try {
      schedulerHeartbeat.lastTickAtISO = new Date().toISOString();
      schedulerHeartbeat.ticksLastHour += 1;
      checkAndExecuteDuePosts(SchedulerQueueModel, SettingsModel);
    } catch (_) {}
  }, 60 * 1000);
} catch (e) {
  console.warn('⚠️ Failed to start cron scheduler:', e.message);
}

// Manual tick endpoint for Render Cron Jobs
app.get('/api/scheduler/tick', async (req, res) => {
  try {
    const { checkAndExecuteDuePosts } = require('./services/cronScheduler');
    schedulerHeartbeat.lastTickAtISO = new Date().toISOString();
    schedulerHeartbeat.ticksLastHour += 1;
    await checkAndExecuteDuePosts(SchedulerQueueModel, SettingsModel);
    res.json({ ok: true, tickedAt: schedulerHeartbeat.lastTickAtISO });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || 'tick failed' });
  }
});

// One-time migration: normalize legacy statuses to 'scheduled'
(async () => {
  try {
    const result = await SchedulerQueueModel.updateMany({ status: 'pending' }, { status: 'scheduled' });
    if (result.modifiedCount) {
      console.log(`🛠️ [MIGRATION] Updated ${result.modifiedCount} legacy pending items to scheduled`);
    }
  } catch (mErr) {
    console.warn('⚠️ [MIGRATION] Could not normalize legacy statuses:', mErr.message);
  }
})();

// Autopilot status
app.get('/api/autopilot/status', async (req, res) => {
  try {
    const settings = await SettingsModel.findOne();
    res.json({
      autopilotEnabled: settings?.autopilotEnabled || false,
      status: 'ready'
    });
  } catch (error) {
    console.error('❌ [AUTOPILOT STATUS] Error:', error);
    res.status(500).json({ error: 'Failed to get autopilot status' });
  }
});

// Delete autopilot queue
app.delete('/api/autopilot/queue', async (req, res) => {
  try {
    const result = await SchedulerQueueModel.deleteMany({});
    console.log(`🗑️ [AUTOPILOT QUEUE] Deleted ${result.deletedCount} items`);
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (error) {
    console.error('❌ [AUTOPILOT QUEUE DELETE] Error:', error);
    res.status(500).json({ error: 'Failed to delete autopilot queue' });
  }
});

// Debug posted videos
app.get('/api/debug/posted-videos', async (req, res) => {
  try {
    const postedVideos = await SchedulerQueueModel.find({ 
      platform: "instagram", 
      status: "posted" 
    })
    .sort({ postedAt: -1 })
    .limit(30)
    .select("thumbnailHash originalVideoId postedAt engagement");
    
    res.json({ 
      count: postedVideos.length,
      videos: postedVideos 
    });
  } catch (error) {
    console.error('❌ [DEBUG POSTED] Error:', error);
    res.status(500).json({ error: 'Failed to get posted videos' });
  }
});

// Create mock posted videos for testing duplicate prevention
app.post('/api/debug/create-mock-posted', async (req, res) => {
  try {
    const mockPostedVideos = [
      {
        platform: 'instagram',
        status: 'posted',
        originalVideoId: '18456098467004286',
        thumbnailHash: 'mock1hash',
        postedAt: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 day ago
        engagement: 1917726
      },
      {
        platform: 'instagram', 
        status: 'posted',
        originalVideoId: '18052183477796236',
        thumbnailHash: 'mock2hash',
        postedAt: new Date(Date.now() - 1000 * 60 * 60 * 48), // 2 days ago
        engagement: 448956
      }
    ];
    
    const result = await SchedulerQueueModel.insertMany(mockPostedVideos);
    res.json({ success: true, created: result.length });
  } catch (error) {
    console.error('❌ [MOCK POSTED] Error:', error);
    res.status(500).json({ error: 'Failed to create mock posted videos' });
  }
});

// OLD POST NOW ENDPOINT REMOVED - Use /api/postNow instead
// This endpoint redirects to the new service-based implementation
app.post('/api/autopilot/manual-post', async (req, res) => {
  console.log('⚠️ [DEPRECATED] /api/autopilot/manual-post called - redirecting to /api/postNow');
  
  try {
    const settings = await SettingsModel.findOne({});
    if (!settings || !settings.instagramToken || !settings.igBusinessId) {
      return res.status(400).json({ error: 'Missing Instagram credentials in settings' });
    }

    const { executePostNow } = require('./services/postNow');
    const result = await executePostNow(settings);
    return res.status(200).json(result);
    
  } catch (err) {
    console.error("❌ [POST NOW ERROR]", err);
    res.status(500).json({ 
      error: "Internal server error", 
      details: err.message,
      success: false 
    });
  }
});

// Get autopilot queue
app.get('/api/autopilot/queue', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    console.log('📋 [AUTOPILOT QUEUE] Fetching real queue data from SchedulerQueueModel...');
    
    // Only show upcoming items in the Smart Queue (hide posted/failed/completed)
    const queueItems = await SchedulerQueueModel.find({
      status: { $in: ['scheduled', 'pending', 'processing'] }
    })
      .sort({ scheduledTime: 1 })
      .limit(50);
    
    const formattedQueue = queueItems.map(item => ({
      id: item._id,
      platform: item.platform,
      caption: item.caption || 'Generated caption',
      scheduledTime: item.scheduledTime,
      scheduledTimeLocal: item.scheduledTime ? new Date(item.scheduledTime).toLocaleString('en-US', { timeZone: (item.timeZone || 'America/Chicago') }) : null,
      status: item.status,
      source: item.source || 'autopilot',
      videoUrl: item.videoUrl || item.s3Url,
      thumbnailUrl: item.thumbnailUrl || item.s3Url,
      engagement: item.engagement || 0,
      originalVideoId: item.originalVideoId
    }));
    
    console.log(`📋 [AUTOPILOT QUEUE] Found ${formattedQueue.length} scheduled posts`);
    
    res.json({
      queue: formattedQueue,
      posts: formattedQueue,
      totalCount: formattedQueue.length,
      platforms: [...new Set(formattedQueue.map(p => p.platform))]
    });
  } catch (error) {
    console.error('❌ [AUTOPILOT QUEUE ERROR]', error);
    res.status(500).json({ error: 'Failed to get AutoPilot queue' });
  }
});

// Run autopilot
app.post('/api/autopilot/run', async (req, res) => {
  try {
    console.log('🚀 [AUTOPILOT] Triggered manual autopilot run');
    const path = require('path');
    let runAutopilotOnce;
    try {
      ({ runAutopilotOnce } = require(path.resolve(__dirname, '..', 'services', 'autopilot')));
    } catch (_) {
      ({ runAutopilotOnce } = require('./services/autopilot'));
    }
    // Respond fast; run in background
    setImmediate(async () => {
      try {
        const result = await runAutopilotOnce();
        console.log('✅ [AUTOPILOT] Completed:', result);
      } catch (err) {
        console.error('❌ [AUTOPILOT] Background error:', err.message);
      }
    });
    return res.json({ success: true, message: 'Autopilot started (background)' });
  } catch (error) {
    console.error('❌ [AUTOPILOT] Error:', error);
    return res.status(500).json({ error: 'AutoPilot failed to start' });
  }
});

// Settings endpoints
app.get('/api/settings', async (req, res) => {
  try {
    console.log('📋 [SETTINGS] Fetching settings from MongoDB...');
    const settings = await SettingsModel.findOne();
    console.log('📋 [SETTINGS] Found settings:', settings ? 'YES' : 'NO');
    if (settings) {
      console.log('📋 [SETTINGS] Settings keys:', Object.keys(settings.toObject || settings));
    }
    res.json(settings || {});
  } catch (error) {
    console.error('❌ [SETTINGS] Error:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    console.log('💾 [SETTINGS] Updating settings with:', Object.keys(req.body));
    const settings = await SettingsModel.findOneAndUpdate({}, req.body, { 
      new: true, 
      upsert: true 
    });
    console.log('💾 [SETTINGS] Update result:', settings ? 'SUCCESS' : 'FAILED');
    res.json(settings);
  } catch (error) {
    console.error('❌ [SETTINGS] Update error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Analytics endpoint (real data)
app.get('/api/analytics', async (req, res) => {
  try {
    const settings = await SettingsModel.findOne();
    if (!settings) {
      return res.json({
        instagram: { followers: 0, reach: 0, engagementRate: 0, autopilotEnabled: false },
        youtube: { subscribers: 0, reach: 0, autopilotEnabled: false },
      });
    }

    let instagram = { followers: 0, reach: 0, engagementRate: 0, autopilotEnabled: !!settings.autopilotEnabled };
    let youtube = { subscribers: 0, reach: 0, autopilotEnabled: !!settings.autopilotEnabled };

    try {
      const { getInstagramAnalytics } = require('./services/instagramAnalytics');
      const ig = await getInstagramAnalytics(SettingsModel);
      instagram = {
        followers: ig.followers || 0,
        reach: ig.reach || 0,
        engagementRate: (typeof ig.engagement === 'number') ? (ig.engagement / 100) : (ig.engagementRate || 0),
        autopilotEnabled: !!settings.autopilotEnabled,
      };
    } catch (e) {
      console.warn('⚠️ [ANALYTICS] Instagram fetch failed:', e.message);
    }

    try {
      const { getYouTubeAnalytics } = require('./services/youtubeAnalytics');
      const yt = await getYouTubeAnalytics(SettingsModel);
      youtube = {
        subscribers: yt.subscribers || 0,
        reach: yt.views || 0,
        autopilotEnabled: !!settings.autopilotEnabled,
      };
    } catch (e) {
      console.warn('⚠️ [ANALYTICS] YouTube fetch failed:', e.message);
    }

    res.json({ instagram, youtube });
  } catch (error) {
    console.error('❌ [ANALYTICS] Error:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

// (uploads endpoints intentionally not added here to preserve production backend contract)

// Audience score endpoint: computes per-hour audience engagement and logs
app.get('/api/audience/score', async (req, res) => {
  try {
    const hour = parseInt(String(req.query.hour ?? new Date().getHours()), 10);
    const dayOfWeek = parseInt(String(req.query.dayOfWeek ?? new Date().getDay()), 10);

    // Basic heuristic from analytics as a placeholder for live per-hour metrics
    // You can replace with platform APIs that return current viewers/impressions per hour
    const { getInstagramAnalytics } = require('./services/instagramAnalytics');
    const { getYouTubeAnalytics } = require('./services/youtubeAnalytics');
    const [ig, yt] = await Promise.all([
      getInstagramAnalytics(SettingsModel).catch(() => ({})),
      getYouTubeAnalytics(SettingsModel).catch(() => ({})),
    ]);

    // Normalize rough scores 0..1
    const igEng = (typeof ig.engagement === 'number' ? ig.engagement : (ig.engagementRate || 0));
    const igScore = Math.max(0, Math.min(1, (igEng > 1 ? igEng / 100 : igEng)));
    const ytViews = Number(yt.views || 0);
    const ytSubs = Number(yt.subscribers || 1);
    const ytScore = Math.max(0, Math.min(1, ytSubs ? (ytViews / (ytSubs * 50)) : 0));

    const instagram = Number(igScore.toFixed(3));
    const youtube = Number(ytScore.toFixed(3));

    // Log to Mongo for trend analysis
    const docs = [
      { platform: 'instagram', hour, dayOfWeek, score: instagram, raw: { ig } },
      { platform: 'youtube', hour, dayOfWeek, score: youtube, raw: { yt } },
    ];
    try { await AudienceActivityModel.insertMany(docs); } catch {}

    res.json({ instagram, youtube, hour, dayOfWeek });
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute audience score' });
  }
});

// =========================
// Audience Heatmap (weekly)
// =========================
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

    const classify = (reach) => {
      if (reach >= 851) return 'extreme';
      if (reach >= 601) return 'very-high';
      if (reach >= 401) return 'high';
      if (reach >= 251) return 'medium';
      if (reach >= 101) return 'low';
      return 'minimal';
    };

    // Convert normalized score (0..1) to a pseudo-reach scale using observed counts as weight
    rows.forEach(r => {
      const d = Math.max(0, Math.min(6, r.dayOfWeek));
      const h = Math.max(0, Math.min(23, r.hour));
      const reach = Math.round((r.avgScore || 0) * 1000); // derived from real score logs
      grid[d][h] = { score: Number((r.avgScore || 0).toFixed(3)), reach, level: classify(reach), count: r.count };
    });

    res.json({ platform, daysBack, grid });
  } catch (err) {
    console.error('❌ [AUDIENCE HEATMAP] Error:', err);
    res.status(500).json({ error: 'Failed to build audience heatmap' });
  }
});

// =========================
// Optimal Post Times (top 3)
// =========================
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

    const weekdayBonus = (d) => (d >= 1 && d <= 5 ? 1.05 : 1);
    const scored = agg.map(r => ({
      dayOfWeek: r.dayOfWeek,
      hour: r.hour,
      score: (r.avgScore || 0) * weekdayBonus(r.dayOfWeek),
    }));

    scored.sort((a, b) => b.score - a.score);
    const top3 = scored.slice(0, 3).map(s => {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const hh = String(s.hour).padStart(2, '0');
      return `${dayNames[s.dayOfWeek]} ${hh}:00`;
    });

    res.json({ platform, top3 });
  } catch (err) {
    console.error('❌ [OPTIMAL TIMES] Error:', err);
    res.status(500).json({ error: 'Failed to compute optimal times' });
  }
});

// =====================================
// Performance Heatmap (posts vs audience)
// =====================================
app.get('/api/performance-heatmap', async (req, res) => {
  try {
    const platform = (req.query.platform || 'instagram').toString();
    const daysBack = Number(req.query.days || 30);
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    const audience = await AudienceActivityModel.aggregate([
      { $match: { platform, createdAt: { $gte: since } } },
      { $group: { _id: { d: '$dayOfWeek', h: '$hour' }, avgScore: { $avg: '$score' }, count: { $sum: 1 } } },
      { $project: { dayOfWeek: '$_id.d', hour: '$_id.h', avgScore: 1, count: 1, _id: 0 } },
    ]);

    const posts = await SchedulerQueueModel.aggregate([
      { $match: { platform, status: { $in: ['posted', 'completed'] }, postedAt: { $gte: since } } },
      { $project: { postedAt: 1, engagement: 1 } },
      { $project: { 
          dayOfWeek: { $dayOfWeek: '$postedAt' },
          hour: { $hour: '$postedAt' },
          engagement: 1
        } 
      },
      { $group: { _id: { d: { $subtract: ['$dayOfWeek', 1] }, h: '$hour' }, avgEngagement: { $avg: '$engagement' }, count: { $sum: 1 } } },
      { $project: { dayOfWeek: '$_id.d', hour: '$_id.h', avgEngagement: 1, count: 1, _id: 0 } }
    ]);

    const byKey = new Map();
    audience.forEach(a => byKey.set(`${a.dayOfWeek}-${a.hour}`, { aud: a.avgScore }));
    posts.forEach(p => {
      const k = `${p.dayOfWeek}-${p.hour}`;
      const base = byKey.get(k) || {};
      base.post = p.avgEngagement || 0;
      byKey.set(k, base);
    });

    const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ audience: 0, performance: 0, delta: 0 })));
    for (const [key, val] of byKey.entries()) {
      const [dStr, hStr] = key.split('-');
      const d = Number(dStr); const h = Number(hStr);
      const audienceScore = Number((val.aud || 0).toFixed(3));
      const performance = Number((val.post || 0).toFixed(3));
      const delta = Number((performance - audienceScore).toFixed(3));
      grid[d][h] = { audience: audienceScore, performance, delta };
    }

    res.json({ platform, grid });
  } catch (err) {
    console.error('❌ [PERFORMANCE HEATMAP] Error:', err);
    res.status(500).json({ error: 'Failed to build performance heatmap' });
  }
});

// ==========================
// Scheduler Autofill (POST)
// ==========================
app.post('/api/scheduler/autofill', async (req, res) => {
  try {
    const platform = (req.query.platform || req.body.platform || 'instagram').toString();
    const maxPostsPerDay = Number(req.query.maxPostsPerDay || req.body.maxPostsPerDay || 3);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Aggregate audience activity for last 7 days
    const agg = await AudienceActivityModel.aggregate([
      { $match: { platform, createdAt: { $gte: since } } },
      { $group: { _id: { d: '$dayOfWeek', h: '$hour' }, avgScore: { $avg: '$score' } } },
      { $project: { dayOfWeek: '$_id.d', hour: '$_id.h', avgScore: 1, _id: 0 } },
    ]);

    // Sort by score desc and enforce spacing by at least 60 minutes
    agg.sort((a,b) => (b.avgScore || 0) - (a.avgScore || 0));

    const chosen = [];
    const takenByDay = new Map();
    for (const row of agg) {
      const d = row.dayOfWeek;
      const h = row.hour;
      const key = `${d}-${h}`;
      const dayList = takenByDay.get(d) || [];
      if (dayList.length >= maxPostsPerDay) continue;
      // Spacing: avoid adjacent hours
      if (dayList.some((hour) => Math.abs(hour - h) < 1)) continue;
      dayList.push(h);
      takenByDay.set(d, dayList);
      chosen.push({ d, h });
      if (chosen.length >= 3) break;
    }

    // Create dates for next week for the same weekday/hour in America/Chicago
    const tz = 'America/Chicago';
    const now = new Date();
    const upcoming = chosen.map(({ d, h }) => {
      // Find next date that matches the weekday d
      const date = new Date(now);
      const currentDow = date.getDay();
      let diff = d - currentDow;
      if (diff <= 0) diff += 7; // next occurrence
      date.setDate(date.getDate() + diff);
      date.setHours(h, 0, 0, 0);
      return date;
    });

    // Prevent duplicates: do not insert if a scheduled item already exists at that hour/day
    const inserts = [];
    for (const dt of upcoming) {
      const exists = await SchedulerQueueModel.findOne({ platform, scheduledTime: dt });
      if (exists) continue;
      inserts.push({
        platform,
        scheduledTime: dt,
        status: 'scheduled',
        source: 'autopilot',
        autofill: true,
      });
    }

    if (inserts.length) {
      await SchedulerQueueModel.insertMany(inserts);
    }

    res.json({ platform, added: inserts.length, slots: upcoming.map(d => d.toISOString()) });
  } catch (err) {
    console.error('❌ [AUTOFILL] Error:', err);
    res.status(500).json({ error: 'Failed to autofill schedule' });
  }
});

// ==========================
// Audience AI/Template Summary
// ==========================
app.get('/api/audience-summary', async (req, res) => {
  try {
    const platform = (req.query.platform || 'instagram').toString();
    const daysBack = Number(req.query.days || 14);
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    const activity = await AudienceActivityModel.aggregate([
      { $match: { platform, createdAt: { $gte: since } } },
      { $group: { _id: { d: '$dayOfWeek', h: '$hour' }, avg: { $avg: '$score' } } },
      { $project: { dayOfWeek: '$_id.d', hour: '$_id.h', avg: 1, _id: 0 } },
      { $sort: { avg: -1 } }
    ]);

    const top = activity.slice(0, 3);
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const best = top.map(t => `${dayNames[t.dayOfWeek]} ${String(t.hour).padStart(2,'0')}:00`);

    // Compare against scheduled queue in the next 7 days
    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const scheduled = await SchedulerQueueModel.find({ platform, scheduledTime: { $gte: now, $lte: weekAhead } });

    const matchCount = scheduled.filter(s => best.some(b => {
      const [dStr, time] = b.split(' ');
      const hh = Number(time.slice(0,2));
      return s.scheduledTime.getDay() === dayNames.indexOf(dStr) && s.scheduledTime.getHours() === hh;
    })).length;

    let summary = `Your ${platform} audience peaks around ${best.join(', ')}. ` +
      `Your upcoming schedule currently matches ${matchCount} of the top 3 slots.`;

    // Optional OpenAI rewrite (if key present)
    try {
      const OPENAI_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
      if (OPENAI_KEY) {
        const fetch = require('node-fetch');
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: `Rewrite this as a concise friendly tip for a social media scheduling dashboard: ${summary}` }]
          })
        });
        const j = await resp.json();
        const tip = j?.choices?.[0]?.message?.content;
        if (tip) summary = tip;
      }
    } catch {}

    res.json({ platform, summary, topTimes: best, matched: matchCount });
  } catch (err) {
    console.error('❌ [AUDIENCE SUMMARY] Error:', err);
    res.status(500).json({ error: 'Failed to generate audience summary' });
  }
});

// ==========================
// Chart status + Events feed
// ==========================
app.get('/api/chart/status', async (req, res) => {
  try {
    const settings = await SettingsModel.findOne();
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);

    // Aggregate recent audience engagement as a proxy for engagement score
    const recent = await AudienceActivityModel.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: null, avg: { $avg: '$score' } } }
    ]);
    const engagementScore = Number(((recent?.[0]?.avg) || 0.5).toFixed(3));

    const startOfDay = new Date();
    startOfDay.setHours(0,0,0,0);
    const endOfDay = new Date();
    endOfDay.setHours(23,59,59,999);

    const [igToday, ytToday, lastPosted] = await Promise.all([
      SchedulerQueueModel.countDocuments({ platform: 'instagram', status: { $in: ['posted','completed'] }, postedAt: { $gte: startOfDay, $lte: endOfDay } }),
      SchedulerQueueModel.countDocuments({ platform: 'youtube', status: { $in: ['posted','completed'] }, postedAt: { $gte: startOfDay, $lte: endOfDay } }),
      SchedulerQueueModel.findOne({ status: { $in: ['posted','completed'] } }).sort({ postedAt: -1 }).select('postedAt')
    ]);

    res.json({
      settings: { dailyPostLimit: settings?.maxPosts || 3 },
      autopilotRunning: !!settings?.autopilotEnabled,
      engagementScore,
      newHighScore: false,
      lastPostTime: lastPosted?.postedAt || null,
      platformData: {
        instagram: { active: !!settings?.postToInstagram, todayPosts: igToday },
        youtube: { active: !!settings?.postToYouTube, todayPosts: ytToday }
      }
    });
  } catch (err) {
    console.error('❌ [CHART STATUS] Error:', err);
    res.status(500).json({ error: 'Failed to get chart status' });
  }
});

app.get('/api/events/recent', async (req, res) => {
  // Minimal empty events feed to support frontend polling
  res.json({ events: [], timestamp: Date.now() });
});

// ==========================
// Activity feed (recent posts)
// ==========================
app.get('/api/activity/feed', async (req, res) => {
  try {
    const platform = req.query.platform && String(req.query.platform);
    const limit = Number(req.query.limit || 10);
    const match = { status: { $in: ['posted', 'completed'] } };
    if (platform) Object.assign(match, { platform });

    const items = await SchedulerQueueModel.find(match)
      .sort({ postedAt: -1, updatedAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 50))
      .select('platform thumbnailUrl postedAt createdAt');

    const data = items.map(it => ({
      platform: it.platform,
      thumbnailUrl: it.thumbnailUrl,
      timestamp: it.postedAt || it.createdAt
    }));

    res.json(data);
  } catch (err) {
    console.error('❌ [ACTIVITY FEED] Error:', err);
    res.status(500).json({ error: 'Failed to load activity feed' });
  }
});

// Heart chart backend routes removed per request.

// Test YouTube credentials endpoint
app.get('/api/test/youtube', async (req, res) => {
  try {
    console.log('🔍 [YOUTUBE TEST] Fetching and testing YouTube credentials...');
    const settings = await SettingsModel.findOne();
    
    if (!settings) {
      return res.json({ error: 'No settings found' });
    }
    
    // Log what YouTube credentials we have
    console.log('🔍 [YOUTUBE TEST] YouTube credentials check:');
    console.log(`  - youtubeClientId: ${settings.youtubeClientId ? 'EXISTS' : 'MISSING'}`);
    console.log(`  - youtubeClientSecret: ${settings.youtubeClientSecret ? 'EXISTS' : 'MISSING'}`);
    console.log(`  - youtubeAccessToken: ${settings.youtubeAccessToken ? 'EXISTS' : 'MISSING'}`);
    console.log(`  - youtubeRefreshToken: ${settings.youtubeRefreshToken ? 'EXISTS' : 'MISSING'}`);
    console.log(`  - youtubeChannelId: ${settings.youtubeChannelId ? 'EXISTS' : 'MISSING'}`);
    
    const result = {
      hasClientId: !!settings.youtubeClientId,
      hasClientSecret: !!settings.youtubeClientSecret,
      hasAccessToken: !!settings.youtubeAccessToken,
      hasRefreshToken: !!settings.youtubeRefreshToken,
      hasChannelId: !!settings.youtubeChannelId
    };
    
    // Test YouTube API if we have access token
    if (settings.youtubeAccessToken) {
      try {
        const fetch = require('node-fetch');
        const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&mine=true&access_token=${settings.youtubeAccessToken}`;
        console.log('🔗 [YOUTUBE TEST] Testing API call...');
        
        const response = await fetch(channelUrl);
        const data = await response.json();
        
        if (response.ok) {
          console.log('✅ [YOUTUBE TEST] API call successful!');
          console.log(`📊 [YOUTUBE TEST] Channel: ${data.items?.[0]?.snippet?.title}`);
          result.apiTest = 'SUCCESS';
          result.channelData = data.items?.[0];
        } else {
          console.log(`❌ [YOUTUBE TEST] API call failed: ${response.status}`);
          console.log(`❌ [YOUTUBE TEST] Error: ${JSON.stringify(data)}`);
          result.apiTest = 'FAILED';
          result.apiError = data;
        }
      } catch (apiError) {
        console.log(`❌ [YOUTUBE TEST] API error: ${apiError.message}`);
        result.apiTest = 'ERROR';
        result.apiError = apiError.message;
      }
    } else {
      result.apiTest = 'NO_TOKEN';
    }
    
    res.json(result);
  } catch (error) {
    console.error('❌ [YOUTUBE TEST] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST NOW - Step-by-step flow with visual hash + caption similarity protection
// Non-blocking trigger: enqueue a background job and respond immediately
app.post('/api/postNow', async (req, res) => {
  try {
    console.log("📲 [POST NOW] Trigger received → enqueue background job");

    const settings = await SettingsModel.findOne({});
    if (!settings || !settings.instagramToken || !settings.igBusinessId) {
      return res.status(400).json({ error: 'Missing Instagram credentials in settings' });
    }

    const { enqueue, getQueueSnapshot } = require('./services/jobQueue');
    const { executePostNow } = require('./services/postNow');

    const jobId = enqueue(async () => {
      return await executePostNow(settings);
    });

    const snapshot = getQueueSnapshot();
    return res.status(202).json({
      success: true,
      message: 'Post Now job enqueued',
      jobId,
      queue: snapshot,
    });
  } catch (err) {
    console.error("❌ [POST NOW ERROR]", err);
    res.status(500).json({ 
      error: "Internal server error",
      details: err.message,
      success: false 
    });
  }
});

// Job status endpoint (optional; helpful for debugging UI)
app.get('/api/postNow/status/:jobId', (req, res) => {
  try {
    const { getJobStatus } = require('./services/jobQueue');
    const status = getJobStatus(req.params.jobId);
    if (!status) return res.status(404).json({ error: 'Job not found' });
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get job status', details: err.message });
  }
});

const fs = require('fs');
const path = require('path');
function readFileSafe(p){ try { return fs.readFileSync(p, 'utf8').trim(); } catch { return null; } }
const VERSION  = readFileSafe(path.join(__dirname, 'VERSION')) || process.env.RENDER_GIT_COMMIT || 'unknown';
const BUILT_AT = readFileSafe(path.join(__dirname, 'BUILD_TIME')) || new Date().toISOString();
console.log('🆕 Server booted', { version: VERSION, builtAt: BUILT_AT });

// Health check
app.get('/health', (_req, res) => {
  res.json({ ok: true, nowUTC: new Date().toISOString(), version: VERSION, builtAt: BUILT_AT, pid: process.pid });
});

// Heatmap endpoints with safe fallbacks
app.get('/api/heatmap/weekly', async (_req, res) => {
  try {
    const { computeWeeklyHeatmap } = require('./services/heatmap');
    const data = await computeWeeklyHeatmap();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to compute weekly heatmap' });
  }
});

app.get('/api/heatmap/optimal-times', async (req, res) => {
  try {
    const { computeOptimalTimes } = require('./services/heatmap');
    const limit = Number(req.query.limit || 5);
    const data = await computeOptimalTimes(limit);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to compute optimal times' });
  }
});

// Scheduler status used by UI
app.get('/api/scheduler/status', async (_req, res) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0,0,0,0);
    const endOfDay = new Date(now); endOfDay.setHours(23,59,59,999);
    const queueSize = await SchedulerQueueModel.countDocuments({ status: { $in: ['scheduled','processing','pending'] } });
    const [igToday, ytToday] = await Promise.all([
      SchedulerQueueModel.countDocuments({ platform: 'instagram', status: { $in: ['posted','completed'] }, postedAt: { $gte: startOfDay, $lte: endOfDay } }),
      SchedulerQueueModel.countDocuments({ platform: 'youtube', status: { $in: ['posted','completed'] }, postedAt: { $gte: startOfDay, $lte: endOfDay } })
    ]);
    const settingsDoc = await SettingsModel.findOne({});
    const limit = Number(settingsDoc?.maxPosts || 5);
    const nextRun = new Date(Date.now()+60*1000).toISOString();
    res.json({
      queueSize,
      today: { instagram: igToday, youtube: ytToday },
      nextRun,
      instagram: { used: igToday, limit },
      youtube: { used: ytToday, limit }
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to get scheduler status' });
  }
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('✅ AutoPilot system ready with Instagram API duplicate detection ACTIVE [v42]');
});