// Keep Render service alive by pinging it every 10 minutes
const fetch = require('node-fetch');

const BACKEND_URL = 'https://lifestyle-design-backend-v2-clean.onrender.com/api/analytics';
const PING_INTERVAL = 10 * 60 * 1000; // 10 minutes

function keepAlive() {
  console.log('🏓 [KEEP-ALIVE] Pinging backend to prevent sleep...');
  
  fetch(BACKEND_URL)
    .then(response => {
      if (response.ok) {
        console.log('✅ [KEEP-ALIVE] Backend is awake');
      } else {
        console.log('⚠️ [KEEP-ALIVE] Backend responded with:', response.status);
      }
    })
    .catch(error => {
      console.log('❌ [KEEP-ALIVE] Ping failed:', error.message);
    });
}

// Only run keep-alive in production
if (process.env.NODE_ENV === 'production') {
  console.log('🚀 [KEEP-ALIVE] Starting keep-alive service...');
  setInterval(keepAlive, PING_INTERVAL);
  
  // Initial ping
  setTimeout(keepAlive, 30000); // Wait 30 seconds before first ping
}

module.exports = { keepAlive };
const fetch = require('node-fetch');

const BACKEND_URL = 'https://lifestyle-design-backend-v2-clean.onrender.com/api/analytics';
const PING_INTERVAL = 10 * 60 * 1000; // 10 minutes

function keepAlive() {
  console.log('🏓 [KEEP-ALIVE] Pinging backend to prevent sleep...');
  
  fetch(BACKEND_URL)
    .then(response => {
      if (response.ok) {
        console.log('✅ [KEEP-ALIVE] Backend is awake');
      } else {
        console.log('⚠️ [KEEP-ALIVE] Backend responded with:', response.status);
      }
    })
    .catch(error => {
      console.log('❌ [KEEP-ALIVE] Ping failed:', error.message);
    });
}

// Only run keep-alive in production
if (process.env.NODE_ENV === 'production') {
  console.log('🚀 [KEEP-ALIVE] Starting keep-alive service...');
  setInterval(keepAlive, PING_INTERVAL);
  
  // Initial ping
  setTimeout(keepAlive, 30000); // Wait 30 seconds before first ping
}

module.exports = { keepAlive };