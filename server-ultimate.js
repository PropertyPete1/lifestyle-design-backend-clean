// 🚨 ULTIMATE RENDER CACHE BYPASS SERVER 🚨
// This is the FINAL solution to bypass Render's aggressive caching

console.log('🚨 ULTIMATE CACHE BYPASS STARTING...');
console.log('🚨 Node version:', process.version);
console.log('🚨 Working directory:', process.cwd());
console.log('🚨 Available files:', require('fs').readdirSync('.'));

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(express.json());

// Root endpoint
app.get('/', (req, res) => {
  res.send('🚨 ULTIMATE CACHE BYPASS SUCCESS: Backend is running!');
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    message: 'Ultimate cache bypass health check successful',
    timestamp: new Date().toISOString(),
    node_version: process.version,
    working_directory: process.cwd()
  });
});

// Test connection endpoint for frontend
app.get('/api/test-connection', (req, res) => {
  res.status(200).json({
    message: 'Backend connection successful',
    server: 'Ultimate Cache Bypass Server',
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚨 ULTIMATE CACHE BYPASS SERVER running on port ${PORT}`);
  console.log(`🚨 Server accessible at http://localhost:${PORT}`);
});