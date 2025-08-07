// 📁 File: backend-v2/services/postNow.js

// 🧠 GOAL: Post 1 high-engagement video from Instagram using visual hash + caption fallback deduplication
// 🔁 Process is triggered manually via "Post Now" dashboard button

// 🔒 DO NOT:
// - Repost anything from the last 30 most recent posts (even if video ID is different)
// - Use video ID as the only filter

// ✅ DO:
// SCRAPE (your IG page) → SCRAPE (target pool) → FILTER → DOWNLOAD → FINGERPRINT → VALIDATE → UPLOAD → POST

const fetch = require('node-fetch');
const mongoose = require('mongoose');

/**
 * Calculate caption similarity between two strings
 */
function calculateCaptionSimilarity(caption1, caption2) {
  const stringSimilarity = require('string-similarity');
  const clean1 = (caption1 || '').toLowerCase().trim();
  const clean2 = (caption2 || '').toLowerCase().trim();
  return stringSimilarity.compareTwoStrings(clean1, clean2);
}

/**
 * Generate random ID for S3 keys
 */
function generateRandomId() {
  return Math.random().toString(36).substring(2, 8);
}

/**
 * Download video buffer from URL
 */
async function downloadVideoBuffer(videoUrl) {
  const response = await fetch(videoUrl);
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.status}`);
  }
  return await response.buffer();
}

/**
 * Extract first frame from video buffer (using fingerprint utility)
 */
async function extractFirstFrame(buffer) {
  const { extractFirstFrameHash } = require('../utils/fingerprint');
  return await extractFirstFrameHash(buffer);
}

/**
 * Generate visual hash (same as extractFirstFrame for now)
 */
async function generateVisualHash(thumbOrBuffer) {
  if (Buffer.isBuffer(thumbOrBuffer)) {
    return await extractFirstFrame(thumbOrBuffer);
  }
  return thumbOrBuffer; // Already a hash
}

/**
 * Scrape last 30 posts from your own Instagram page
 */
async function scrapeMyLast30InstagramPosts(settings) {
  console.log('📱 [STEP 1] Scraping YOUR last 30 Instagram posts...');
  
  const { scrapeInstagramEngagement } = require('../utils/instagramScraper');
  
  // Get your own recent posts (limit to 30)
  const myPosts = await scrapeInstagramEngagement(
    settings.igBusinessId,
    settings.instagramToken,
    30
  );
  
  console.log(`✅ [STEP 1] Found ${myPosts.length} of your recent posts`);
  return myPosts;
}

/**
 * Scrape target video pool (500 videos from Instagram)
 */
async function scrapeInstagramVideos(settings) {
  console.log('🎯 [STEP 2] Scraping 500 target videos from Instagram...');
  
  const { scrapeInstagramEngagement } = require('../utils/instagramScraper');
  
  // Get large pool of videos to choose from
  const videos = await scrapeInstagramEngagement(
    settings.igBusinessId,
    settings.instagramToken,
    500
  );
  
  console.log(`✅ [STEP 2] Found ${videos.length} target videos`);
  return videos;
}

/**
 * Main Post Now execution function
 */
async function executePostNow(settings) {
  try {
    console.log('🚀 [POST NOW] Starting clean step-by-step process...');

    // Import required functions
    const { uploadBufferToS3 } = require('../utils/s3Uploader');
    const { postToInstagram } = require('./instagramPoster');
    const { postToYouTube } = require('./youtubePoster');
    const { generateSmartCaptionWithKey } = require('./captionAI');

    // Get SchedulerQueue model (avoid overwrite)
    let SchedulerQueueModel;
    try {
      SchedulerQueueModel = mongoose.model('SchedulerQueue');
    } catch (error) {
      const schedulerQueueSchema = new mongoose.Schema({
        platform: String,
        source: String,
        originalVideoId: String,
        videoUrl: String,
        thumbnailUrl: String,
        thumbnailHash: String,
        caption: String,
        engagement: Number,
        createdAt: { type: Date, default: Date.now },
        postedAt: { type: Date, default: Date.now },
        status: { type: String, default: 'posted' }
      }, { timestamps: true });
      SchedulerQueueModel = mongoose.model('SchedulerQueue', schedulerQueueSchema, 'schedulerqueue');
    }

    // --------------------------------------------
    // ✅ STEP 1: FETCH LAST 30 POSTS FROM YOUR IG PAGE
    // - Use Instagram Graph API to get 30 most recent video posts from your account
    // - Generate thumbnail hashes + collect captions for fallback filtering
    // --------------------------------------------
    const recentInstagramPosts = await scrapeMyLast30InstagramPosts(settings);
    
    console.log('🔍 [STEP 1] Generating hashes from your recent posts...');
    const recentHashes = await Promise.all(
      recentInstagramPosts.map(async post => {
        try {
          const buffer = await downloadVideoBuffer(post.url);
          const hash = await generateVisualHash(buffer);
          console.log(`📸 [YOUR POST] Hash: ${hash.substring(0, 12)}...`);
          return hash;
        } catch (error) {
          console.warn(`⚠️ [HASH] Failed to generate hash for post ${post.id}: ${error.message}`);
          return null;
        }
      })
    );
    
    const recentCaptions = recentInstagramPosts.map(p => p.caption || "");
    const validHashes = recentHashes.filter(Boolean);
    
    console.log(`✅ [STEP 1] Generated ${validHashes.length} hashes from your posts`);
    console.log(`✅ [STEP 1] Collected ${recentCaptions.length} captions for similarity checking`);

    // --------------------------------------------
    // ✅ STEP 2: SCRAPE TARGET VIDEO POOL
    // - Use Instagram Graph API to fetch 500 latest videos (from explore, reels, or other source)
    // - Sort by engagement DESC
    // --------------------------------------------
    const scrapedVideos = await scrapeInstagramVideos(settings);
    const sortedVideos = scrapedVideos.sort((a, b) => b.engagement - a.engagement);
    
    console.log(`✅ [STEP 2] Sorted ${sortedVideos.length} videos by engagement (highest first)`);

    // --------------------------------------------
    // ✅ STEP 3: LOOP THROUGH VIDEOS FOR UNIQUENESS
    // - Check visual hash against recentHashes
    // - If visual hash is duplicate, check caption similarity
    // - If both fail, skip to next
    // --------------------------------------------
    console.log('🔍 [STEP 3] Filtering for unique videos...');
    let selectedVideo = null;
    let selectedHash = null;
    let videoBuffer = null;

    for (const video of sortedVideos) {
      try {
        console.log(`🎬 [STEP 3] Checking video ${video.id} (engagement: ${video.engagement})...`);
        
        const buffer = await downloadVideoBuffer(video.url);
        const hash = await generateVisualHash(buffer);

        console.log(`📸 [HASH CHECK] Video hash: ${hash.substring(0, 12)}...`);
        
        const isHashDuplicate = validHashes.includes(hash);
        console.log(`📸 [HASH CHECK] Duplicate: ${isHashDuplicate}`);

        const isCaptionDuplicate = recentCaptions.some(caption => {
          const similarity = calculateCaptionSimilarity(caption, video.caption || "");
          return similarity > 0.92;
        });
        console.log(`📝 [CAPTION CHECK] Duplicate: ${isCaptionDuplicate}`);

        if (isHashDuplicate || isCaptionDuplicate) {
          console.log(`🚫 [DUPLICATE] Skipping ${video.id} - duplicate by hash or caption`);
          continue;
        }

        // ✅ Found unique video!
        selectedVideo = video;
        selectedHash = hash;
        videoBuffer = buffer;
        console.log(`✅ [STEP 3] Selected unique video: ${video.id}`);
        break;

      } catch (error) {
        console.error(`❌ [STEP 3] Error processing video ${video.id}: ${error.message}`);
        continue;
      }
    }

    if (!selectedVideo || !videoBuffer) {
      throw new Error("No unique videos found to post");
    }

    // --------------------------------------------
    // ✅ STEP 4: UPLOAD TO S3
    // --------------------------------------------
    console.log('☁️ [STEP 4] Uploading to S3...');
    const s3Key = `autopilot/manual/${Date.now()}_${generateRandomId()}.mp4`;
    const s3Url = await uploadBufferToS3(videoBuffer, s3Key, "video/mp4");
    console.log(`✅ [STEP 4] S3 upload successful: ${s3Url}`);

    // --------------------------------------------
    // ✅ STEP 5: GENERATE SMART CAPTION (OpenAI or fallback)
    // --------------------------------------------
    console.log('✏️ [STEP 5] Generating smart caption...');
    let finalCaption = selectedVideo.caption || "Posted via Post Now";
    
    try {
      if (settings.openaiApiKey) {
        finalCaption = await generateSmartCaptionWithKey(
          selectedVideo.caption, 
          settings.openaiApiKey
        );
        console.log(`✅ [STEP 5] AI caption generated: ${finalCaption.substring(0, 50)}...`);
      } else {
        console.warn("⚠️ [STEP 5] No OpenAI key - using original caption");
      }
    } catch (e) {
      console.warn(`⚠️ [STEP 5] Caption generation failed: ${e.message} - using original`);
    }

    // --------------------------------------------
    // ✅ STEP 6: POST TO INSTAGRAM
    // --------------------------------------------
    console.log('📱 [STEP 6] Posting to Instagram...');
    const instagramResult = await postToInstagram({
      videoUrl: s3Url,
      caption: finalCaption,
      thumbnailHash: selectedHash,
      source: "manual"
    });

    if (!instagramResult.success) {
      throw new Error(`Instagram posting failed: ${instagramResult.error}`);
    }
    console.log(`✅ [STEP 6] Instagram post successful`);

    // --------------------------------------------
    // ✅ STEP 7: POST TO YOUTUBE (Optional)
    // --------------------------------------------
    let youtubeResult = { success: true };
    if (settings.autoPostToYouTube) {
      console.log('🎥 [STEP 7] Posting to YouTube...');
      youtubeResult = await postToYouTube({
        videoUrl: s3Url,
        caption: finalCaption,
        thumbnailHash: selectedHash,
        source: "manual"
      });
      console.log(`✅ [STEP 7] YouTube post: ${youtubeResult.success ? 'Success' : 'Failed'}`);
    }

    // --------------------------------------------
    // ✅ STEP 8: LOG TO DATABASE
    // --------------------------------------------
    console.log('💾 [STEP 8] Logging to database...');
    await SchedulerQueueModel.create({
      platform: "instagram",
      source: "manual",
      originalVideoId: selectedVideo.id,
      videoUrl: s3Url,
      thumbnailUrl: s3Url,
      thumbnailHash: selectedHash,
      caption: finalCaption,
      engagement: selectedVideo.engagement,
      postedAt: new Date(),
      status: 'posted'
    });

    console.log("✅ [POST NOW] Unique video posted to Instagram successfully with clean step-by-step flow");

    return {
      success: true,
      status: "✅ Posted successfully",
      platform: settings.autoPostToYouTube ? "Instagram + YouTube" : "Instagram",
      thumbnailHash: selectedHash.substring(0, 12) + '...',
      s3Url: s3Url,
      videoId: selectedVideo.id,
      caption: finalCaption.substring(0, 100) + '...'
    };

  } catch (error) {
    console.error('❌ [POST NOW ERROR]', error);
    throw error;
  }
}

module.exports = {
  executePostNow
};