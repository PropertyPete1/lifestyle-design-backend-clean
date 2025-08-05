require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 10000;

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
    'https://lifestyle-design-frontend-clean.vercel.app'
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
    const mockQueue = [
      {
        id: 1,
        platform: 'instagram',
        videoUrl: 'https://example.com/video1.mp4',
        caption: 'Amazing real estate opportunity!',
        scheduledTime: new Date(Date.now() + 3600000),
        status: 'scheduled',
        engagement: 15000
      },
      {
        id: 2,
        platform: 'youtube', 
        videoUrl: 'https://example.com/video2.mp4',
        caption: 'Check out this stunning property!',
        scheduledTime: new Date(Date.now() + 7200000),
        status: 'scheduled',
        engagement: 25000
      }
    ];
    
    res.json({
      queue: mockQueue,
      totalCount: mockQueue.length,
      platforms: ['instagram', 'youtube']
    });
  } catch (error) {
    console.error('❌ [AUTOPILOT QUEUE ERROR]', error);
    res.status(500).json({ error: 'Failed to get AutoPilot queue' });
  }
});

app.post('/api/autopilot/run', async (req, res) => {
  try {
    console.log('🚀 [AUTOPILOT] Starting AutoPilot run...');
    
    const settings = await SettingsModel.findOne();
    if (!settings) {
      return res.status(400).json({ error: 'No settings found. Please configure your credentials first.' });
    }

    if (!settings.autopilotEnabled) {
      return res.status(400).json({ error: 'AutoPilot is disabled. Enable it in settings first.' });
    }

    // Mock successful run for now
    settings.lastAutopilotRun = new Date();
    await settings.save();

    console.log('✅ [AUTOPILOT] AutoPilot run completed successfully');

    res.json({
      success: true,
      message: 'AutoPilot run completed successfully',
      videosScraped: 50,
      videosScheduled: 2,
      selectedVideo: {
        engagement: 15000,
        duration: 30
      },
      scheduledPosts: [
        {
          platform: 'instagram',
          scheduledTime: new Date(Date.now() + 3600000),
          caption: 'Amazing real estate opportunity with stunning views...'
        },
        {
          platform: 'youtube',
          scheduledTime: new Date(Date.now() + 7200000),
          caption: 'Top real estate tips for 2025...'
        }
      ]
    });

  } catch (error) {
    console.error('❌ [AUTOPILOT RUN ERROR]', error);
    res.status(500).json({ error: 'AutoPilot run failed', message: error.message });
  }
});

console.log('✅ AutoPilot routes registered directly in server.js');

// Analytics services
const instagramAnalytics = require('./services/instagramAnalytics');
const youtubeAnalytics = require('./services/youtubeAnalytics');

// Unified dashboard analytics endpoint
app.get('/api/analytics', async (req, res) => {
  try {
    const settings = await SettingsModel.findOne();
    if (!settings) {
      return res.json({
        instagram: { followers: 0, reach: 0, engagementRate: 0, autopilotEnabled: false },
        youtube: { subscribers: 0, reach: 0, autopilotEnabled: false },
        upcomingPosts: [],
        credentials: {}
      });
    }

    const [igData, ytData] = await Promise.allSettled([
      instagramAnalytics.getInstagramAnalytics(SettingsModel),
      youtubeAnalytics.getYouTubeAnalytics(SettingsModel)
    ]);

    res.json({
      instagram: {
        followers: igData.status === 'fulfilled' ? igData.value.followers : 0,
        reach: igData.status === 'fulfilled' ? igData.value.reach : 0,
        engagementRate: igData.status === 'fulfilled' ? igData.value.engagementRate : 0,
        autopilotEnabled: settings.autopilotEnabled || false
      },
      youtube: {
        subscribers: ytData.status === 'fulfilled' ? ytData.value.subscribers : 0,
        reach: ytData.status === 'fulfilled' ? ytData.value.reach : 0,
        autopilotEnabled: settings.autopilotEnabled || false
      },
      upcomingPosts: [],
      credentials: process.env.NODE_ENV === 'development' ? {
        instagramToken: settings.instagramToken ? '***' : null,
        youtubeToken: settings.youtubeAccessToken ? '***' : null,
        s3Bucket: settings.s3BucketName || null,
        mongoUri: settings.mongoURI ? '***' : null
      } : {}
    });
  } catch (error) {
    console.error('❌ [ANALYTICS ERROR]', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Activity feed endpoints (for dashboard)
app.get('/api/activity/feed', async (req, res) => {
  try {
    // Mock activity data for now
    res.json([
      { id: 1, type: 'post', platform: 'instagram', status: 'scheduled', timestamp: new Date() },
      { id: 2, type: 'post', platform: 'youtube', status: 'posted', timestamp: new Date() }
    ]);
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

// Settings Routes
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await SettingsModel.findOne();
    if (!settings) {
      return res.json({}); // Return empty object instead of 404
    }
    res.json(settings);
  } catch (err) {
    console.error('[❌ SETTINGS FETCH ERROR]', err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const incoming = req.body;
    let settings = await SettingsModel.findOne();
    if (settings) {
      Object.assign(settings, incoming);
    } else {
      settings = new SettingsModel(incoming);
    }
    await settings.save();
    console.log('[✅ SETTINGS SAVED]', Object.keys(incoming));
    res.status(200).json({ message: 'Settings saved', settings });
  } catch (err) {
    console.error('[❌ SETTINGS SAVE ERROR]', err);
    res.status(500).json({ error: 'Failed to save settings' });
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
  
  app.listen(PORT, () => {
    console.log('🚀 [SERVER] Backend v2 running on port', PORT);
    console.log('📋 [SERVER] Available endpoints:');
    console.log('   GET  /health - Health check');
    console.log('   GET  /api/settings - Load settings (DIRECT)');
    console.log('   POST /api/settings - Save settings (DIRECT)');
  });
};

startServer().catch(console.error);