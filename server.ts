/**
 * Backend v2 Server - Clean AutoPilot System
 * Main entry point for the Lifestyle Design Auto Poster backend
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import apiRoutes from './src/routes/index';
import settingsRoute from './routes/settings';
import analyticsRoutes from './src/routes/api/analytics';

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
app.get('/health', (req: express.Request, res: express.Response) => {
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
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.log(`🌐 [CORS] ${req.method} ${req.path} from origin: ${req.headers.origin || 'no-origin'}`);
  next();
});

// Test connection endpoint for frontend debugging
app.get('/api/test-connection', (req: express.Request, res: express.Response) => {
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

// Routes
app.use('/api', apiRoutes);
app.use('/api/settings', settingsRoute);
app.use('/api/analytics', analyticsRoutes);

// 404 handler
app.use('*', (req: express.Request, res: express.Response) => {
  res.status(404).json({
    error: 'Endpoint not found',
    service: 'backend-v2',
    path: req.originalUrl
  });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
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
    console.log('   GET  /api/settings - Load settings (ROUTER)');
    console.log('   POST /api/settings - Save settings (ROUTER)');
    console.log('   POST /api/autopost/run-now - Queue video for posting');
    console.log('   GET  /api/scheduler/status - Get queue status');
    console.log('   POST /api/autopilot/run - Process queued videos');
    console.log('   POST /api/autopilot/run-batch - Process multiple videos');
  });
};

startServer().catch(console.error);
startServer().catch(console.error);