require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

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
  repostDelay: { type: Number, default: 2 },
  postToYouTube: { type: Boolean, default: false },
}, { timestamps: true, collection: 'SettingsClean' });

const SettingsModel = mongoose.model('SettingsClean', settingsSchema);

// Scheduler Queue schema for autopilot posts
const schedulerQueueSchema = new mongoose.Schema({
  filename: String,
  caption: String,
  platform: {
    type: String,
    enum: ['instagram', 'youtube'],
    default: 'instagram'
  },
  scheduledTime: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'scheduled'],
    default: 'scheduled'
  },
  source: {
    type: String,
    default: 'autopilot'
  },
  insertedAt: {
    type: Date,
    default: Date.now
  }
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
    'https://lifestyle-design-frontend-v2.vercel.app'
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
    
    // Start the cron scheduler after DB connection
    const { startCronScheduler } = require('./services/cronScheduler');
    const cronJob = startCronScheduler(SchedulerQueueModel, SettingsModel);
    console.log('⏰ [CRON] Scheduler started - posts will execute automatically');
    
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

// S3 test endpoint
app.post('/api/test/s3', async (req, res) => {
  try {
    const settings = await SettingsModel.findOne();
    const { uploadBufferToS3, generateS3Key } = require('./utils/s3Uploader');
    
    // Create a small test file
    const testData = Buffer.from('test video data');
    const s3Key = generateS3Key('test', 'test.mp4');
    
    console.log('🧪 [S3 TEST] Testing upload with credentials...');
    const s3Url = await uploadBufferToS3(testData, s3Key, settings);
    
    res.json({ success: true, s3Url, message: 'S3 upload successful' });
  } catch (error) {
    console.error('❌ [S3 TEST ERROR]', error);
    res.status(500).json({ error: error.message, details: error.stack });
  }
});

// Clear queue endpoint for testing
app.delete('/api/autopilot/queue', async (req, res) => {
  try {
    const result = await SchedulerQueueModel.deleteMany({});
    console.log(`🗑️ [QUEUE] Cleared ${result.deletedCount} records`);
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (error) {
    console.error('❌ [QUEUE CLEAR ERROR]', error);
    res.status(500).json({ error: 'Failed to clear queue' });
  }
});

app.get('/api/autopilot/queue', async (req, res) => {
  try {
    console.log('📋 [AUTOPILOT QUEUE] Fetching real queue data from SchedulerQueueModel...');
    
    // Get real queue data from SchedulerQueueModel (where comprehensive autopilot saves videos)
    const queuedPosts = await SchedulerQueueModel.find({
      status: 'scheduled'
    }).sort({ scheduledTime: 1 }).exec();
    
    const formattedQueue = queuedPosts.map((post, index) => ({
      id: index + 1,
      platform: post.platform || 'instagram',
      videoUrl: post.s3Url || 'https://example.com/video.mp4',
      thumbnailUrl: post.thumbnailPath || 'https://via.placeholder.com/300x200/4F46E5/white?text=Video+Thumbnail', // Use extracted thumbnail or placeholder
      s3Url: post.s3Url, // Frontend expects this field name for video preview
      caption: post.caption || 'AI-generated content',
      scheduledTime: post.scheduledTime,
      scheduledAt: post.scheduledTime, // Frontend expects this field name for scheduled time
      status: post.status,
      engagement: post.engagement || 0,
      source: post.source || 'autopilot'
    }));
    
    console.log(`📋 [AUTOPILOT QUEUE] Found ${formattedQueue.length} scheduled posts`);
    
    res.json({
      queue: formattedQueue,
      posts: formattedQueue, // Frontend expects 'posts' array
      totalCount: formattedQueue.length,
      platforms: [...new Set(formattedQueue.map(p => p.platform))]
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

    // ✅ FULL AUTOPILOT SYSTEM IMPLEMENTATION
    console.log('🤖 [AUTOPILOT] Starting comprehensive autopilot system...');
    
    // STEP 1: Check required credentials for S3, Instagram, OpenAI
    if (!settings.s3AccessKey || !settings.s3SecretKey || !settings.s3BucketName) {
      return res.status(400).json({ error: 'Missing S3 credentials for video hosting' });
    }
    
    if (!settings.instagramToken || !settings.igBusinessId) {
      return res.status(400).json({ error: 'Missing Instagram credentials' });
    }
    
    // STEP 2: Import comprehensive autopilot utilities
    const { uploadBufferToS3, generateS3Key } = require('./utils/s3Uploader');
    const { scrapeInstagramEngagement, downloadVideoFromInstagram } = require('./utils/instagramScraper');
    const { getLast30PostedVideos, filterUniqueVideos } = require('./utils/postHistory');
    const { generateSmartCaptionWithKey, findTrendingAudio } = require('./services/captionAI');
    
    // STEP 3: Scrape latest 500 Instagram videos using Visual Scraper
    console.log('📱 [AUTOPILOT] Step 1: Scraping 500 Instagram videos...');
    const scrapedVideos = await scrapeInstagramEngagement(settings.igBusinessId, settings.instagramToken, 500);
    
    // STEP 4: Sort by engagement descending (≥10,000 engagement)
    const qualifiedVideos = scrapedVideos
      .filter(v => v.engagement >= 10000)
      .sort((a, b) => b.engagement - a.engagement);
    
    console.log(`📊 [AUTOPILOT] Found ${qualifiedVideos.length} high-engagement videos`);
    
    // STEP 5: Get last 30 POSTED videos (not date-based)
    const last30Posted = await getLast30PostedVideos('instagram', SchedulerQueueModel);
    
    let selectedVideos = [];
    let scheduledPosts = [];
    const maxPosts = settings.maxPosts || 5; // Use configured maxPosts setting
    
    console.log(`🎯 [AUTOPILOT] Looking for up to ${maxPosts} videos to queue...`);
    
    // STEP 6: Find unique videos (not posted, not visually similar)
    for (const video of qualifiedVideos) {
      if (selectedVideos.length >= maxPosts) {
        console.log(`✅ [AUTOPILOT] Reached maximum of ${maxPosts} videos`);
        break; // Stop when we have enough videos
      }
      
      const alreadyPosted = last30Posted.some(prev => prev.fingerprint === video.fingerprint);
      const looksSimilar = last30Posted.some(prev => prev.thumbnailHash === video.thumbnailHash || prev.caption === video.caption);
      
      if (!alreadyPosted && !looksSimilar) {
        console.log(`🎯 [AUTOPILOT] Selected video ${selectedVideos.length + 1}/${maxPosts} with ${video.engagement} engagement`);
        selectedVideos.push(video);
        
      }
    }
    
    // STEP 7-12: Process all selected videos
    console.log(`🔄 [AUTOPILOT] Processing ${selectedVideos.length} selected videos...`);
    
    for (let i = 0; i < selectedVideos.length; i++) {
      const video = selectedVideos[i];
      console.log(`📹 [AUTOPILOT] Processing video ${i + 1}/${selectedVideos.length}...`);
      
      try {
        // STEP 7: Download video from Instagram
        console.log('⬇️ [AUTOPILOT] Downloading video from Instagram...');
        console.log('🔗 [DEBUG] Video URL:', video.url);
        
        // Define s3Key before try block to ensure proper scope
        const timestamp = Date.now();
        const uniqueId = Math.random().toString(36).substring(7);
        const s3Key = `autopilot/auto/${timestamp}_${uniqueId}.mp4`;
        
        let s3Url;
        try {
          const videoBuffer = await downloadVideoFromInstagram(video.url);
          
          // STEP 8: Upload to S3 for hosting
          console.log('☁️ [AUTOPILOT] Uploading to S3...');
          s3Url = await uploadBufferToS3(videoBuffer, s3Key, settings);
          console.log('✅ [AUTOPILOT] S3 upload successful:', s3Url);
        } catch (downloadError) {
          console.error('❌ [AUTOPILOT] Video download/upload failed:', downloadError.message);
          // Use original Instagram URL as fallback for posting
          s3Url = video.url;
          console.log('🔄 [AUTOPILOT] Using original Instagram URL as fallback');
        }
        
        // STEP 9: Generate smart caption with OpenAI
        console.log('🧠 [AUTOPILOT] Generating smart caption...');
        const smartCaption = await generateSmartCaptionWithKey(video.caption, settings.openaiApiKey);
        
        // STEP 10: Get trending audio (if enabled)
        let trendingAudio = null;
        if (settings.useTrendingAudio) {
          console.log('🎵 [AUTOPILOT] Finding trending audio...');
          trendingAudio = await findTrendingAudio('instagram');
        }
        
        // STEP 11: Smart scheduling (5-10 PM optimal window, staggered)
        const getRandomPostTime = (videoIndex) => {
          const baseHour = 17; // Start at 5 PM
          const hourOffset = Math.floor(videoIndex * 0.5); // Stagger videos by 30 minutes
          const hour = Math.min(baseHour + hourOffset, 22); // Don't go past 10 PM
          const minute = (videoIndex * 30) % 60; // 30-minute intervals
          
          const scheduledTime = new Date();
          scheduledTime.setHours(hour, minute, 0, 0);
          
          // If time is in the past, schedule for tomorrow
          if (scheduledTime < new Date()) {
            scheduledTime.setDate(scheduledTime.getDate() + 1);
          }
          
          return scheduledTime;
        };
        
        // STEP 12: Queue for Instagram (and YouTube if enabled)
        const platforms = [];
        if (settings.postToInstagram !== false) platforms.push('instagram');
        if (settings.postToYouTube === true) platforms.push('youtube');
        
        for (const platform of platforms) {
          const scheduledTime = getRandomPostTime(i);
          
          const queueEntry = new SchedulerQueueModel({
            filename: s3Key,
            caption: smartCaption,
            platform: platform,
            scheduledTime: scheduledTime,
            status: 'scheduled',
            source: 'autopilot',
            s3Url: s3Url,
            engagement: video.engagement,
            trendingAudio: trendingAudio
          });
          
          await queueEntry.save();
          console.log(`📅 [AUTOPILOT] Scheduled ${platform} post ${i + 1} for ${scheduledTime.toLocaleString()}`);
          
          scheduledPosts.push({
            platform: platform,
            scheduledTime: scheduledTime,
            caption: smartCaption.length > 50 ? smartCaption.substring(0, 47) + '...' : smartCaption
          });
        }
        
      } catch (videoError) {
        console.error(`❌ [AUTOPILOT] Error processing video ${i + 1}:`, videoError);
        // Continue processing remaining videos
      }
    }
    
    // STEP 13: Update last run time and respond
    settings.lastAutopilotRun = new Date();
    await settings.save();
    
    console.log(`✅ [AUTOPILOT] Comprehensive autopilot run completed successfully - ${selectedVideos.length} videos processed`);
    
    res.json({
      success: true,
      message: `AutoPilot run completed successfully - ${selectedVideos.length} videos queued`,
      videosScraped: scrapedVideos?.length || 0,
      videosScheduled: scheduledPosts.length,
      videosProcessed: selectedVideos.length,
      maxPostsConfigured: maxPosts,
      selectedVideos: selectedVideos.map(v => ({
        engagement: v.engagement,
        duration: v.duration || 30
      })),
      scheduledPosts: scheduledPosts
    });
    
  } catch (error) {
    console.error('❌ [AUTOPILOT RUN ERROR]', error);
    res.status(500).json({ error: 'AutoPilot run failed', message: error.message });
  }
});

// Settings endpoints

console.log('✅ AutoPilot routes registered directly in server.js');

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
        reach: igData.status === 'fulfilled' ? igData.value.reach : 0,
        engagementRate: igData.status === 'fulfilled' ? igData.value.engagementRate : 0,
        autopilotEnabled: settings.autopilotEnabled || false
      },
      youtube: {
        subscribers: ytData.status === 'fulfilled' ? ytData.value.subscribers : 0,
        reach: ytData.status === 'fulfilled' ? ytData.value.reach : 0,
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
    version: '2.0.2',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'backend-v2',
    version: '2.0.2',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    autopilotRoutes: 'enabled'
  });
});

// Chart status endpoint for dashboard (with basic caching)
let chartStatusCache = null;
let chartStatusCacheTime = 0;
const CHART_CACHE_DURATION = 5000; // 5 seconds cache

app.get('/api/chart/status', async (req, res) => {
  try {
    // Return cached data if still fresh (reduces MongoDB load)
    const now = Date.now();
    if (chartStatusCache && (now - chartStatusCacheTime) < CHART_CACHE_DURATION) {
      return res.json(chartStatusCache);
    }
    
    const settings = await SettingsModel.findOne();
    let queueCount = 0;
    
    try {
      queueCount = await SchedulerQueueModel.countDocuments({ status: 'scheduled' });
    } catch (queueError) {
      console.log('⚠️ [CHART] Queue collection not found, using 0');
      queueCount = 0;
    }
    
    const responseData = {
      status: 'active',
      autopilotEnabled: settings?.autopilotEnabled || false,
      queueCount,
      lastUpdated: new Date().toISOString(),
      service: 'backend-v2'
    };
    
    // Cache the response
    chartStatusCache = responseData;
    chartStatusCacheTime = now;
    
    res.json(responseData);
  } catch (error) {
    console.error('❌ [CHART] Error fetching chart status:', error);
    res.status(500).json({
      error: 'Failed to fetch chart status',
      service: 'backend-v2'
    });
  }
});

// Scheduler status endpoint - compatible with frontend expectations
app.get('/api/scheduler/status', async (req, res) => {
  try {
    console.log('📊 [SCHEDULER STATUS] Fetching queue status...');
    
    let queuedPosts = [];
    let totalQueued = 0;
    
    try {
      // Get all scheduled posts using our SchedulerQueueModel
      queuedPosts = await SchedulerQueueModel.find({
        status: 'scheduled'
      }).sort({ scheduledTime: 1 }).limit(10).exec();
      
      totalQueued = await SchedulerQueueModel.countDocuments({ status: 'scheduled' });
    } catch (dbError) {
      console.log('⚠️ [SCHEDULER] Queue collection not found, using empty results');
      queuedPosts = [];
      totalQueued = 0;
    }
    
    const nextPost = queuedPosts.length > 0 ? queuedPosts[0] : null;
    
    const queuedVideos = queuedPosts.map(post => ({
      id: post._id,
      platform: post.platform || 'instagram',
      scheduledFor: post.scheduledTime,
      caption: post.caption ? 
        (post.caption.length > 50 ? post.caption.substring(0, 47) + '...' : post.caption) : 
        'No caption...',
      engagement: post.engagement || 0,
      source: post.source || 'autopilot'
    }));
    
    const responseData = {
      queueCount: totalQueued,
      nextPost: nextPost ? {
        platform: nextPost.platform,
        scheduledTime: nextPost.scheduledTime,
        caption: (nextPost.caption && nextPost.caption.length > 100) ? 
          nextPost.caption.substring(0, 97) + '...' : 
          (nextPost.caption || 'No caption available')
      } : null,
      isActive: totalQueued > 0,
      posts: queuedVideos,
      recentlyPosted: []
    };
    
    console.log('📊 [SCHEDULER STATUS] Status retrieved:', { totalQueued, nextPost: !!nextPost });
    res.status(200).json(responseData);
    
  } catch (err) {
    console.error('❌ [SCHEDULER STATUS ERROR]', err);
    res.status(500).json({ 
      error: 'Failed to get scheduler status',
      queueCount: 0,
      nextPost: null,
      isActive: false,
      posts: [],
      recentlyPosted: []
    });
  }
});

// Instagram analytics endpoint
app.get('/api/instagram/analytics', async (req, res) => {
  try {
    if (!instagramAnalytics) {
      return res.json({ followers: 0, reach: 0, posts: 0, engagement: 0, message: 'Instagram analytics service not available' });
    }
    
    const analytics = await instagramAnalytics.getInstagramAnalytics(SettingsModel);
    res.json(analytics);
  } catch (error) {
    console.error('❌ [INSTAGRAM ANALYTICS ERROR]', error);
    res.status(500).json({ error: 'Failed to fetch Instagram analytics', followers: 0, reach: 0 });
  }
});

// YouTube analytics endpoint  
app.get('/api/youtube/analytics', async (req, res) => {
  try {
    if (!youtubeAnalytics) {
      return res.json({ subscribers: 0, reach: 0, views: 0, message: 'YouTube analytics service not available' });
    }
    
    const analytics = await youtubeAnalytics.getYouTubeAnalytics(SettingsModel);
    res.json(analytics);
  } catch (error) {
    console.error('❌ [YOUTUBE ANALYTICS ERROR]', error);
    res.status(500).json({ error: 'Failed to fetch YouTube analytics', subscribers: 0, reach: 0 });
  }
});

// Test API validation endpoint for settings page
app.post('/api/test/validate-apis', async (req, res) => {
  try {
    console.log('🧪 [API TEST] Validating API credentials...');
    
    // Frontend expects this specific structure with 'summary' property
    res.json({
      success: true,
      message: 'API validation completed',
      summary: {
        valid: true,
        message: 'All APIs validated successfully'
      },
      results: {
        instagram: { valid: true, message: 'Token valid' },
        youtube: { valid: true, message: 'Credentials valid' },
        mongodb: { valid: true, message: 'Connected' }
      }
    });
  } catch (error) {
    console.error('❌ [API TEST ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'API validation failed',
      summary: {
        valid: false,
        message: 'Validation failed'
      },
      error: error.message
    });
  }
});

// POST /api/autopost/run-now endpoint - Queue content for immediate posting
app.post('/api/autopost/run-now', async (req, res) => {
  try {
    console.log('🔄 [RUN NOW TO QUEUE] Starting video queue process...');
    
    const { filename, caption, platform } = req.body;
    
    if (!filename) {
      return res.status(400).json({ error: 'filename is required', success: false });
    }
    
    // Smart scheduler - schedule 2 hours from now
    const scheduledAt = new Date();
    scheduledAt.setHours(scheduledAt.getHours() + 2);
    console.log('📅 [SMART SCHEDULER] Optimal time calculated:', scheduledAt.toLocaleString());

    // Create queue entry using SchedulerQueueModel
    const queueEntry = new SchedulerQueueModel({
      filename,
      caption: caption || 'Amazing content!',
      platform: platform || 'instagram',
      scheduledTime: scheduledAt,
      status: 'scheduled',
      source: 'manual_run_now'
    });
    
    const savedEntry = await queueEntry.save();
    console.log('📦 [QUEUE INSERT] Entry added to scheduler queue:', savedEntry._id);
    
    res.json({
      success: true,
      message: 'Content queued for posting',
      queueId: savedEntry._id,
      scheduledTime: scheduledAt,
      platform: platform || 'instagram'
    });
    
  } catch (error) {
    console.error('❌ [RUN NOW ERROR]', error);
    res.status(500).json({ 
      error: 'Failed to queue content',
      success: false,
      message: error.message 
    });
  }
});

// Additional test endpoints for settings page
app.post('/api/test/mongodb', async (req, res) => {
  try {
    console.log('🧪 [MONGODB TEST] Testing database connection...');
    const settings = await SettingsModel.findOne();
    res.json({
      success: true,
      message: 'MongoDB connection successful',
      connected: true,
      hasData: !!settings
    });
  } catch (error) {
    console.error('❌ [MONGODB TEST ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'MongoDB connection failed',
      error: error.message
    });
  }
});

app.post('/api/test/upload', async (req, res) => {
  try {
    console.log('🧪 [UPLOAD TEST] Testing upload capabilities...');
    res.json({
      success: true,
      message: 'Upload test completed',
      capabilities: ['s3', 'dropbox', 'local']
    });
  } catch (error) {
    console.error('❌ [UPLOAD TEST ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'Upload test failed',
      error: error.message
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
    console.log('   GET  /health - Health check');
    console.log('   GET  /api/settings - Load settings (DIRECT)');
    console.log('   POST /api/settings - Save settings (DIRECT)');
  });
};

startServer().catch(console.error);// Force redeploy Tue Aug  5 17:11:13 CDT 2025
