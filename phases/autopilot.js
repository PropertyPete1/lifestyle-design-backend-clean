/**
 * Core Autopilot Logic - Instagram + YouTube Automated Posting
 * Scrapes high-engagement videos, uploads to S3, schedules posts
 */

const { uploadBufferToS3, generateS3Key } = require('../utils/s3Uploader');
const { getSmartSchedulerTime, getNextAvailableSlot } = require('../utils/smartScheduler');
const { scrapeInstagramEngagement, downloadVideoFromInstagram } = require('../utils/instagramScraper');
const { getLast30PostedVideos, filterUniqueVideos } = require('../utils/postHistory');
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
    console.log('🤖 [AUTOPILOT] Starting Instagram AutoPilot...');
    
    // Get user settings
    const settings = await SettingsModel.findOne({});
    if (!settings || !settings.autopilotEnabled) {
      console.log('⚠️ [AUTOPILOT] AutoPilot disabled or no settings found');
      return { success: false, message: 'AutoPilot disabled' };
    }
    
    // Check required credentials
    if (!settings.instagramToken || !settings.igBusinessId) {
      console.log('⚠️ [AUTOPILOT] Missing Instagram credentials');
      return { success: false, message: 'Missing Instagram credentials' };
    }
    
    if (!settings.s3AccessKey || !settings.s3SecretKey || !settings.s3BucketName) {
      console.log('⚠️ [AUTOPILOT] Missing S3 credentials');
      return { success: false, message: 'Missing S3 credentials' };
    }
    
    // STEP 1: Scrape latest 500 Instagram videos
    console.log('📱 [AUTOPILOT] Step 1: Scraping Instagram videos...');
    const scrapedVideos = await scrapeInstagramEngagement(
      settings.igBusinessId, 
      settings.instagramToken, 
      500
    );
    
    if (scrapedVideos.length === 0) {
      console.log('⚠️ [AUTOPILOT] No videos scraped');
      return { success: false, message: 'No videos found' };
    }
    
    // STEP 2: Filter by engagement (≥ 10,000)
    console.log('📊 [AUTOPILOT] Step 2: Filtering by engagement...');
    const qualifiedVideos = scrapedVideos
      .filter(v => v.engagement >= 10000)
      .sort((a, b) => b.engagement - a.engagement); // Highest engagement first
    
    console.log(`✅ [AUTOPILOT] ${qualifiedVideos.length} videos meet engagement threshold`);
    
    if (qualifiedVideos.length === 0) {
      console.log('⚠️ [AUTOPILOT] No videos meet engagement threshold');
      return { success: false, message: 'No high-engagement videos found' };
    }
    
    // STEP 3: Get last 30 posted videos to avoid duplicates
    console.log('📚 [AUTOPILOT] Step 3: Checking post history...');
    const last30Posted = await getLast30PostedVideos('instagram', SchedulerQueueModel);
    
    // STEP 4: Filter out duplicates and similar videos
    console.log('🔍 [AUTOPILOT] Step 4: Filtering duplicates...');
    const uniqueVideos = filterUniqueVideos(qualifiedVideos, last30Posted);
    
    if (uniqueVideos.length === 0) {
      console.log('⚠️ [AUTOPILOT] No unique videos found');
      return { success: false, message: 'All videos already posted or similar' };
    }
    
      // STEP 5: Select multiple videos based on maxPosts setting
  const videosToProcess = Math.min(uniqueVideos.length, settings.maxPosts || 3);
  console.log(`🎯 [AUTOPILOT] Step 5: Processing ${videosToProcess} videos`);
  
  const allQueuedPosts = [];
  
  for (let i = 0; i < videosToProcess; i++) {
    const selectedVideo = uniqueVideos[i];
    console.log(`🎯 [AUTOPILOT] Processing video ${i + 1}/${videosToProcess} with ${selectedVideo.engagement} engagement`);
    
    // STEP 6: Download video
    console.log('⬇️ [AUTOPILOT] Step 6: Downloading video...');
    const videoBuffer = await downloadVideoFromInstagram(selectedVideo.url);
    
    // STEP 7: Upload to S3
    console.log('☁️ [AUTOPILOT] Step 7: Uploading to S3...');
    const s3Key = generateS3Key('instagram');
    const s3Url = await uploadBufferToS3(videoBuffer, s3Key, 'video/mp4');
    
    // STEP 7.5: Generate thumbnail from first frame and upload to S3
    console.log('📸 [AUTOPILOT] Step 7.5: Generating thumbnail from first frame...');
    let extractedThumbnailUrl = s3Url; // Fallback to video URL
    
    try {
      // For now, just use the S3 video URL as thumbnail URL
      // This ensures the thumbnailUrl field gets the real S3 URL instead of placeholder
      extractedThumbnailUrl = s3Url;
      console.log('✅ [AUTOPILOT] Using S3 video URL as thumbnail:', extractedThumbnailUrl);
    } catch (error) {
      console.warn('⚠️ [AUTOPILOT] Thumbnail setup error:', error.message);
    }
    
    // STEP 8: Generate smart caption
    console.log('✍️ [AUTOPILOT] Step 8: Generating smart caption...');
    const smartCaption = await generateSmartCaptionWithKey(selectedVideo.caption, settings.openaiApiKey);
    
    // STEP 9: Get trending audio (if enabled)
    let trendingAudio = null;
    if (settings.useTrendingAudio) {
      console.log('🎵 [AUTOPILOT] Step 9: Finding trending audio...');
      trendingAudio = await findTrendingAudio('instagram');
    }
    
    // STEP 10: Calculate smart posting time (spread throughout today)
    console.log('📅 [AUTOPILOT] Step 10: Calculating optimal posting time...');
    const existingPosts = await SchedulerQueueModel.find({ status: 'scheduled' });
    const baseTime = await getNextAvailableSlot('instagram', existingPosts);
    const scheduledTime = new Date(baseTime.getTime() + (i * 2 * 60 * 60 * 1000)); // 2 hours apart for more posts today
    
    // STEP 11: Queue for posting (based on platform settings)
    console.log('📋 [AUTOPILOT] Step 11: Queueing posts...');
    const queuedPosts = [];
    
    // Queue Instagram post if enabled
    if (settings.postToInstagram !== false) { // Default to true if not set
      const instagramPost = await queueVideoForPosting({
        platform: 'instagram',
        videoUrl: s3Url,
        caption: smartCaption,
        audio: trendingAudio,
        scheduledTime: scheduledTime,
        thumbnailUrl: extractedThumbnailUrl,
        fingerprint: selectedVideo.fingerprint,
        thumbnailHash: selectedVideo.thumbnailHash,
        originalVideoId: selectedVideo.id,
        engagement: selectedVideo.engagement
      }, SchedulerQueueModel);
      
      queuedPosts.push(instagramPost);
    }
    
    // Queue YouTube post if enabled
    if (settings.postToYouTube) {
      const youtubeTime = new Date(scheduledTime);
      youtubeTime.setHours(youtubeTime.getHours() + 2); // 2 hours after Instagram
      
      const youtubePost = await queueVideoForPosting({
        platform: 'youtube',
        videoUrl: s3Url,
        caption: smartCaption,
        scheduledTime: youtubeTime,
        thumbnailUrl: extractedThumbnailUrl,
        fingerprint: selectedVideo.fingerprint,
        thumbnailHash: selectedVideo.thumbnailHash,
        originalVideoId: selectedVideo.id,
        engagement: selectedVideo.engagement
      }, SchedulerQueueModel);
      
      queuedPosts.push(youtubePost);
    }
    
    // Add this video's posts to the overall collection
    allQueuedPosts.push(...queuedPosts);
    console.log(`✅ [AUTOPILOT] Video ${i + 1} processed! Queued ${queuedPosts.length} posts`);
  }
  
  console.log(`🎉 [AUTOPILOT] ALL VIDEOS PROCESSED! Total queued: ${allQueuedPosts.length} posts`);
  
  return {
    success: true,
    message: `Processed ${videosToProcess} videos, queued ${allQueuedPosts.length} posts`,
    videosProcessed: videosToProcess,
    queuedPosts: allQueuedPosts.map(post => ({
        platform: post.platform,
        scheduledTime: post.scheduledTime,
        status: post.status,
        videoUrl: post.videoUrl
      }))
    };
    
  } catch (error) {
    console.error('❌ [AUTOPILOT ERROR]', error);
    return { 
      success: false, 
      message: `AutoPilot failed: ${error.message}`,
      error: error.message 
    };
  }
}

/**
 * Queue video for posting
 * @param {Object} postData - Post data
 * @param {Object} SchedulerQueueModel - Queue model
 * @returns {Promise<Object>} Queued post
 */
async function queueVideoForPosting(postData, SchedulerQueueModel) {
  try {
    console.log(`📋 [QUEUE] Queueing ${postData.platform} post for ${postData.scheduledTime}`);
    
    console.log('🔍 [DEBUG] Saving to queue:', {
      platform: postData.platform,
      s3Url: postData.videoUrl,
      thumbnailUrl: postData.thumbnailUrl,
      videoUrl: postData.videoUrl
    });
    
    const queuedPost = new SchedulerQueueModel({
      platform: postData.platform,
      s3Url: postData.videoUrl, // Save as s3Url to match schema
      caption: postData.caption,
      audio: postData.audio,
      scheduledTime: postData.scheduledTime,
      thumbnailUrl: postData.thumbnailUrl,
      fingerprint: postData.fingerprint,
      thumbnailHash: postData.thumbnailHash,
      originalVideoId: postData.originalVideoId,
      engagement: postData.engagement,
      status: 'scheduled',
      createdAt: new Date(),
      source: 'autopilot'
    });
    
    await queuedPost.save();
    
    console.log(`✅ [QUEUE] ${postData.platform} post queued successfully`);
    return queuedPost;
    
  } catch (error) {
    console.error('❌ [QUEUE ERROR]', error);
    throw error;
  }
}

/**
 * Mark post as completed and trigger next autopilot run
 * @param {string} platform - Platform name
 * @param {string} postId - Post ID
 * @param {Object} SchedulerQueueModel - Queue model
 * @param {Object} SettingsModel - Settings model
 * @returns {Promise<void>}
 */
async function markAsPostedAndRefill(platform, postId, SchedulerQueueModel, SettingsModel) {
  try {
    console.log(`✅ [REFILL] Marking ${platform} post as completed: ${postId}`);
    
    await SchedulerQueueModel.updateOne(
      { _id: postId }, 
      { 
        $set: { 
          status: 'posted',
          postedAt: new Date()
        }
      }
    );
    
    // Trigger next autopilot run to refill the queue
    if (platform === 'instagram') {
      console.log('🔄 [REFILL] Triggering next autopilot run...');
      setTimeout(() => {
        runInstagramAutoPilot(SettingsModel, SchedulerQueueModel);
      }, 5000); // Wait 5 seconds before refilling
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
 * Core Autopilot Logic - Instagram + YouTube Automated Posting
 * Scrapes high-engagement videos, uploads to S3, schedules posts
 */

const { uploadBufferToS3, generateS3Key } = require('../utils/s3Uploader');
const { getSmartSchedulerTime, getNextAvailableSlot } = require('../utils/smartScheduler');
const { scrapeInstagramEngagement, downloadVideoFromInstagram } = require('../utils/instagramScraper');
const { getLast30PostedVideos, filterUniqueVideos } = require('../utils/postHistory');
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
    console.log('🤖 [AUTOPILOT] Starting Instagram AutoPilot...');
    
    // Get user settings
    const settings = await SettingsModel.findOne({});
    if (!settings || !settings.autopilotEnabled) {
      console.log('⚠️ [AUTOPILOT] AutoPilot disabled or no settings found');
      return { success: false, message: 'AutoPilot disabled' };
    }
    
    // Check required credentials
    if (!settings.instagramToken || !settings.igBusinessId) {
      console.log('⚠️ [AUTOPILOT] Missing Instagram credentials');
      return { success: false, message: 'Missing Instagram credentials' };
    }
    
    if (!settings.s3AccessKey || !settings.s3SecretKey || !settings.s3BucketName) {
      console.log('⚠️ [AUTOPILOT] Missing S3 credentials');
      return { success: false, message: 'Missing S3 credentials' };
    }
    
    // STEP 1: Scrape latest 500 Instagram videos
    console.log('📱 [AUTOPILOT] Step 1: Scraping Instagram videos...');
    const scrapedVideos = await scrapeInstagramEngagement(
      settings.igBusinessId, 
      settings.instagramToken, 
      500
    );
    
    if (scrapedVideos.length === 0) {
      console.log('⚠️ [AUTOPILOT] No videos scraped');
      return { success: false, message: 'No videos found' };
    }
    
    // STEP 2: Filter by engagement (≥ 10,000)
    console.log('📊 [AUTOPILOT] Step 2: Filtering by engagement...');
    const qualifiedVideos = scrapedVideos
      .filter(v => v.engagement >= 10000)
      .sort((a, b) => b.engagement - a.engagement); // Highest engagement first
    
    console.log(`✅ [AUTOPILOT] ${qualifiedVideos.length} videos meet engagement threshold`);
    
    if (qualifiedVideos.length === 0) {
      console.log('⚠️ [AUTOPILOT] No videos meet engagement threshold');
      return { success: false, message: 'No high-engagement videos found' };
    }
    
    // STEP 3: Get last 30 posted videos to avoid duplicates
    console.log('📚 [AUTOPILOT] Step 3: Checking post history...');
    const last30Posted = await getLast30PostedVideos('instagram', SchedulerQueueModel);
    
    // STEP 4: Filter out duplicates and similar videos
    console.log('🔍 [AUTOPILOT] Step 4: Filtering duplicates...');
    const uniqueVideos = filterUniqueVideos(qualifiedVideos, last30Posted);
    
    if (uniqueVideos.length === 0) {
      console.log('⚠️ [AUTOPILOT] No unique videos found');
      return { success: false, message: 'All videos already posted or similar' };
    }
    
      // STEP 5: Select multiple videos based on maxPosts setting
  const videosToProcess = Math.min(uniqueVideos.length, settings.maxPosts || 3);
  console.log(`🎯 [AUTOPILOT] Step 5: Processing ${videosToProcess} videos`);
  
  const allQueuedPosts = [];
  
  for (let i = 0; i < videosToProcess; i++) {
    const selectedVideo = uniqueVideos[i];
    console.log(`🎯 [AUTOPILOT] Processing video ${i + 1}/${videosToProcess} with ${selectedVideo.engagement} engagement`);
    
    // STEP 6: Download video
    console.log('⬇️ [AUTOPILOT] Step 6: Downloading video...');
    const videoBuffer = await downloadVideoFromInstagram(selectedVideo.url);
    
    // STEP 7: Upload to S3
    console.log('☁️ [AUTOPILOT] Step 7: Uploading to S3...');
    const s3Key = generateS3Key('instagram');
    const s3Url = await uploadBufferToS3(videoBuffer, s3Key, 'video/mp4');
    
    // STEP 7.5: Generate thumbnail from first frame and upload to S3
    console.log('📸 [AUTOPILOT] Step 7.5: Generating thumbnail from first frame...');
    let extractedThumbnailUrl = s3Url; // Fallback to video URL
    
    try {
      // For now, just use the S3 video URL as thumbnail URL
      // This ensures the thumbnailUrl field gets the real S3 URL instead of placeholder
      extractedThumbnailUrl = s3Url;
      console.log('✅ [AUTOPILOT] Using S3 video URL as thumbnail:', extractedThumbnailUrl);
    } catch (error) {
      console.warn('⚠️ [AUTOPILOT] Thumbnail setup error:', error.message);
    }
    
    // STEP 8: Generate smart caption
    console.log('✍️ [AUTOPILOT] Step 8: Generating smart caption...');
    const smartCaption = await generateSmartCaptionWithKey(selectedVideo.caption, settings.openaiApiKey);
    
    // STEP 9: Get trending audio (if enabled)
    let trendingAudio = null;
    if (settings.useTrendingAudio) {
      console.log('🎵 [AUTOPILOT] Step 9: Finding trending audio...');
      trendingAudio = await findTrendingAudio('instagram');
    }
    
    // STEP 10: Calculate smart posting time (spread throughout today)
    console.log('📅 [AUTOPILOT] Step 10: Calculating optimal posting time...');
    const existingPosts = await SchedulerQueueModel.find({ status: 'scheduled' });
    const baseTime = await getNextAvailableSlot('instagram', existingPosts);
    const scheduledTime = new Date(baseTime.getTime() + (i * 2 * 60 * 60 * 1000)); // 2 hours apart for more posts today
    
    // STEP 11: Queue for posting (based on platform settings)
    console.log('📋 [AUTOPILOT] Step 11: Queueing posts...');
    const queuedPosts = [];
    
    // Queue Instagram post if enabled
    if (settings.postToInstagram !== false) { // Default to true if not set
      const instagramPost = await queueVideoForPosting({
        platform: 'instagram',
        videoUrl: s3Url,
        caption: smartCaption,
        audio: trendingAudio,
        scheduledTime: scheduledTime,
        thumbnailUrl: extractedThumbnailUrl,
        fingerprint: selectedVideo.fingerprint,
        thumbnailHash: selectedVideo.thumbnailHash,
        originalVideoId: selectedVideo.id,
        engagement: selectedVideo.engagement
      }, SchedulerQueueModel);
      
      queuedPosts.push(instagramPost);
    }
    
    // Queue YouTube post if enabled
    if (settings.postToYouTube) {
      const youtubeTime = new Date(scheduledTime);
      youtubeTime.setHours(youtubeTime.getHours() + 2); // 2 hours after Instagram
      
      const youtubePost = await queueVideoForPosting({
        platform: 'youtube',
        videoUrl: s3Url,
        caption: smartCaption,
        scheduledTime: youtubeTime,
        thumbnailUrl: extractedThumbnailUrl,
        fingerprint: selectedVideo.fingerprint,
        thumbnailHash: selectedVideo.thumbnailHash,
        originalVideoId: selectedVideo.id,
        engagement: selectedVideo.engagement
      }, SchedulerQueueModel);
      
      queuedPosts.push(youtubePost);
    }
    
    // Add this video's posts to the overall collection
    allQueuedPosts.push(...queuedPosts);
    console.log(`✅ [AUTOPILOT] Video ${i + 1} processed! Queued ${queuedPosts.length} posts`);
  }
  
  console.log(`🎉 [AUTOPILOT] ALL VIDEOS PROCESSED! Total queued: ${allQueuedPosts.length} posts`);
  
  return {
    success: true,
    message: `Processed ${videosToProcess} videos, queued ${allQueuedPosts.length} posts`,
    videosProcessed: videosToProcess,
    queuedPosts: allQueuedPosts.map(post => ({
        platform: post.platform,
        scheduledTime: post.scheduledTime,
        status: post.status,
        videoUrl: post.videoUrl
      }))
    };
    
  } catch (error) {
    console.error('❌ [AUTOPILOT ERROR]', error);
    return { 
      success: false, 
      message: `AutoPilot failed: ${error.message}`,
      error: error.message 
    };
  }
}

/**
 * Queue video for posting
 * @param {Object} postData - Post data
 * @param {Object} SchedulerQueueModel - Queue model
 * @returns {Promise<Object>} Queued post
 */
async function queueVideoForPosting(postData, SchedulerQueueModel) {
  try {
    console.log(`📋 [QUEUE] Queueing ${postData.platform} post for ${postData.scheduledTime}`);
    
    console.log('🔍 [DEBUG] Saving to queue:', {
      platform: postData.platform,
      s3Url: postData.videoUrl,
      thumbnailUrl: postData.thumbnailUrl,
      videoUrl: postData.videoUrl
    });
    
    const queuedPost = new SchedulerQueueModel({
      platform: postData.platform,
      s3Url: postData.videoUrl, // Save as s3Url to match schema
      caption: postData.caption,
      audio: postData.audio,
      scheduledTime: postData.scheduledTime,
      thumbnailUrl: postData.thumbnailUrl,
      fingerprint: postData.fingerprint,
      thumbnailHash: postData.thumbnailHash,
      originalVideoId: postData.originalVideoId,
      engagement: postData.engagement,
      status: 'scheduled',
      createdAt: new Date(),
      source: 'autopilot'
    });
    
    await queuedPost.save();
    
    console.log(`✅ [QUEUE] ${postData.platform} post queued successfully`);
    return queuedPost;
    
  } catch (error) {
    console.error('❌ [QUEUE ERROR]', error);
    throw error;
  }
}

/**
 * Mark post as completed and trigger next autopilot run
 * @param {string} platform - Platform name
 * @param {string} postId - Post ID
 * @param {Object} SchedulerQueueModel - Queue model
 * @param {Object} SettingsModel - Settings model
 * @returns {Promise<void>}
 */
async function markAsPostedAndRefill(platform, postId, SchedulerQueueModel, SettingsModel) {
  try {
    console.log(`✅ [REFILL] Marking ${platform} post as completed: ${postId}`);
    
    await SchedulerQueueModel.updateOne(
      { _id: postId }, 
      { 
        $set: { 
          status: 'posted',
          postedAt: new Date()
        }
      }
    );
    
    // Trigger next autopilot run to refill the queue
    if (platform === 'instagram') {
      console.log('🔄 [REFILL] Triggering next autopilot run...');
      setTimeout(() => {
        runInstagramAutoPilot(SettingsModel, SchedulerQueueModel);
      }, 5000); // Wait 5 seconds before refilling
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