/**
 * Backend v2 Server - JavaScript Version for Production
 * Main entry point for the Lifestyle Design Auto Poster backend
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3002;

// CORS configuration for frontend-v2 - Updated for Render deployment
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001', 
    'https://frontend-v2-sage.vercel.app',
    'https://lifestyle-design-social.vercel.app',
    'https://lifestyle-design-frontend-clean.vercel.app',
    'https://lifestyle-design-frontend-v2.vercel.app',
    'https://lifestyle-design-auto-poster.vercel.app',
    // Allow all Vercel deployments for development
    /https:\/\/.*\.vercel\.app$/,
    // Development CORS - allow all for testing (remove in production)
    process.env.NODE_ENV === 'development' ? '*' : null
  ].filter(Boolean),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'backend-v2',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    environment: process.env.NODE_ENV || 'development',
    cors: {
      allowed: 'Vercel apps + localhost',
      origin: req.headers.origin || 'no-origin'
    }
  });
});

// CORS debug middleware
app.use((req, res, next) => {
  console.log(`🌐 [CORS] ${req.method} ${req.path} from origin: ${req.headers.origin || 'no-origin'}`);
  next();
});

// Test connection endpoint for frontend debugging
app.get('/api/test-connection', (req, res) => {
  res.json({
    success: true,
    message: 'Backend connection successful!',
    timestamp: new Date().toISOString(),
    origin: req.headers.origin || 'no-origin',
    userAgent: req.headers['user-agent'] || 'no-user-agent',
    method: req.method,
    url: req.url,
    backend: 'lifestyle-design-backend-v2',
    version: '2.0.0'
  });
});

// Routes - Import the compiled JavaScript versions
try {
  const settingsRoute = require('./routes/settings');
  app.use('/api/settings', settingsRoute);
  console.log('✅ Settings routes registered in server.js');
} catch (error) {
  console.log('⚠️ Settings routes not found, using basic endpoint');
  // Basic settings endpoint
  app.get('/api/settings', (req, res) => {
    res.json({ message: 'Settings endpoint active', status: 'ok' });
  });
}

try {
  const analyticsRoutes = require('./src/routes/api/analytics');
  app.use('/api/analytics', analyticsRoutes);
  console.log('✅ Analytics routes registered in server.js');
} catch (error) {
  console.log('⚠️ Analytics routes not found, using basic endpoint');
  // Basic analytics endpoint
  app.get('/api/analytics', (req, res) => {
    res.json({ 
      success: true,
      instagram: { followers: 0, reach: 0, engagementRate: 0, autopilotEnabled: false },
      youtube: { subscribers: 0, reach: 0, autopilotEnabled: false },
      upcomingPosts: [],
      credentials: {},
      timestamp: new Date().toISOString()
    });
  });
}

try {
  const apiRoutes = require('./src/routes/index');
  app.use('/api', apiRoutes);
  console.log('✅ AutoPilot routes registered in server.js');
} catch (error) {
  console.log('⚠️ AutoPilot routes not found');
}

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
    console.log('   GET  /api/test-connection - Connection test');
    console.log('   GET  /api/settings - Load settings');
    console.log('   POST /api/settings - Save settings');
    console.log('   GET  /api/analytics - Analytics data');
    console.log('   ✅ Server is ready and operational!');
  });
};

startServer().catch(error => {
  console.error('❌ [SERVER] Failed to start:', error);
  process.exit(1);
});