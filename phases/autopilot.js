/**
 * Core Autopilot Logic - Instagram + YouTube Automated Posting
 * Scrapes high-engagement videos, uploads to S3, schedules posts
 */

const { uploadBufferToS3, generateS3Key } = require('../utils/s3Uploader');
const { getSmartSchedulerTime } = require('../utils/smartScheduler');
const { scrapeInstagramEngagement, downloadVideoFromInstagram } = require('../utils/instagramScraper');
const { generateSmartCaptionWithKey, findTrendingAudio } = require('../services/captionAI');
const { extractFirstFrame } = require('../utils/thumbnailExtractor');

/**
 * Run Instagram AutoPilot - Main autopilot function
 * @param {Object} SettingsModel - Settings mongoose model
 * @param {Object} SchedulerQueueModel - Queue mongoose model
 * @returns {Promise<Object>} Autopilot result
 */
async function runInstagramAutoPilot(SettingsModel, SchedulerQueueModel) {
  try {
    console.log('🤖 [AUTOPILOT] Starting comprehensive autopilot system...');
    
    // Get user settings
    const settings = await SettingsModel.findOne({});
    if (!settings || !settings.autopilotEnabled) {
      console.log('⚠️ [AUTOPILOT] AutoPilot disabled or no settings found');
      return { success: false, message: 'AutoPilot disabled' };
    }
    
    // Debug: Log what credentials we found
    console.log('🔍 [AUTOPILOT] Settings debug:');
    console.log(`  - instagramToken: ${settings.instagramToken ? 'EXISTS' : 'MISSING'}`);
    console.log(`  - igBusinessId: ${settings.igBusinessId ? 'EXISTS' : 'MISSING'}`);
    console.log(`  - s3AccessKey: ${settings.s3AccessKey ? 'EXISTS' : 'MISSING'}`);
    console.log(`  - s3SecretKey: ${settings.s3SecretKey ? 'EXISTS' : 'MISSING'}`);
    console.log(`  - s3BucketName: ${settings.s3BucketName ? 'EXISTS' : 'MISSING'}`);
    
    // Check required credentials
    if (!settings.instagramToken || !settings.igBusinessId) {
      console.log('⚠️ [AUTOPILOT] Missing Instagram credentials');
      return { success: false, message: 'Missing Instagram credentials' };
    }
    
    if (!settings.s3AccessKey || !settings.s3SecretKey || !settings.s3BucketName) {
      console.log('⚠️ [AUTOPILOT] Missing S3 credentials');
      return { success: false, message: 'Missing S3 credentials' };
    }
    
    // STEP 1: Scrape Instagram videos using Graph API with engagement estimation
    console.log('📱 [AUTOPILOT] Step 1: Scraping Instagram videos with smart engagement calculation...');
    const { scrapeInstagramEngagement } = require('../utils/instagramScraper');
    const scrapedVideos = await scrapeInstagramEngagement(
      settings.igBusinessId, 
      settings.instagramToken, 
      500
    );
    
    console.log(`✅ [IG SCRAPER] Scraped ${scrapedVideos.length} videos`);
    
    if (scrapedVideos.length === 0) {
      console.log('⚠️ [AUTOPILOT] No videos scraped');
      return { success: false, message: 'No videos found' };
    }
    
    // STEP 2: Filter by engagement (≥ 10,000 views + likes + comments)
    console.log('📊 [AUTOPILOT] Step 2: Filtering by engagement...');
    const qualifiedVideos = scrapedVideos
      .filter(v => v.engagement >= 10000)
      .sort((a, b) => b.engagement - a.engagement); // Highest engagement first
    
    console.log(`📊 [AUTOPILOT] Found ${qualifiedVideos.length} high-engagement videos`);
    
    if (qualifiedVideos.length === 0) {
      console.log('⚠️ [AUTOPILOT] No videos meet engagement threshold');
      return { success: false, message: 'No high-engagement videos found' };
    }
    
    // STEP 3: Get thumbnailHashes of last 30 posted videos from database
    console.log('🔍 [AUTOPILOT] Step 3: Checking last 30 posted videos from database...');
    const last30Posts = await SchedulerQueueModel.find({ 
      platform: "instagram",
      status: "posted" 
    })
    .sort({ postedAt: -1 })
    .limit(30)
    .select("thumbnailHash");

    const recentThumbs = new Set(last30Posts.map(post => post.thumbnailHash).filter(hash => hash));
    console.log(`🛡️ [RECENT POSTS] ${recentThumbs.size} recent post hashes to avoid (last 30 posted)`);

    // STEP 4: Get current queue to avoid duplicates already scheduled
    console.log('🔍 [AUTOPILOT] Step 4: Checking current queue for duplicates...');
    const currentQueue = await SchedulerQueueModel.find({
      platform: "instagram",
      status: { $in: ["pending"] }
    }).select("thumbnailHash");

    const queueThumbs = new Set(currentQueue.map(post => post.thumbnailHash).filter(hash => hash));
    console.log(`📋 [QUEUE CHECK] ${queueThumbs.size} videos already in queue to avoid`);

    // STEP 5: Filter scraped videos using enhanced duplicate prevention
    console.log('🔍 [AUTOPILOT] Step 5: Filtering videos using enhanced duplicate prevention...');
    console.log(`🔍 [THUMBNAIL FILTER] Checking ${qualifiedVideos.length} videos against database and queue...`);
    
    const uniqueVideos = qualifiedVideos.filter(v => {
      // Must have engagement threshold (already filtered but double-check)
      if (v.engagement < 10000) {
        return false;
      }
      
      // Must have thumbnail hash
      if (!v.thumbnailHash) {
        console.log(`⚠️ [THUMBNAIL FILTER] Skipping video without hash: ${v.id}`);
        return false;
      }
      
      // Skip if in recent 30 posted videos
      if (recentThumbs.has(v.thumbnailHash)) {
        console.log(`🚫 [RECENT POST FILTER] Skipping recently posted video: ${v.id} (hash: ${v.thumbnailHash})`);
        return false;
      }
      
      // Skip if already in current queue
      if (queueThumbs.has(v.thumbnailHash)) {
        console.log(`📋 [QUEUE FILTER] Skipping already queued video: ${v.id} (hash: ${v.thumbnailHash})`);
        return false;
      }
      
      console.log(`✅ [THUMBNAIL FILTER] Eligible video: ${v.id} (hash: ${v.thumbnailHash}, ${v.engagement} engagement)`);
      return true;
    }).sort((a, b) => b.engagement - a.engagement); // Highest engagement first
    
    console.log(`✅ [THUMBNAIL FILTER] ${uniqueVideos.length} eligible videos found`);
    
    if (uniqueVideos.length === 0) {
      console.log('⚠️ [AUTOPILOT] No unique videos found');
      return { success: false, message: 'All videos already posted or similar' };
    }
    
    // STEP 6: Select videos to process (up to maxPosts setting) - prioritize highest engagement
    const maxPosts = settings.maxPosts || 5;
    const videosToProcess = uniqueVideos.slice(0, maxPosts);
    
    console.log(`🎯 [AUTOPILOT] Looking for up to ${maxPosts} videos to queue...`);
    
    // Log selected videos
    videosToProcess.forEach((video, index) => {
      console.log(`🎯 [AUTOPILOT] Selected video ${index + 1}/${maxPosts} with ${video.engagement} engagement`);
    });
    
    console.log(`🔄 [AUTOPILOT] Processing ${videosToProcess.length} selected videos...`);
    
    // STEP 6: Process each video
    let processedCount = 0;
    for (let i = 0; i < videosToProcess.length; i++) {
      const video = videosToProcess[i];
      console.log(`📹 [AUTOPILOT] Processing video ${i + 1}/${videosToProcess.length}...`);
      
      try {
        // Download video from Instagram
        console.log('⬇️ [AUTOPILOT] Downloading video from Instagram...');
        console.log(`🔗 [DEBUG] Video URL: ${video.url}`);
        console.log(`📥 [DEBUG] Downloading video from Instagram URL: ${video.url}`);
        
        const videoBuffer = await downloadVideoFromInstagram(video.url);
        console.log(`✅ [DEBUG] Video downloaded, buffer size: ${videoBuffer.length}`);
        
        // Upload to S3
        const s3Key = generateS3Key('auto', video.id);
        console.log(`☁️ [DEBUG] Starting S3 upload with key: ${s3Key}`);
        
        const s3Url = await uploadBufferToS3(videoBuffer, s3Key, 'video/mp4');
        console.log(`🔗 [DEBUG] S3 upload result: ${s3Url}`);
        
        if (!s3Url) {
          console.log(`❌ [AUTOPILOT] S3 upload failed for video ${video.id}`);
          continue;
        }
        
        console.log(`✅ [AUTOPILOT] S3 upload successful: ${s3Url}`);
        
        // Generate smart caption
        console.log('🧠 [AUTOPILOT] Generating smart caption...');
        const enhancedCaption = await generateSmartCaptionWithKey(video.caption, settings.openaiApiKey);
        
        // Calculate scheduled times
        const instagramTime = await getSmartSchedulerTime('instagram', settings);
        const youtubeTime = await getSmartSchedulerTime('youtube', settings);
        
        // Queue for Instagram
        const instagramPost = {
          platform: 'instagram',
          source: 'autopilot',
          originalVideoId: video.id,
          videoUrl: s3Url,
          thumbnailUrl: s3Url, // Use S3 URL as thumbnail
          thumbnailHash: video.thumbnailHash,
          caption: enhancedCaption,
          hashtags: video.hashtags || [],
          engagement: video.engagement,
          scheduledTime: instagramTime,
          status: 'pending'
        };
        
        await queueVideoForPosting(instagramPost, SchedulerQueueModel);
        console.log(`📅 [AUTOPILOT] Scheduled instagram post ${i + 1} for ${instagramTime.toLocaleString()}`);
        
        // Queue for YouTube (same video, different time)
        const youtubePost = {
          platform: 'youtube',
          source: 'autopilot',
          originalVideoId: video.id,
          videoUrl: s3Url,
          thumbnailUrl: s3Url,
          thumbnailHash: video.thumbnailHash,
          caption: enhancedCaption,
          hashtags: video.hashtags || [],
          engagement: video.engagement,
          scheduledTime: youtubeTime,
          status: 'pending'
        };
        
        await queueVideoForPosting(youtubePost, SchedulerQueueModel);
        console.log(`📅 [AUTOPILOT] Scheduled youtube post ${i + 1} for ${youtubeTime.toLocaleString()}`);
        
        processedCount++;
        
      } catch (error) {
        console.error(`❌ [AUTOPILOT] Error processing video ${video.id}:`, error);
        continue;
      }
    }
    
    console.log(`✅ [AUTOPILOT] Comprehensive autopilot run completed successfully - ${processedCount} videos processed`);
    
    return {
      success: true,
      message: `Autopilot completed successfully`,
      processed: processedCount,
      total: videosToProcess.length
    };
    
  } catch (error) {
    console.error('❌ [AUTOPILOT] Critical error:', error);
    return { success: false, message: 'Autopilot failed', error: error.message };
  }
}

/**
 * Queue a video for posting
 * @param {Object} postData - Post data object
 * @param {Object} SchedulerQueueModel - Queue mongoose model
 */
async function queueVideoForPosting(postData, SchedulerQueueModel) {
  try {
    const newPost = new SchedulerQueueModel(postData);
    await newPost.save();
    console.log(`✅ [QUEUE] Added ${postData.platform} post to queue: ${postData.originalVideoId}`);
  } catch (error) {
    console.error(`❌ [QUEUE] Failed to add ${postData.platform} post:`, error);
  }
}

/**
 * Mark a post as posted and trigger refill
 * @param {string} platform - Platform name
 * @param {string} postId - Post ID
 * @param {Object} SchedulerQueueModel - Queue mongoose model
 * @param {Object} SettingsModel - Settings mongoose model
 */
async function markAsPostedAndRefill(platform, postId, SchedulerQueueModel, SettingsModel) {
  try {
    // Mark as posted
    await SchedulerQueueModel.findByIdAndUpdate(postId, { 
      status: 'posted',
      postedAt: new Date()
    });
    
    console.log(`✅ [REFILL] Marked ${platform} post as posted: ${postId}`);
    
    // Check if we need to refill the queue
    const pendingPosts = await SchedulerQueueModel.countDocuments({ 
      platform, 
      status: 'pending' 
    });
    
    console.log(`📊 [REFILL] ${pendingPosts} pending ${platform} posts remaining`);
    
    // If less than 3 posts remaining, trigger refill
    if (pendingPosts < 3) {
      console.log(`🔄 [REFILL] Triggering autopilot refill for ${platform}...`);
      await runInstagramAutoPilot(SettingsModel, SchedulerQueueModel);
    }
    
  } catch (error) {
    console.error('❌ [REFILL ERROR]', error);
  }
}

module.exports = {
  runInstagramAutoPilot,
  queueVideoForPosting,
  markAsPostedAndRefill
};