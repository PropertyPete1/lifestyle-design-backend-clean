// ✅ AutoPilot Routes - Phase 9 Complete System
const express = require('express');
const mongoose = require('mongoose');
const { scrapeLatestInstagramVideos, getLast30AutopilotPosts, generateContentFingerprint, downloadInstagramMedia } = require('../services/instagramScraper');
const { uploadToS3, generateAutopilotFilename } = require('../services/s3Uploader');
const { generateSmartCaption, getBestTimeToPost } = require('../services/captionAI');

const router = express.Router();

// AutoPilot Queue Schema
const autopilotQueueSchema = new mongoose.Schema({
  platform: { type: String, required: true }, // 'instagram' or 'youtube'
  originalVideoId: String, // Original Instagram video ID
  videoUrl: String, // S3 URL of processed video
  thumbnailUrl: String,
  caption: String,
  originalCaption: String,
  engagement: Number,
  scheduledTime: Date,
  status: { type: String, default: 'scheduled' }, // 'scheduled', 'posted', 'failed'
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const AutopilotQueue = mongoose.model('AutopilotQueue', autopilotQueueSchema);

/**
 * Main AutoPilot Instagram Repost Function
 */
async function autopilotInstagramRepost(Settings) {
  try {
    console.log('🚀 [AUTOPILOT] Starting Instagram repost process...');
    
    // Step 1: Scrape latest Instagram videos
    const videos = await scrapeLatestInstagramVideos(Settings, 500);
    if (!videos.length) {
      throw new Error('No videos found from Instagram scraping');
    }

    // Step 2: Get recent posts to avoid duplicates
    const recentPosts = await getLast30AutopilotPosts('instagram');
    const recentFingerprints = recentPosts.map(v => generateContentFingerprint(v));

    // Step 3: Filter eligible videos
    const eligible = videos
      .filter(v => v.engagement >= 10000) // Minimum 10k engagement
      .filter(v => !recentFingerprints.includes(generateContentFingerprint(v)))
      .sort((a, b) => b.engagement - a.engagement); // Highest engagement first

    if (!eligible.length) {
      throw new Error('No eligible videos found (need 10k+ engagement, not recently posted)');
    }

    const selectedVideo = eligible[0];
    console.log(`🎯 [AUTOPILOT] Selected video with ${selectedVideo.engagement} engagement`);

    // Step 4: Generate new caption
    const newCaption = await generateSmartCaption(selectedVideo.caption, Settings);

    // Step 5: Download video
    const videoBuffer = await downloadInstagramMedia(selectedVideo.downloadUrl);

    // Step 6: Upload to S3
    const filename = generateAutopilotFilename('instagram');
    const s3Result = await uploadToS3({ file: videoBuffer, filename }, Settings);

    // Step 7: Get optimal posting time
    const scheduledTime = await getBestTimeToPost('instagram');

    // Step 8: Save to queue
    const queueEntry = new AutopilotQueue({
      platform: 'instagram',
      originalVideoId: selectedVideo.id,
      videoUrl: s3Result.Location,
      thumbnailUrl: selectedVideo.thumbnailUrl,
      caption: newCaption,
      originalCaption: selectedVideo.caption,
      engagement: selectedVideo.engagement,
      scheduledTime: scheduledTime,
      status: 'scheduled'
    });

    await queueEntry.save();

    console.log('✅ [AUTOPILOT] Instagram video scheduled successfully');
    return {
      success: true,
      videoId: selectedVideo.id,
      engagement: selectedVideo.engagement,
      caption: newCaption,
      scheduledTime: scheduledTime,
      s3Url: s3Result.Location,
      queueId: queueEntry._id
    };

  } catch (error) {
    console.error('❌ [AUTOPILOT ERROR]', error);
    throw error;
  }
}

/**
 * YouTube AutoPilot (similar process)
 */
async function autopilotYouTubeRepost(Settings) {
  try {
    console.log('🚀 [AUTOPILOT] Starting YouTube repost process...');
    
    // For now, use same Instagram content but schedule for YouTube
    const instagramResult = await autopilotInstagramRepost(Settings);
    
    // Create YouTube queue entry with different timing
    const youtubeScheduledTime = await getBestTimeToPost('youtube');
    
    const youtubeQueueEntry = new AutopilotQueue({
      platform: 'youtube',
      originalVideoId: instagramResult.videoId,
      videoUrl: instagramResult.s3Url,
      caption: instagramResult.caption,
      engagement: instagramResult.engagement,
      scheduledTime: youtubeScheduledTime,
      status: 'scheduled'
    });

    await youtubeQueueEntry.save();

    console.log('✅ [AUTOPILOT] YouTube video scheduled successfully');
    return {
      success: true,
      videoId: instagramResult.videoId,
      engagement: instagramResult.engagement,
      caption: instagramResult.caption,
      scheduledTime: youtubeScheduledTime,
      s3Url: instagramResult.s3Url,
      queueId: youtubeQueueEntry._id
    };

  } catch (error) {
    console.error('❌ [AUTOPILOT YOUTUBE ERROR]', error);
    throw error;
  }
}

// Routes
router.post('/run', async (req, res) => {
  try {
    console.log('🚀 [AUTOPILOT RUN] Starting full autopilot process...');
    
    // Get settings to check which platforms are enabled
    const Settings = mongoose.model('Settings');
    const settings = await Settings.findOne();
    
    if (!settings) {
      return res.status(400).json({ 
        success: false, 
        error: 'Settings not found. Please configure your credentials first.' 
      });
    }

    const results = {};

    // Run Instagram autopilot if enabled
    if (settings.postToInstagram) {
      try {
        console.log('📸 [AUTOPILOT] Running Instagram autopilot...');
        results.instagram = await autopilotInstagramRepost(Settings);
      } catch (error) {
        console.error('❌ [AUTOPILOT] Instagram failed:', error);
        results.instagram = { success: false, error: error.message };
      }
    }

    // Run YouTube autopilot if enabled
    if (settings.postToYouTube) {
      try {
        console.log('📺 [AUTOPILOT] Running YouTube autopilot...');
        results.youtube = await autopilotYouTubeRepost(Settings);
      } catch (error) {
        console.error('❌ [AUTOPILOT] YouTube failed:', error);
        results.youtube = { success: false, error: error.message };
      }
    }

    // Update autopilot status in settings
    await Settings.updateOne({}, { 
      autopilotEnabled: true,
      lastAutopilotRun: new Date()
    });

    console.log('✅ [AUTOPILOT] Process completed');
    res.json({
      success: true,
      message: 'AutoPilot process completed',
      results: results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ [AUTOPILOT RUN ERROR]', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get autopilot queue/status
router.get('/queue', async (req, res) => {
  try {
    const { platform, limit = 10 } = req.query;
    
    const filter = platform ? { platform } : {};
    const queuedItems = await AutopilotQueue.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json({
      success: true,
      queue: queuedItems,
      total: queuedItems.length
    });

  } catch (error) {
    console.error('❌ [AUTOPILOT QUEUE ERROR]', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get autopilot status
router.get('/status', async (req, res) => {
  try {
    const Settings = mongoose.model('Settings');
    const settings = await Settings.findOne();
    
    const totalQueued = await AutopilotQueue.countDocuments({ status: 'scheduled' });
    const instagramQueued = await AutopilotQueue.countDocuments({ platform: 'instagram', status: 'scheduled' });
    const youtubeQueued = await AutopilotQueue.countDocuments({ platform: 'youtube', status: 'scheduled' });

    res.json({
      success: true,
      autopilotEnabled: settings?.autopilotEnabled || false,
      lastRun: settings?.lastAutopilotRun,
      totalQueued,
      instagram: {
        enabled: settings?.postToInstagram || false,
        queued: instagramQueued
      },
      youtube: {
        enabled: settings?.postToYouTube || false,
        queued: youtubeQueued
      }
    });

  } catch (error) {
    console.error('❌ [AUTOPILOT STATUS ERROR]', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;