require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// MongoDB connection  
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb+srv://peterallen:RDSTonopah1992@cluster0.7vqin.mongodb.net/lifestyle-design-social?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB connected'))
.catch(err => console.error('❌ MongoDB connection error:', err));

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
    enum: ['pending', 'posted', 'failed', 'completed'],
    default: 'pending'
  },
  source: {
    type: String,
    enum: ['autopilot', 'manual'],
    default: 'autopilot'
  },
  videoUrl: String,
  thumbnailUrl: String,
  thumbnailPath: String,
  s3Url: String,
  thumbnailHash: String,
  engagement: Number,
  originalVideoId: String,
  postedAt: { type: Date },
  hashtags: [String],
  retryCount: { type: Number, default: 0 },
  errorMessage: String
}, { timestamps: true, collection: 'SchedulerQueue' });

const SchedulerQueueModel = mongoose.model('SchedulerQueue', schedulerQueueSchema);

// API Routes

// Autopilot status
app.get('/api/autopilot/status', async (req, res) => {
  try {
    const settings = await SettingsModel.findOne();
    res.json({
      autopilotEnabled: settings?.autopilotEnabled || false,
      status: 'ready'
    });
  } catch (error) {
    console.error('❌ [AUTOPILOT STATUS] Error:', error);
    res.status(500).json({ error: 'Failed to get autopilot status' });
  }
});

// Delete autopilot queue
app.delete('/api/autopilot/queue', async (req, res) => {
  try {
    const result = await SchedulerQueueModel.deleteMany({});
    console.log(`🗑️ [AUTOPILOT QUEUE] Deleted ${result.deletedCount} items`);
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (error) {
    console.error('❌ [AUTOPILOT QUEUE DELETE] Error:', error);
    res.status(500).json({ error: 'Failed to delete autopilot queue' });
  }
});

// Debug posted videos
app.get('/api/debug/posted-videos', async (req, res) => {
  try {
    const postedVideos = await SchedulerQueueModel.find({ 
      platform: "instagram", 
      status: "posted" 
    })
    .sort({ postedAt: -1 })
    .limit(30)
    .select("thumbnailHash originalVideoId postedAt engagement");
    
    res.json({ 
      count: postedVideos.length,
      videos: postedVideos 
    });
  } catch (error) {
    console.error('❌ [DEBUG POSTED] Error:', error);
    res.status(500).json({ error: 'Failed to get posted videos' });
  }
});

// Create mock posted videos for testing duplicate prevention
app.post('/api/debug/create-mock-posted', async (req, res) => {
  try {
    const mockPostedVideos = [
      {
        platform: 'instagram',
        status: 'posted',
        originalVideoId: '18456098467004286',
        thumbnailHash: 'mock1hash',
        postedAt: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 day ago
        engagement: 1917726
      },
      {
        platform: 'instagram', 
        status: 'posted',
        originalVideoId: '18052183477796236',
        thumbnailHash: 'mock2hash',
        postedAt: new Date(Date.now() - 1000 * 60 * 60 * 48), // 2 days ago
        engagement: 448956
      }
    ];
    
    const result = await SchedulerQueueModel.insertMany(mockPostedVideos);
    res.json({ success: true, created: result.length });
  } catch (error) {
    console.error('❌ [MOCK POSTED] Error:', error);
    res.status(500).json({ error: 'Failed to create mock posted videos' });
  }
});

// POST NOW - Instant posting system (manual override)
app.post('/api/autopilot/manual-post', async (req, res) => {
  try {
    console.log('🚀 [POST NOW] Starting instant post process...');
    
    // Get settings for API credentials
    const settings = await SettingsModel.findOne();
    if (!settings || !settings.instagramToken || !settings.igBusinessId) {
      return res.status(400).json({ error: 'Missing Instagram credentials in settings' });
    }
    
    // Import required functions
    const { scrapeInstagramEngagement, downloadVideoFromInstagram } = require('./utils/instagramScraper');
    const { uploadBufferToS3, generateS3Key } = require('./utils/s3Uploader');
    const { generateSmartCaptionWithKey } = require('./services/captionAI');
    const { generateThumbnailHash } = require('./utils/postHistory');
    const { postToInstagram, postToYouTube } = require('./services/postExecutor');
    
    // STEP 1: Scrape Instagram for high-engagement videos
    console.log('📱 [POST NOW] Scraping Instagram for high-engagement videos...');
    const scrapedVideos = await scrapeInstagramEngagement(
      settings.igBusinessId,
      settings.instagramToken,
      500 // Large batch for best video selection
    );
    
    if (scrapedVideos.length === 0) {
      return res.status(404).json({ error: 'No videos found to post' });
    }
    
    console.log(`✅ [POST NOW] Found ${scrapedVideos.length} videos to analyze`);
    
    // STEP 2: Get last 30 Instagram posts with comprehensive data for duplicate prevention
    // Check activitylogs collection where posted videos are actually stored
    const ActivityLogModel = mongoose.model('ActivityLog', new mongoose.Schema({}, { strict: false }), 'activitylogs');
    const last30IG = await ActivityLogModel.find({
      platform: 'instagram',
      status: 'success'
    })
    .sort({ createdAt: -1 })
    .limit(30)
    .select('videoId thumbnailUrl caption');
    
    // 👁️‍🗨️ Collect recent hashes, captions, and video IDs for multi-layer checking
    // Note: activitylogs uses videoId, thumbnailUrl, caption fields
    const recentHashes = new Set(); // thumbnailHash not available in activitylogs
    const recentCaptions = new Set(last30IG.map(v => v.caption?.trim().toLowerCase().substring(0, 50)).filter(cap => cap));
    const recentVideoIds = new Set(last30IG.map(v => v.videoId).filter(id => id));
    
    console.log(`🛡️ [POST NOW] Multi-layer duplicate prevention:`);
    console.log(`📊 [DEBUG] Found ${last30IG.length} posted entries in database`);
    console.log(`⏰ [DEBUG] Checking LAST ${last30IG.length} MOST RECENT successful Instagram posts`);
    if (last30IG.length > 0) {
      const mostRecent = last30IG[0];
      const oldest = last30IG[last30IG.length - 1];
      console.log(`📅 [DEBUG] Most recent post: ${mostRecent.createdAt || mostRecent.videoId}`);
      console.log(`📅 [DEBUG] Oldest in range: ${oldest.createdAt || oldest.videoId}`);
    }
    console.log(`📸 ${recentHashes.size} recent thumbnail hashes`);
    console.log(`📝 ${recentCaptions.size} recent caption snippets`);
    console.log(`🆔 ${recentVideoIds.size} recent video IDs`);
    
    // DEBUG: If no posted entries exist, log this critical issue
    if (last30IG.length === 0) {
      console.log(`⚠️ [POST NOW] WARNING: Database has NO posted entries! This means:`);
      console.log(`   1. Post Now never saved posted entries before`);
      console.log(`   2. OR cron scheduler isn't marking posts as 'posted'`);
      console.log(`   3. OR database was cleared`);
      console.log(`   4. This will cause same video selection repeatedly!`);
      console.log(`🔄 [POST NOW] APPLYING TEMPORARY FIX: Adding time-based randomization to prevent same video selection`);
    }
    
    // STEP 3: Find unique high-engagement video with PRE-DOWNLOAD hash verification
    let selectedVideo = null;
    let selectedVideoBuffer = null;
    let finalThumbnailHash = null;
    
    console.log('🔍 [POST NOW] Starting pre-download duplicate filtering...');
    const crypto = require('crypto');
    
    // If no posted entries exist, randomize the start point to avoid always selecting the same video
    let startIndex = 0;
    if (last30IG.length === 0) {
      startIndex = Math.floor(Math.random() * Math.min(scrapedVideos.length, 20)); // Random start within first 20 videos
      console.log(`🎲 [POST NOW] Starting from random index ${startIndex} to avoid repeat selection`);
    }
    
    for (let i = startIndex; i < scrapedVideos.length; i++) {
      const video = scrapedVideos[i];
      if (video.engagement < 10000) continue; // Skip low engagement
      
      console.log(`🔍 [POST NOW] Testing video ${video.id} (${video.engagement} engagement)...`);
      
      // PRE-DOWNLOAD: Download video buffer to generate hash BEFORE committing to post
      console.log('⬇️ [POST NOW] Pre-downloading for hash verification...');
      const testBuffer = await downloadVideoFromInstagram(video.url);
      const testHash = crypto.createHash('sha256').update(testBuffer).digest('hex').substring(0, 16);
      
      // Check if this exact video exists in the LAST 30 MOST RECENT posts
      const videoIdMatch = recentVideoIds.has(video.id);
      const captionMatch = recentCaptions.has(video.caption?.trim().toLowerCase().substring(0, 50));
      const videoExists = videoIdMatch || captionMatch;
      
      if (videoExists) {
        const matchType = videoIdMatch ? 'Video ID' : 'Caption';
        console.log(`⏭️ [POST NOW] Skipping video: ${video.id} - ${matchType} found in LAST 30 MOST RECENT posts`);
        continue;
      }
      
      // This video is unique - select it
      selectedVideo = video;
      selectedVideoBuffer = testBuffer;
      finalThumbnailHash = testHash;
      console.log(`✅ [POST NOW] Selected unique video: ${video.id} - NOT found in last 30 most recent posts`);
      console.log(`🎯 [POST NOW] Video hash: ${testHash} | Engagement: ${video.engagement}`);
      break;
    }
    
    if (!selectedVideo) {
      return res.status(404).json({ error: 'No unique high-engagement video found to post' });
    }
    
    // STEP 4: Upload the already-downloaded buffer to S3
    console.log('☁️ [POST NOW] Uploading pre-verified video to S3...');
    const s3Key = generateS3Key('manual', selectedVideo.id);
    const s3Url = await uploadBufferToS3(selectedVideoBuffer, s3Key, 'video/mp4');
    
    if (!s3Url) {
      return res.status(500).json({ error: 'Failed to upload video to S3' });
    }
    
    console.log(`✅ [POST NOW] Video uploaded: ${s3Url}`);
    
    // STEP 5: Generate enhanced caption
    console.log('🧠 [POST NOW] Generating smart caption...');
    const enhancedCaption = await generateSmartCaptionWithKey(
      selectedVideo.caption || 'Amazing video!', 
      settings.openaiApiKey
    );
    
    // STEP 6: Post to Instagram and YouTube instantly
    const postData = {
      videoUrl: s3Url,
      caption: enhancedCaption,
      thumbnailUrl: s3Url,
      source: 'manual'
    };
    
    console.log('📱 [POST NOW] Posting to Instagram...');
    const instagramResult = await postToInstagram(postData, settings);
    
    console.log('🎥 [POST NOW] Posting to YouTube...');
    const youtubeResult = await postToYouTube(postData, settings);
    
    // STEP 7: Log as posted in database with final thumbnail hash
    console.log(`💾 [POST NOW] Saving to database with hash: ${finalThumbnailHash}`);
    const postedEntry = await SchedulerQueueModel.create({
      platform: 'instagram',
      source: 'manual',
      originalVideoId: selectedVideo.id,
      videoUrl: s3Url,
      caption: enhancedCaption,
      thumbnailHash: finalThumbnailHash, // Use the final hash from S3 buffer
      engagement: selectedVideo.engagement,
      status: 'posted',
      postedAt: new Date(),
      scheduledTime: new Date() // Posted immediately
    });
    console.log(`✅ [POST NOW] Database entry created with ID: ${postedEntry._id}`);
    
    console.log('✅ [POST NOW] Successfully posted to Instagram and YouTube!');
    
    res.json({
      success: true,
      message: 'Video posted instantly to Instagram and YouTube!',
      videoId: selectedVideo.id,
      engagement: selectedVideo.engagement,
      s3Url: s3Url,
      instagram: instagramResult.success,
      youtube: youtubeResult.success
    });
    
  } catch (error) {
    console.error('❌ [POST NOW] Error:', error);
    res.status(500).json({ 
      error: 'Failed to post video instantly',
      details: error.message 
    });
  }
});

// Get autopilot queue
app.get('/api/autopilot/queue', async (req, res) => {
  try {
    console.log('📋 [AUTOPILOT QUEUE] Fetching real queue data from SchedulerQueueModel...');
    
    const queueItems = await SchedulerQueueModel.find({})
      .sort({ scheduledTime: 1 })
      .limit(50);
    
    const formattedQueue = queueItems.map(item => ({
      id: item._id,
      platform: item.platform,
      caption: item.caption || 'Generated caption',
      scheduledTime: item.scheduledTime,
      status: item.status,
      source: item.source || 'autopilot',
      videoUrl: item.videoUrl || item.s3Url,
      thumbnailUrl: item.thumbnailUrl || item.s3Url,
      engagement: item.engagement || 0,
      originalVideoId: item.originalVideoId
    }));
    
    console.log(`📋 [AUTOPILOT QUEUE] Found ${formattedQueue.length} scheduled posts`);
    
    res.json({
      queue: formattedQueue,
      posts: formattedQueue,
      totalCount: formattedQueue.length,
      platforms: [...new Set(formattedQueue.map(p => p.platform))]
    });
  } catch (error) {
    console.error('❌ [AUTOPILOT QUEUE ERROR]', error);
    res.status(500).json({ error: 'Failed to get AutoPilot queue' });
  }
});

// Run autopilot
app.post('/api/autopilot/run', async (req, res) => {
  try {
    console.log('🚀 [AUTOPILOT] Starting AutoPilot run...');
    
    // Set a shorter timeout to prevent 502 errors
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        console.log('⏰ [AUTOPILOT] Request timeout - sending early response');
        res.json({ 
          success: true, 
          message: 'AutoPilot started successfully (running in background)',
          timeout: true
        });
      }
    }, 25000); // 25 second timeout
    
    // Import our clean autopilot module
    const { runInstagramAutoPilot } = require('./phases/autopilot');
    
    // Run the autopilot using our clean module
    const result = await runInstagramAutoPilot(SettingsModel, SchedulerQueueModel);
    
    clearTimeout(timeout);
    
    if (!res.headersSent) {
      if (result.success) {
        res.json({ 
          success: true, 
          message: result.message,
          processed: result.processed || 0,
          total: result.total || 0
        });
      } else {
        res.status(400).json({ error: result.message });
      }
    }

  } catch (error) {
    console.error('❌ [AUTOPILOT] Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'AutoPilot failed to run' });
    }
  }
});

// Settings endpoints
app.get('/api/settings', async (req, res) => {
  try {
    console.log('📋 [SETTINGS] Fetching settings from MongoDB...');
    const settings = await SettingsModel.findOne();
    console.log('📋 [SETTINGS] Found settings:', settings ? 'YES' : 'NO');
    if (settings) {
      console.log('📋 [SETTINGS] Settings keys:', Object.keys(settings.toObject || settings));
    }
    res.json(settings || {});
  } catch (error) {
    console.error('❌ [SETTINGS] Error:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    console.log('💾 [SETTINGS] Updating settings with:', Object.keys(req.body));
    const settings = await SettingsModel.findOneAndUpdate({}, req.body, { 
      new: true, 
      upsert: true 
    });
    console.log('💾 [SETTINGS] Update result:', settings ? 'SUCCESS' : 'FAILED');
    res.json(settings);
  } catch (error) {
    console.error('❌ [SETTINGS] Update error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Analytics endpoint
app.get('/api/analytics', async (req, res) => {
  try {
    const settings = await SettingsModel.findOne();
    res.json({
      instagram: { 
        followers: 0, 
        reach: 0, 
        engagementRate: 0, 
        autopilotEnabled: settings?.autopilotEnabled || false 
      },
      youtube: { 
        subscribers: 0, 
        reach: 0, 
        autopilotEnabled: settings?.autopilotEnabled || false 
      },
      totalPosts: 0,
      avgEngagement: 0
    });
  } catch (error) {
    console.error('❌ [ANALYTICS] Error:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

// Missing API endpoints that frontend is calling
app.get('/api/chart/status', (req, res) => {
  res.json({ status: 'active', charts: ['engagement', 'reach'] });
});

app.get('/api/activity/feed', (req, res) => {
  const { platform, limit = 10 } = req.query;
  res.json({ activities: [], total: 0, platform });
});

app.get('/api/events/recent', (req, res) => {
  res.json({ events: [], lastUpdated: new Date().toISOString() });
});

// Test YouTube credentials endpoint
app.get('/api/test/youtube', async (req, res) => {
  try {
    console.log('🔍 [YOUTUBE TEST] Fetching and testing YouTube credentials...');
    const settings = await SettingsModel.findOne();
    
    if (!settings) {
      return res.json({ error: 'No settings found' });
    }
    
    // Log what YouTube credentials we have
    console.log('🔍 [YOUTUBE TEST] YouTube credentials check:');
    console.log(`  - youtubeClientId: ${settings.youtubeClientId ? 'EXISTS' : 'MISSING'}`);
    console.log(`  - youtubeClientSecret: ${settings.youtubeClientSecret ? 'EXISTS' : 'MISSING'}`);
    console.log(`  - youtubeAccessToken: ${settings.youtubeAccessToken ? 'EXISTS' : 'MISSING'}`);
    console.log(`  - youtubeRefreshToken: ${settings.youtubeRefreshToken ? 'EXISTS' : 'MISSING'}`);
    console.log(`  - youtubeChannelId: ${settings.youtubeChannelId ? 'EXISTS' : 'MISSING'}`);
    
    const result = {
      hasClientId: !!settings.youtubeClientId,
      hasClientSecret: !!settings.youtubeClientSecret,
      hasAccessToken: !!settings.youtubeAccessToken,
      hasRefreshToken: !!settings.youtubeRefreshToken,
      hasChannelId: !!settings.youtubeChannelId
    };
    
    // Test YouTube API if we have access token
    if (settings.youtubeAccessToken) {
      try {
        const fetch = require('node-fetch');
        const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&mine=true&access_token=${settings.youtubeAccessToken}`;
        console.log('🔗 [YOUTUBE TEST] Testing API call...');
        
        const response = await fetch(channelUrl);
        const data = await response.json();
        
        if (response.ok) {
          console.log('✅ [YOUTUBE TEST] API call successful!');
          console.log(`📊 [YOUTUBE TEST] Channel: ${data.items?.[0]?.snippet?.title}`);
          result.apiTest = 'SUCCESS';
          result.channelData = data.items?.[0];
        } else {
          console.log(`❌ [YOUTUBE TEST] API call failed: ${response.status}`);
          console.log(`❌ [YOUTUBE TEST] Error: ${JSON.stringify(data)}`);
          result.apiTest = 'FAILED';
          result.apiError = data;
        }
      } catch (apiError) {
        console.log(`❌ [YOUTUBE TEST] API error: ${apiError.message}`);
        result.apiTest = 'ERROR';
        result.apiError = apiError.message;
      }
    } else {
      result.apiTest = 'NO_TOKEN';
    }
    
    res.json(result);
  } catch (error) {
    console.error('❌ [YOUTUBE TEST] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST NOW - Step-by-step flow with visual hash + caption similarity protection
app.post('/api/postNow', async (req, res) => {
  try {
    console.log("📲 [POST NOW] Starting step-by-step process...");

    const settings = await SettingsModel.findOne({});
    if (!settings || !settings.instagramToken || !settings.igBusinessId) {
      return res.status(400).json({ error: 'Missing Instagram credentials in settings' });
    }

    // Use the new step-by-step service
    const { executePostNow } = require('./services/postNow');
    const result = await executePostNow(settings);

    return res.status(200).json(result);

  } catch (err) {
    console.error("❌ [POST NOW ERROR]", err);
    res.status(500).json({ 
      error: "Internal server error", 
      details: err.message,
      success: false 
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
      console.log('✅ AutoPilot system ready with Instagram API duplicate detection ACTIVE [v42]');
});