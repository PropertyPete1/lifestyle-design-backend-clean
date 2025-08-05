// 💥 CLEAN RENDER FIX: Simple Express Server
// This is the main entry point for Render deployment

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3002;

console.log('🚀 [SERVER] Starting clean Express server...');
console.log('🚀 [SERVER] Node version:', process.version);
console.log('🚀 [SERVER] Working directory:', process.cwd());

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://lifestyle-design-frontend-clean.vercel.app',
    /\.vercel\.app$/
  ],
  credentials: true
}));
app.use(express.json());

// Basic routes
app.get('/', (req, res) => {
  res.send('✅ Lifestyle Design Backend v2 - Clean Express Server Running!');
});

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    message: 'Clean server health check successful',
    timestamp: new Date().toISOString(),
    node_version: process.version
  });
});

app.get('/api/test-connection', (req, res) => {
  res.status(200).json({
    message: 'Backend connection successful',
    server: 'Clean Express Server',
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ [SERVER] Clean Express server running on port ${PORT}`);
  console.log(`✅ [SERVER] Health check: http://localhost:${PORT}/health`);
});

module.exports = app;