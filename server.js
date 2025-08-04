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

// CORS configuration
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001', 
    'https://frontend-v2-sage.vercel.app',
    'https://lifestyle-design-social.vercel.app'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ✅ SETTINGS ROUTES FOR FRONTEND SAVE/LOAD
const Settings = require('./src/models/settings.js');
const settingsRoute = require('./src/routes/settingsRoute.js');

// ✅ CRITICAL LINE - REGISTER SETTINGS ROUTER
app.use('/api/settings', settingsRoute);
console.log('✅ Settings router registered at /api/settings in server.js');

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