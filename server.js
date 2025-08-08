require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();

// Middleware
app.use(cors());
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
}, { timestamps: true, collection: 'SchedulerQueue' });

const SchedulerQueueModel = mongoose.model('SchedulerQueue', schedulerQueueSchema);

// API Routes

// Start cron scheduler (America/Chicago)
try {
  const { startCronScheduler } = require('./services/cronScheduler');
  startCronScheduler(SchedulerQueueModel, SettingsModel);
} catch (e) {
  console.warn('⚠️ Failed to start cron scheduler:', e.message);
}

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
    
    const queueItems = await SchedulerQueueModel.find({})
      .sort({ scheduledTime: 1 })
      .limit(50);
    
    const formattedQueue = queueItems.map(item => ({
      id: item._id,
      platform: item.platform,
      caption: item.caption || 'Generated caption',
      scheduledTime: item.scheduledTime,
      scheduledTimeLocal: item.scheduledTime ? new Date(item.scheduledTime).toLocaleString('en-US', { timeZone: 'America/Chicago' }) : null,
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
    const { runAutopilotOnce } = require('./services/autopilot');
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

// Missing API endpoints that frontend is calling
app.get('/api/chart/status', async (req, res) => {
  try {
    const settings = await SettingsModel.findOne();
    const autopilotEnabled = !!settings?.autopilotEnabled;

    // Basic structure the frontend expects
    const response = {
      status: autopilotEnabled ? 'active' : 'idle',
      engagement: 0.0,
      newRecord: false,
      autopilotRunning: autopilotEnabled,
      lastPostTime: null,
      platformData: {
        instagram: {
          active: autopilotEnabled,
          todayPosts: 0,
          reach: 0,
          engagement: 0,
          lastPostTime: null,
          trendingAudio: false,
        },
        youtube: {
          active: autopilotEnabled,
          todayPosts: 0,
          reach: 0,
          engagement: 0,
          lastPostTime: null,
          trendingAudio: false,
        }
      }
    };

    // Try enriching with analytics
    try {
      const { getInstagramAnalytics } = require('./services/instagramAnalytics');
      const ig = await getInstagramAnalytics(SettingsModel);
      response.platformData.instagram.reach = ig.reach || 0;
      // normalize engagement (0-1)
      const igEng = typeof ig.engagement === 'number' ? ig.engagement : (ig.engagementRate || 0);
      response.platformData.instagram.engagement = igEng > 1 ? igEng / 100 : igEng;
    } catch {}
    try {
      const { getYouTubeAnalytics } = require('./services/youtubeAnalytics');
      const yt = await getYouTubeAnalytics(SettingsModel);
      response.platformData.youtube.reach = yt.views || 0;
      // YouTube engagement is approximated by avgViews/subscribers
      response.platformData.youtube.engagement = 0; // leave 0 unless computed elsewhere
    } catch {}

    res.json(response);
  } catch (err) {
    res.json({ status: 'active', charts: ['engagement', 'reach'] });
  }
});

app.get('/api/activity/feed', (req, res) => {
  const { platform, limit = 10 } = req.query;
  res.json({ activities: [], total: 0, platform });
});

app.get('/api/events/recent', (req, res) => {
  res.json({ events: [], lastUpdated: new Date().toISOString() });
});

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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
      console.log('✅ AutoPilot system ready with Instagram API duplicate detection ACTIVE [v42]');
});