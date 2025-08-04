/**
 * Backend v2 Server - Simplified version using only Mongoose
 */

require('dotenv/config');
const express = require('express');
// const cors = require('cors'); // Not needed - using manual CORS headers
const mongoose = require('mongoose');
const Settings = require('./src/models/settings.js');
const settingsRoutes = require('./src/routes/settings');

const app = express();
const PORT = process.env.PORT || 3002;

// ✅ EXPANDED CORS CONFIG FOR ALL VERCEL DEPLOYMENTS
const allowedOrigins = [
  'https://lifestyle-design-frontend-v2.vercel.app',
  'https://lifestyle-design-social.vercel.app', 
  'https://frontend-v2-sage.vercel.app',
  'https://peter-allens-projects.vercel.app',
  'http://localhost:3000'
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  // Allow if no origin (Postman/curl) or if origin is in allowed list or contains vercel.app
  if (!origin || allowedOrigins.includes(origin) || (origin && origin.includes('vercel.app'))) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ✅ Register settings routes
app.use('/api', settingsRoutes);
console.log('✅ /api/settings route registered');

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

// Autopilot Queue schema (using Mongoose instead of native MongoDB)
const autopilotQueueSchema = new mongoose.Schema({
  filename: {
    type: String,
    required: true
  },
  caption: String,
  platform: {
    type: String,
    enum: ['instagram', 'youtube'],
    default: 'instagram'
  },
  scheduledAt: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  },
  insertedAt: {
    type: Date,
    default: Date.now
  }
});

const AutopilotQueue = mongoose.model('AutopilotQueue', autopilotQueueSchema);

// Handle CORS preflight for settings
app.options('/api/settings', (req, res) => {
  console.log('⚙️  [SETTINGS] OPTIONS preflight request received');
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

// Settings endpoints - PHASE 9F CLEAN IMPLEMENTATION
app.get('/api/settings', async (req, res) => {
  try {
    console.log('⚙️  [SETTINGS] GET request received');
    const data = await Settings.findOne().sort({ updatedAt: -1 }).lean();
    console.log('⚙️  [SETTINGS] Retrieved:', data);
    res.json(data || {});
  } catch (err) {
    console.error('[SETTINGS GET ERROR]', err);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    console.log('⚙️  [SETTINGS] POST request received');
    console.log('⚙️  [SETTINGS] Request body:', JSON.stringify(req.body, null, 2));
    
    await Settings.deleteMany(); // clear existing to avoid confusion
    const newSettings = new Settings(req.body);
    await newSettings.save();
    
    console.log('⚙️  [SETTINGS] Settings saved successfully');
    res.json({ success: true });
  } catch (err) {
    console.error('[SETTINGS POST ERROR]', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Chart status endpoint
app.get('/api/chart/status', async (req, res) => {
  try {
    // Mock chart data for dashboard
    const chartData = {
      instagram: {
        volume: Math.floor(Math.random() * 10) + 1,
        speed: (Math.random() * 3 + 1).toFixed(1) + 's',
        thickness: (Math.random() * 2 + 2).toFixed(1) + 'px',
        posts: Math.floor(Math.random() * 50) + 10
      },
      youtube: {
        volume: Math.floor(Math.random() * 8) + 1,
        speed: (Math.random() * 4 + 2).toFixed(1) + 's', 
        thickness: (Math.random() * 2 + 1.5).toFixed(1) + 'px',
        posts: Math.floor(Math.random() * 30) + 5
      }
    };
    res.json(chartData);
  } catch (err) {
    console.error('[CHART STATUS ERROR]', err);
    res.status(500).json({ error: 'Failed to get chart status' });
  }
});

// Activity feed endpoint
app.get('/api/activity/feed', async (req, res) => {
  try {
    const { platform, limit = 20 } = req.query;
    
    // Mock activity data
    const activities = [];
    const platforms = platform ? [platform] : ['instagram', 'youtube'];
    const limitNum = parseInt(limit);
    
    for (let i = 0; i < Math.min(limitNum, 10); i++) {
      const randomPlatform = platforms[Math.floor(Math.random() * platforms.length)];
      activities.push({
        id: `activity_${Date.now()}_${i}`,
        platform: randomPlatform,
        type: 'post',
        caption: `Sample ${randomPlatform} post ${i + 1}`,
        timestamp: new Date(Date.now() - (i * 3600000)).toISOString(),
        status: 'completed'
      });
    }
    
    res.json({ success: true, activities });
  } catch (err) {
    console.error('[ACTIVITY FEED ERROR]', err);
    res.status(500).json({ error: 'Failed to get activity feed' });
  }
});

// Autopilot activity endpoint  
app.get('/api/autopilot/activity', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    // Get recent activities from MongoDB
    const activities = await AutopilotQueue.find({})
      .sort({ insertedAt: -1 })
      .limit(parseInt(limit))
      .exec();
    
    res.json({ success: true, activities });
  } catch (err) {
    console.error('[AUTOPILOT ACTIVITY ERROR]', err);
    res.status(500).json({ error: 'Failed to get autopilot activity' });
  }
});

// Instagram analytics endpoint
app.get('/api/instagram/analytics', async (req, res) => {
  try {
    // Mock Instagram analytics data
    const analytics = {
      followers: Math.floor(Math.random() * 10000) + 1000,
      posts: Math.floor(Math.random() * 100) + 20,
      engagement: (Math.random() * 5 + 1).toFixed(2) + '%',
      reach: Math.floor(Math.random() * 50000) + 5000
    };
    res.json({ success: true, analytics });
  } catch (err) {
    console.error('[INSTAGRAM ANALYTICS ERROR]', err);
    res.status(500).json({ error: 'Failed to get Instagram analytics' });
  }
});

// YouTube analytics endpoint
app.get('/api/youtube/analytics', async (req, res) => {
  try {
    // Mock YouTube analytics data  
    const analytics = {
      subscribers: Math.floor(Math.random() * 5000) + 500,
      videos: Math.floor(Math.random() * 50) + 10,
      views: Math.floor(Math.random() * 100000) + 10000,
      watchTime: Math.floor(Math.random() * 1000) + 100 + ' hours'
    };
    res.json({ success: true, analytics });
  } catch (err) {
    console.error('[YOUTUBE ANALYTICS ERROR]', err);
    res.status(500).json({ error: 'Failed to get YouTube analytics' });
  }
});

// Events endpoint for real-time updates
app.get('/api/events/recent', async (req, res) => {
  try {
    const { since } = req.query;
    
    // Mock events data
    const events = [
      {
        id: Date.now(),
        type: 'post_completed',
        platform: 'instagram',
        message: 'Post published successfully',
        timestamp: new Date().toISOString()
      }
    ];
    
    res.json({ success: true, events });
  } catch (err) {
    console.error('[EVENTS ERROR]', err);
    res.status(500).json({ error: 'Failed to get events' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'backend-v2',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
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

    // Create queue entry using Mongoose
    const queueEntry = new AutopilotQueue({
      filename,
      caption: caption || '',
      platform: platform || 'instagram',
      scheduledAt,
      status: 'pending'
    });
    
    const savedEntry = await queueEntry.save();
    console.log('📦 [QUEUE INSERT] Entry added to autopilot_queue:', savedEntry._id);
    
    // Also log to ActivityLog
    const activityEntry = new ActivityLog({
      platform: platform || 'instagram',
      type: 'schedule',
      status: 'pending',
      message: '✅ Video successfully queued via runNowToQueue',
      caption: caption || '',
      scheduledAt,
      metadata: {
        queueId: savedEntry._id,
        filename,
        scheduledBy: 'runNowToQueue'
      }
    });
    
    await activityEntry.save();
    console.log('✅ [RUN NOW TO QUEUE] Video queued successfully!');

    res.status(200).json({ 
      message: '✅ Video added to Smart Queue', 
      scheduledAt,
      queueId: savedEntry._id,
      success: true
    });
    
  } catch (err) {
    console.error('[RunNowToQueue ERROR]', err);
    res.status(500).json({ 
      error: 'Failed to queue video', 
      success: false,
      details: err.message
    });
  }
});

// GET /api/scheduler/status endpoint
app.get('/api/scheduler/status', async (req, res) => {
  try {
    console.log('📊 [SCHEDULER STATUS] Fetching queue status...');
    
    // Get all pending posts using Mongoose
    const queuedPosts = await AutopilotQueue.find({
      status: 'pending'
    }).sort({ scheduledAt: 1 }).exec();
    
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
    
    console.log('📊 [SCHEDULER STATUS] Status retrieved:', responseData);
    res.status(200).json(responseData);
    
  } catch (err) {
    console.error('[SCHEDULER STATUS ERROR]', err);
    res.status(500).json({ 
      error: 'Failed to get scheduler status',
      nextOptimalTime: null,
      totalQueued: 0,
      queuedVideos: [],
      details: err.message
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
    console.log('   GET  /api/settings - Get settings');
    console.log('   POST /api/settings - Save settings');
    console.log('   POST /api/autopost/run-now - Queue video for posting');
    console.log('   GET  /api/scheduler/status - Get queue status');
    console.log('   GET  /api/chart/status - Chart data for dashboard');
    console.log('   GET  /api/activity/feed - Activity feed');
    console.log('   GET  /api/autopilot/activity - Autopilot activity');
    console.log('   GET  /api/instagram/analytics - Instagram analytics');
    console.log('   GET  /api/youtube/analytics - YouTube analytics');
    console.log('   GET  /api/events/recent - Real-time events');
  });
};

startServer().catch(console.error);