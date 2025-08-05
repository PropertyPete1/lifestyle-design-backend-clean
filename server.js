/**
 * Backend v2 Server - JavaScript version for Render deployment
 * Fallback server to avoid TypeScript compilation issues
 */

require('dotenv/config');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3002;

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

// ✅ SETTINGS MODEL - COMPLETE SCHEMA FOR FRONTEND
const settingsSchema = new mongoose.Schema({
  // Instagram API
  instagramToken: String,
  igBusinessId: String,
  
  // YouTube API
  youtubeClientId: String,
  youtubeClientSecret: String,
  youtubeAccessToken: String,
  youtubeRefreshToken: String,
  
  // AWS S3
  s3AccessKey: String,
  s3SecretKey: String,
  s3BucketName: String,
  
  // Database
  mongoURI: String,
  
  // AI Services
  openaiApiKey: String,
  
  // Cloud Storage
  dropboxToken: String,
  
  // Video Generation
  runwayApiKey: String,
  
  // AutoPilot Settings
  maxPosts: { type: Number, default: 4 },
  autopilotEnabled: { type: Boolean, default: false },
  cartoonMode: { type: Boolean, default: false },
  schedulerType: { type: String, default: 'daily' },
}, { 
  timestamps: true,
  collection: 'SettingsClean' // Clean collection name
});

const Settings = mongoose.model('Settings', settingsSchema);

app.get('/api/settings', async (req, res) => {
  try {
    console.log('⚙️ [SETTINGS] GET /api/settings request received');
    const settings = await Settings.findOne();
    console.log('⚙️ [SETTINGS] Retrieved settings:', settings);
    res.json(settings || {});
  } catch (err) {
    console.error('❌ [SETTINGS] GET error:', err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    console.log('⚙️ [SETTINGS] POST /api/settings request received');
    console.log('⚙️ [SETTINGS] Request body:', JSON.stringify(req.body, null, 2));
    
    const existing = await Settings.findOne();
    if (existing) {
      await Settings.updateOne({}, req.body);
      console.log('⚙️ [SETTINGS] Settings updated successfully');
    } else {
      const newSettings = new Settings(req.body);
      await newSettings.save();
      console.log('⚙️ [SETTINGS] Settings created successfully');
    }
    res.json({ success: true });
  } catch (err) {
    console.error('❌ [SETTINGS] POST error:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

console.log('✅ Settings routes registered in server.js');

// Analytics services
const { getInstagramAnalytics } = require('./services/instagramAnalytics');
const { getYouTubeAnalytics } = require('./services/youtubeAnalytics');

// Dashboard analytics endpoint - combines both platforms
app.get('/api/dashboard/analytics', async (req, res) => {
  try {
    console.log('📊 [DASHBOARD ANALYTICS] Fetching combined analytics...');
    
    // Get analytics from both platforms in parallel
    const [instagramData, youtubeData] = await Promise.all([
      getInstagramAnalytics(),
      getYouTubeAnalytics()
    ]);
    
    const response = {
      instagram: {
        followers: instagramData.followers,
        engagement: instagramData.engagement,
        posts: instagramData.posts,
        growthRate: instagramData.growthRate,
        isPosting: instagramData.isPosting,
        error: instagramData.error
      },
      youtube: {
        subscribers: youtubeData.subscribers,
        views: youtubeData.views,
        videos: youtubeData.videos,
        growthRate: youtubeData.growthRate,
        isPosting: youtubeData.isPosting,
        error: youtubeData.error
      },
      lastUpdated: new Date().toISOString()
    };
    
    console.log('✅ [DASHBOARD ANALYTICS] Combined data:', response);
    res.json(response);
    
  } catch (error) {
    console.error('❌ [DASHBOARD ANALYTICS ERROR]', error);
    res.status(500).json({ 
      error: 'Failed to fetch analytics',
      instagram: { followers: 0, growthRate: 0, isPosting: false },
      youtube: { subscribers: 0, growthRate: 0, isPosting: false }
    });
  }
});

// Individual platform endpoints
app.get('/api/instagram/analytics', async (req, res) => {
  try {
    const data = await getInstagramAnalytics();
    res.json(data);
  } catch (error) {
    console.error('❌ [INSTAGRAM ANALYTICS ERROR]', error);
    res.status(500).json({ error: 'Failed to fetch Instagram analytics' });
  }
});

app.get('/api/youtube/analytics', async (req, res) => {
  try {
    const data = await getYouTubeAnalytics();
    res.json(data);
  } catch (error) {
    console.error('❌ [YOUTUBE ANALYTICS ERROR]', error);
    res.status(500).json({ error: 'Failed to fetch YouTube analytics' });
  }
});

// Chart data endpoint for dashboard graphs
app.get('/api/chart/status', async (req, res) => {
  try {
    console.log('📈 [CHART DATA] Fetching chart data...');
    
    // Get current analytics data
    const [instagramData, youtubeData] = await Promise.all([
      getInstagramAnalytics(),
      getYouTubeAnalytics()
    ]);
    
    // Generate sample chart data points (in real app, this would come from historical data)
    const generateChartData = (baseValue, variance = 0.1) => {
      const points = [];
      const now = new Date();
      
      for (let i = 23; i >= 0; i--) {
        const timestamp = new Date(now.getTime() - i * 60 * 60 * 1000); // Last 24 hours
        const variation = (Math.random() - 0.5) * variance * baseValue;
        points.push({
          timestamp: timestamp.toISOString(),
          value: Math.max(0, Math.round(baseValue + variation))
        });
      }
      return points;
    };
    
    const chartData = {
      instagram: {
        engagement: generateChartData(instagramData.engagement || 50, 0.2),
        followers: generateChartData(instagramData.followers || 1000, 0.05),
        isActive: instagramData.isPosting
      },
      youtube: {
        engagement: generateChartData(youtubeData.engagement || 30, 0.3),
        subscribers: generateChartData(youtubeData.subscribers || 500, 0.03),
        isActive: youtubeData.isPosting
      },
      lastUpdated: new Date().toISOString()
    };
    
    console.log('✅ [CHART DATA] Generated chart data');
    res.json(chartData);
    
  } catch (error) {
    console.error('❌ [CHART DATA ERROR]', error);
    res.status(500).json({ 
      error: 'Failed to fetch chart data',
      instagram: { engagement: [], followers: [], isActive: false },
      youtube: { engagement: [], subscribers: [], isActive: false }
    });
  }
});

console.log('✅ Analytics routes registered in server.js');

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

// Simple ActivityLog schema
const activityLogSchema = new mongoose.Schema({
  platform: {
    type: String,
    enum: ['instagram', 'youtube', 'system'],
    required: true
  },
  type: {
    type: String,
    enum: ['post', 'error', 'protection', 'system', 'emergency_shutdown', 'schedule'],
    required: true
  },
  status: {
    type: String,
    enum: ['success', 'failed', 'pending', 'blocked'],
    required: true
  },
  message: String,
  caption: String,
  scheduledAt: {
    type: Date,
    required: false
  },
  metadata: mongoose.Schema.Types.Mixed
}, {
  timestamps: true
});

const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'backend-v2',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Smart scheduler function
const smartScheduler = async () => {
  const now = new Date();
  const scheduledDate = new Date(now);
  scheduledDate.setHours(scheduledDate.getHours() + 2); // Schedule 2 hours from now
  return scheduledDate;
};

// POST /api/autopost/run-now endpoint
app.post('/api/autopost/run-now', async (req, res) => {
  try {
    console.log('🔄 [RUN NOW TO QUEUE] Starting video queue process...');
    
    const { filename, caption, platform } = req.body;
    
    if (!filename) {
      return res.status(400).json({ error: 'filename is required', success: false });
    }
    
    // Use smart scheduler
    const scheduledAt = await smartScheduler();
    console.log('📅 [SMART SCHEDULER] Optimal time calculated:', scheduledAt.toLocaleString());

    // Insert into autopilot_queue collection
    const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/lifestyle-design';
    const client = new MongoClient(mongoUrl);
    
    try {
      await client.connect();
      const db = client.db();
      const queue = db.collection('autopilot_queue');
      
      const queueEntry = {
        filename,
        caption: caption || '',
        platform: platform || 'instagram',
        scheduledAt,
        status: 'pending',
        insertedAt: new Date()
      };
      
      const result = await queue.insertOne(queueEntry);
      console.log('📦 [QUEUE INSERT] Entry added to autopilot_queue:', result.insertedId);
      
      // Also log to ActivityLog
      const activityEntry = new ActivityLog({
        platform: platform || 'instagram',
        type: 'schedule',
        status: 'pending',
        message: '✅ Video successfully queued via runNowToQueue',
        caption: caption || '',
        scheduledAt,
        metadata: {
          queueId: result.insertedId,
          filename,
          scheduledBy: 'runNowToQueue'
        }
      });
      
      await activityEntry.save();
      console.log('✅ [RUN NOW TO QUEUE] Video queued successfully!');

      res.status(200).json({ 
        message: '✅ Video added to Smart Queue', 
        scheduledAt,
        queueId: result.insertedId,
        success: true
      });
      
    } finally {
      await client.close();
    }
    
  } catch (err) {
    console.error('[RunNowToQueue ERROR]', err);
    res.status(500).json({ 
      error: 'Failed to queue video', 
      success: false,
      details: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// GET /api/scheduler/status endpoint
app.get('/api/scheduler/status', async (req, res) => {
  try {
    console.log('📊 [SCHEDULER STATUS] Fetching queue status...');
    
    const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/lifestyle-design';
    const client = new MongoClient(mongoUrl);
    
    try {
      await client.connect();
      const db = client.db();
      const queue = db.collection('autopilot_queue');
      
      // Get all pending posts
      const queuedPosts = await queue.find({
        status: 'pending'
      }).sort({ scheduledAt: 1 }).toArray();
      
      const totalQueued = queuedPosts.length;
      const nextOptimalTime = queuedPosts.length > 0 ? queuedPosts[0].scheduledAt : null;
      
      const queuedVideos = queuedPosts.slice(0, 10).map(post => ({
        filename: post.filename || 'unknown.mp4',
        captionPreview: post.caption ? 
          (post.caption.length > 50 ? post.caption.substring(0, 47) + '...' : post.caption) : 
          'No caption...',
        platform: post.platform || 'instagram',
        scheduledFor: post.scheduledAt
      }));
      
      const responseData = {
        nextOptimalTime,
        totalQueued,
        queuedVideos
      };
      
      res.status(200).json(responseData);
      
    } finally {
      await client.close();
    }
    
  } catch (err) {
    console.error('[SCHEDULER STATUS ERROR]', err);
    res.status(500).json({ 
      error: 'Failed to get scheduler status',
      nextOptimalTime: null,
      totalQueued: 0,
      queuedVideos: [],
      details: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
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
    console.log('   GET  /api/health - Health check');
    console.log('   ✅ GET  /api/settings - Get settings');
    console.log('   ✅ POST /api/settings - Save settings');
    console.log('   POST /api/autopost/run-now - Queue video for posting');
    console.log('   GET  /api/scheduler/status - Get queue status');
  });
};

startServer().catch(console.error);