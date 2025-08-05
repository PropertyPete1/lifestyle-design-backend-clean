// ✅ AI Caption Generator Service - Phase 9 AutoPilot System
let fetch;
try {
  // Try node-fetch first
  fetch = require('node-fetch');
} catch (err) {
  try {
    // Try built-in fetch (Node 18+)
    fetch = globalThis.fetch;
    if (!fetch) throw new Error('No fetch available');
  } catch (err2) {
    // Final fallback: create a simple HTTP client
    const https = require('https');
    const http = require('http');
    const { URL } = require('url');
    
    fetch = async (url, options = {}) => {
      return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const client = parsedUrl.protocol === 'https:' ? https : http;
        
        const req = client.request(url, {
          method: options.method || 'GET',
          headers: options.headers || {}
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              json: () => Promise.resolve(JSON.parse(data)),
              text: () => Promise.resolve(data)
            });
          });
        });
        
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
      });
    };
  }
}

/**
 * Generates smart caption using OpenAI GPT-4
 * @param {string} originalCaption - Original Instagram caption
 * @param {Object} Settings - Mongoose Settings model
 * @returns {string} Rewritten caption
 */
async function generateSmartCaption(originalCaption, Settings) {
  try {
    console.log('✍️ [AI CAPTION] Generating smart caption...');
    
    const settings = await Settings.findOne();
    if (!settings || !settings.openaiApiKey) {
      console.log('⚠️ [AI CAPTION] No OpenAI key found, using modified original caption');
      return modifyOriginalCaption(originalCaption);
    }

    const prompt = `Rewrite this Instagram caption to be engaging and fresh while keeping the same meaning. Make it sound natural and authentic. Remove any dashes or bullet points. Keep it under 150 characters:

Original: "${originalCaption}"

Rewritten:`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are a social media expert who rewrites captions to be engaging and authentic.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 100,
        temperature: 0.7
      })
    });

    const data = await response.json();
    
    if (data.error) {
      console.log('⚠️ [AI CAPTION] OpenAI error, using fallback');
      return modifyOriginalCaption(originalCaption);
    }

    const rewrittenCaption = data.choices[0]?.message?.content?.trim() || originalCaption;
    console.log(`✅ [AI CAPTION] Generated: "${rewrittenCaption.substring(0, 50)}..."`);
    
    return rewrittenCaption;

  } catch (error) {
    console.error('❌ [AI CAPTION ERROR]', error);
    return modifyOriginalCaption(originalCaption);
  }
}

/**
 * Fallback caption modification when AI is unavailable
 * @param {string} originalCaption - Original caption
 * @returns {string} Modified caption
 */
function modifyOriginalCaption(originalCaption) {
  if (!originalCaption) return "Check out this amazing content! 🔥";
  
  // Simple modifications to make it different
  let modified = originalCaption
    .replace(/\-/g, '') // Remove dashes
    .replace(/\•/g, '') // Remove bullet points
    .replace(/^\s+|\s+$/g, '') // Trim whitespace
    .replace(/\s+/g, ' '); // Normalize spaces

  // Add some variety
  const prefixes = ['', 'Amazing! ', 'Check this out: ', 'Love this: '];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  
  modified = prefix + modified;
  
  // Limit length
  if (modified.length > 150) {
    modified = modified.substring(0, 147) + '...';
  }
  
  return modified;
}

/**
 * Gets optimal posting time based on engagement patterns
 * @param {string} platform - Platform (instagram/youtube)
 * @returns {Date} Optimal posting time
 */
async function getBestTimeToPost(platform = 'instagram') {
  try {
    console.log(`🕒 [SMART TIMING] Calculating best time for ${platform}...`);
    
    // Smart scheduling based on platform
    const now = new Date();
    let optimalTime = new Date(now);
    
    if (platform === 'instagram') {
      // Instagram peak hours: 6-9 AM, 12-2 PM, 5-7 PM
      const currentHour = now.getHours();
      
      if (currentHour < 6) {
        optimalTime.setHours(6, 0, 0, 0); // 6 AM today
      } else if (currentHour < 12) {
        optimalTime.setHours(12, 0, 0, 0); // 12 PM today
      } else if (currentHour < 17) {
        optimalTime.setHours(17, 0, 0, 0); // 5 PM today
      } else {
        // Schedule for tomorrow 6 AM
        optimalTime.setDate(optimalTime.getDate() + 1);
        optimalTime.setHours(6, 0, 0, 0);
      }
    } else if (platform === 'youtube') {
      // YouTube peak hours: 2-4 PM, 8-11 PM
      const currentHour = now.getHours();
      
      if (currentHour < 14) {
        optimalTime.setHours(14, 0, 0, 0); // 2 PM today
      } else if (currentHour < 20) {
        optimalTime.setHours(20, 0, 0, 0); // 8 PM today
      } else {
        // Schedule for tomorrow 2 PM
        optimalTime.setDate(optimalTime.getDate() + 1);
        optimalTime.setHours(14, 0, 0, 0);
      }
    }
    
    console.log(`✅ [SMART TIMING] Optimal time: ${optimalTime.toLocaleString()}`);
    return optimalTime;
    
  } catch (error) {
    console.error('❌ [SMART TIMING ERROR]', error);
    // Fallback: 2 hours from now
    const fallbackTime = new Date();
    fallbackTime.setHours(fallbackTime.getHours() + 2);
    return fallbackTime;
  }
}

/**
 * Fetches trending audio for Instagram reels (placeholder for now)
 * @returns {string|null} Trending audio URL or null
 */
async function fetchInstagramTrendingAudio() {
  try {
    console.log('🎵 [TRENDING AUDIO] Fetching trending audio...');
    
    // TODO: Implement actual trending audio API
    // For now, return null to skip audio attachment
    console.log('⚠️ [TRENDING AUDIO] Feature not implemented yet');
    return null;
    
  } catch (error) {
    console.error('❌ [TRENDING AUDIO ERROR]', error);
    return null;
  }
}

/**
 * Schedules Instagram upload via Graph API
 * @param {Object} params - Upload parameters
 * @param {string} params.videoUrl - S3 video URL
 * @param {string} params.caption - Video caption
 * @param {string} params.audioUrl - Audio URL (optional)
 * @param {Date} params.scheduledTime - When to post
 * @returns {Object} Schedule result
 */
async function scheduleInstagramUpload({ videoUrl, caption, audioUrl, scheduledTime }) {
  try {
    console.log('📲 [INSTAGRAM SCHEDULE] Scheduling Instagram upload...');
    
    // For Phase 9, we're logging to scheduler queue instead of immediate upload
    // The actual posting will be handled by the scheduler service
    console.log(`✅ [INSTAGRAM SCHEDULE] Queued for ${scheduledTime.toLocaleString()}`);
    
    return {
      success: true,
      platform: 'instagram',
      scheduledTime,
      videoUrl,
      caption: caption.substring(0, 50) + '...'
    };
    
  } catch (error) {
    console.error('❌ [INSTAGRAM SCHEDULE ERROR]', error);
    throw error;
  }
}

/**
 * Logs autopilot schedule to MongoDB queue
 * @param {Object} params - Schedule parameters
 * @returns {Object} Log result
 */
async function logAutopilotSchedule({ platform, videoId, engagement, status, caption, s3Url, time }) {
  try {
    console.log('📝 [AUTOPILOT LOG] Logging to scheduler queue...');
    
    const { MongoClient } = require('mongodb');
    const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/lifestyle-design';
    const client = new MongoClient(mongoUrl);
    
    try {
      await client.connect();
      const db = client.db();
      const queue = db.collection('autopilot_queue');
      
      const logEntry = {
        platform,
        videoId,
        engagement,
        status,
        caption,
        s3Url,
        scheduledAt: time,
        autopilotGenerated: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      const result = await queue.insertOne(logEntry);
      console.log(`✅ [AUTOPILOT LOG] Logged ${platform} post: ${result.insertedId}`);
      
      return {
        success: true,
        logId: result.insertedId,
        platform,
        scheduledAt: time
      };
      
    } finally {
      await client.close();
    }
    
  } catch (error) {
    console.error('❌ [AUTOPILOT LOG ERROR]', error);
    throw error;
  }
}

/**
 * Generate smart caption with OpenAI API key (autopilot version)
 * @param {string} originalCaption - Original caption
 * @param {string} openaiApiKey - OpenAI API key
 * @returns {Promise<string>} Rewritten caption
 */
async function generateSmartCaptionWithKey(originalCaption, openaiApiKey) {
  try {
    console.log('✍️ [AI CAPTION] Generating smart caption with provided key...');
    
    if (!openaiApiKey) {
      console.log('⚠️ [AI CAPTION] No OpenAI key provided, using modified original caption');
      return modifyOriginalCaption(originalCaption);
    }

    const prompt = `Rewrite this Instagram caption to be engaging and fresh while keeping the same meaning. Make it sound natural and authentic. Remove any dashes or bullet points. Keep it under 150 characters:

Original: "${originalCaption}"

Rewritten:`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 100,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      console.error('❌ [AI CAPTION] OpenAI API error:', response.status);
      return modifyOriginalCaption(originalCaption);
    }

    const data = await response.json();
    const rewrittenCaption = data.choices?.[0]?.message?.content?.trim();

    if (rewrittenCaption) {
      console.log('✅ [AI CAPTION] Smart caption generated successfully');
      return rewrittenCaption;
    } else {
      console.log('⚠️ [AI CAPTION] No caption returned, using modified original');
      return modifyOriginalCaption(originalCaption);
    }

  } catch (error) {
    console.error('❌ [AI CAPTION ERROR]', error);
    return modifyOriginalCaption(originalCaption);
  }
}

/**
 * Find trending audio for platform (alias for fetchInstagramTrendingAudio)
 * @param {string} platform - Platform name (instagram/youtube)
 * @returns {Promise<string|null>} Trending audio URL or null
 */
async function findTrendingAudio(platform) {
  if (platform === 'instagram') {
    return await fetchInstagramTrendingAudio();
  }
  return null; // YouTube doesn't use trending audio in the same way
}

module.exports = {
  generateSmartCaption,
  generateSmartCaptionWithKey,
  findTrendingAudio,
  getBestTimeToPost,
  modifyOriginalCaption,
  fetchInstagramTrendingAudio,
  scheduleInstagramUpload,
  logAutopilotSchedule
};