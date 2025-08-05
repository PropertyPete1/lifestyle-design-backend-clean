require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

// Keep alive service to prevent Render cold starts
require('./keep-alive');

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

// Scheduler Queue Schema for autopilot posts
const schedulerQueueSchema = new mongoose.Schema({
  platform: { type: String, required: true }, // 'instagram' or 'youtube'
  videoUrl: { type: String, required: true }, // S3 URL
  caption: { type: String, required: true },
  audio: { type: String }, // Trending audio URL (Instagram only)
  scheduledTime: { type: Date, required: true },
  thumbnailUrl: { type: String },
  fingerprint: { type: String }, // For duplicate detection
  thumbnailHash: { type: String }, // For visual similarity
  originalVideoId: { type: String }, // Original Instagram video ID
  engagement: { type: Number }, // Original engagement count
  status: { type: String, enum: ['scheduled', 'posted', 'failed'], default: 'scheduled' },
  source: { type: String, default: 'autopilot' },
  postedAt: { type: Date },
  error: { type: String }
}, { timestamps: true });

const SchedulerQueueModel = mongoose.model('SchedulerQueue', schedulerQueueSchema);

// CORS configuration for frontend-v2
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001', 
    'https://frontend-v2-sage.vercel.app',
    'https://lifestyle-design-social.vercel.app',
    'https://lifestyle-design-frontend-clean.vercel.app',
    'https://lifestyle-design-frontend-v2.vercel.app',
    'https://lifestyle-design-frontend-clean-propertypete1s-projects.vercel.app',
    'https://lifestyle-design-frontend-clean-git-main-propertypete1s-projects.vercel.app'
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

    // Import and run real autopilot logic
    const { runInstagramAutoPilot } = require('./phases/autopilot');
    
    // Run the real autopilot system
    const result = await runInstagramAutoPilot(SettingsModel, SchedulerQueueModel);
    
    if (result.success) {
      // Update last run time
      settings.lastAutopilotRun = new Date();
      await settings.save();
      
      console.log('✅ [AUTOPILOT] AutoPilot run completed successfully');
      
      res.json({
        success: true,
        message: result.message,
        videosScraped: 500, // Always scrapes 500
        videosScheduled: result.queuedPosts?.length || 0,
        nextRun: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
        selectedVideo: result.selectedVideo,
        scheduledPosts: result.queuedPosts || [],
        s3Url: result.s3Url
      });
    } else {
      console.log('⚠️ [AUTOPILOT] AutoPilot run failed:', result.message);
      res.status(400).json({
        success: false,
        error: result.message,
        details: result.error
      });
    }

  } catch (error) {
    console.error('❌ [AUTOPILOT RUN ERROR]', error);
    res.status(500).json({ error: 'AutoPilot run failed', message: error.message });
  }
});

console.log('✅ AutoPilot routes registered directly in server.js');

// Queue management endpoints
app.get('/api/autopilot/queue', async (req, res) => {
  try {
    console.log('📋 [AUTOPILOT QUEUE] Fetching autopilot queue...');
    
    const queuedPosts = await SchedulerQueueModel.find({
      source: 'autopilot',
      status: { $in: ['scheduled', 'posted'] }
    }).sort({ scheduledTime: -1 }).limit(20).exec();
    
    const response = {
      total: queuedPosts.length,
      scheduled: queuedPosts.filter(p => p.status === 'scheduled').length,
      posted: queuedPosts.filter(p => p.status === 'posted').length,
      posts: queuedPosts.map(post => ({
        id: post._id,
        platform: post.platform,
        status: post.status,
        scheduledTime: post.scheduledTime,
        postedAt: post.postedAt,
        caption: post.caption.substring(0, 150) + '...',
        engagement: post.engagement,
        videoUrl: post.videoUrl,
        thumbnailUrl: post.thumbnailUrl
      }))
    };
    
    console.log(`📋 [AUTOPILOT QUEUE] Found ${response.total} posts`);
    res.json(response);
    
  } catch (error) {
    console.error('❌ [AUTOPILOT QUEUE ERROR]', error);
    res.status(500).json({ error: 'Failed to fetch autopilot queue' });
  }
});

// Enhanced scheduler status for autopilot
app.get('/api/scheduler/status', async (req, res) => {
  try {
    console.log('📊 [SCHEDULER STATUS] Fetching enhanced queue status...');
    
    // Get scheduled posts
    const scheduledPosts = await SchedulerQueueModel.find({
      status: 'scheduled'
    }).sort({ scheduledTime: 1 }).exec();
    
    // Get recent completed posts
    const completedPosts = await SchedulerQueueModel.find({
      status: 'posted'
    }).sort({ postedAt: -1 }).limit(5).exec();
    
    const nextPost = scheduledPosts.length > 0 ? scheduledPosts[0] : null;
    
    const responseData = {
      queueCount: scheduledPosts.length,
      nextPost: nextPost ? {
        platform: nextPost.platform,
        scheduledTime: nextPost.scheduledTime,
        caption: nextPost.caption.substring(0, 100) + '...'
      } : null,
      isActive: scheduledPosts.length > 0,
      posts: scheduledPosts.slice(0, 10).map(post => ({
        id: post._id,
        platform: post.platform,
        scheduledFor: post.scheduledTime,
        caption: post.caption.substring(0, 100) + '...',
        engagement: post.engagement,
        source: post.source
      })),
      recentlyPosted: completedPosts.map(post => ({
        id: post._id,
        platform: post.platform,
        postedAt: post.postedAt,
        caption: post.caption.substring(0, 100) + '...',
        engagement: post.engagement
      }))
    };
    
    console.log('📊 [SCHEDULER STATUS] Enhanced status retrieved');
    res.json(responseData);
    
  } catch (error) {
    console.error('❌ [SCHEDULER STATUS ERROR]', error);
    res.status(500).json({
      error: 'Failed to get scheduler status',
      message: error.message
    });
  }
});

// Analytics services (with error handling for Render deployment)
let instagramAnalytics, youtubeAnalytics;
try {
  instagramAnalytics = require('./services/instagramAnalytics');
  console.log('✅ Instagram analytics service loaded');
} catch (error) {
  console.log('⚠️ Instagram analytics service failed to load:', error.message);
  instagramAnalytics = null;
}

try {
  youtubeAnalytics = require('./services/youtubeAnalytics');
  console.log('✅ YouTube analytics service loaded');
} catch (error) {
  console.log('⚠️ YouTube analytics service failed to load:', error.message);
  youtubeAnalytics = null;
}

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
      instagramAnalytics ? instagramAnalytics.getInstagramAnalytics(SettingsModel) : Promise.resolve({ followers: 0, reach: 0, engagementRate: 0 }),
      youtubeAnalytics ? youtubeAnalytics.getYouTubeAnalytics(SettingsModel) : Promise.resolve({ subscribers: 0, reach: 0 })
    ]);

    res.json({
      instagram: {
        followers: igData.status === 'fulfilled' ? igData.value.followers : 0,
        following: igData.status === 'fulfilled' ? igData.value.following : 0,
        posts: igData.status === 'fulfilled' ? igData.value.posts : 0,
        reach: igData.status === 'fulfilled' ? igData.value.reach : 0,
        engagement: igData.status === 'fulfilled' ? igData.value.engagement : 0,
        engagementRate: igData.status === 'fulfilled' ? igData.value.engagement : 0, // Use engagement as engagementRate
        avgLikes: igData.status === 'fulfilled' ? igData.value.avgLikes : 0,
        growthRate: igData.status === 'fulfilled' ? igData.value.growthRate : 0,
        isPosting: igData.status === 'fulfilled' ? igData.value.isPosting : false,
        autopilotEnabled: settings.autopilotEnabled || false
      },
      youtube: {
        subscribers: ytData.status === 'fulfilled' ? ytData.value.subscribers : 0,
        views: ytData.status === 'fulfilled' ? ytData.value.views : 0,
        videos: ytData.status === 'fulfilled' ? ytData.value.videos : 0,
        engagement: ytData.status === 'fulfilled' ? ytData.value.engagement : 0,
        avgViews: ytData.status === 'fulfilled' ? ytData.value.avgViews : 0,
        growthRate: ytData.status === 'fulfilled' ? ytData.value.growthRate : 0,
        watchTime: ytData.status === 'fulfilled' ? ytData.value.views : 0, // Using views as watchTime proxy
        isPosting: ytData.status === 'fulfilled' ? ytData.value.isPosting : false,
        channelTitle: ytData.status === 'fulfilled' ? ytData.value.channelTitle : '',
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

// Health check endpoint for keep-alive and monitoring
app.get('/health', (req, res) => {
  const uptime = process.uptime();
  const timestamp = new Date().toISOString();
  
  res.json({
    status: 'healthy',
    uptime: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
    timestamp,
    memory: process.memoryUsage(),
    pid: process.pid,
    service: 'backend-v2-clean'
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