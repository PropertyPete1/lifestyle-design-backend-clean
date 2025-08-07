/**
 * Post Now Service - Find FIRST unique video (not always #1 engagement)
 * 
 * 🧠 GOAL: Post a unique high-engagement Instagram video that is NOT visually 
 * or structurally similar to the last 30 real posts
 * 
 * 🔁 FIX: DO NOT default to posting the #1 highest engaging video
 * Instead, iterate top 500 and post the first one that passes all filters
 */

const mongoose = require('mongoose');
const { compareCaptionSimilarity } = require('string-similarity');

/**
 * Fetch last 30 Instagram posts directly from Instagram API
 */
async function fetchLast30InstagramPosts(settings) {
  console.log('🔍 [STEP 1] Fetching last 30 posts directly from Instagram API...');
  
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
 * Scrape candidate videos from Instagram
 */
async function scrapeInstagramVideos(settings) {
  console.log('🎯 [STEP 2] Scraping candidate videos from Instagram...');
  
  const { scrapeInstagramEngagement } = require('../utils/instagramScraper');
  
  // Scrape high-performing videos (limit to 500)
  const videos = await scrapeInstagramEngagement(
    settings.igBusinessId,
    settings.instagramToken,
    500
  );
  
  console.log(`✅ [STEP 2] Scraped ${videos.length} candidate videos`);
  return videos;
}

/**
 * Generate visual hash from video
 */
async function generateVisualHash(frame) {
  const { extractFirstFrameHash } = require('../utils/fingerprint');
  return await extractFirstFrameHash(frame);
}

/**
 * Extract first frame from video buffer
 */
async function extractFirstFrame(buffer) {
  // Simple implementation - use buffer directly as frame
  return buffer;
}

/**
 * Download video buffer from URL
 */
async function downloadVideoBuffer(videoUrl) {
  const { downloadInstagramVideo } = require('../utils/instagramScraper');
  return await downloadInstagramVideo(videoUrl);
}

/**
 * Compare durations with ±1 second tolerance
 */
function isDurationSimilar(a, b) {
  if (a == null || b == null) return false;
  return Math.abs(Math.round(a) - Math.round(b)) <= 1;
}

/**
 * Execute Post Now - Complete logic with smart candidate selection
 */
async function executePostNow(settings) {
  try {
    console.log('🚀 [POST NOW] Starting smart candidate selection (not always #1)...');

    // Use ActivityLog model for logging completed posts
    let ActivityLogModel;
    try {
      ActivityLogModel = mongoose.model('ActivityLog');
    } catch (error) {
      const activityLogSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
      ActivityLogModel = mongoose.model('ActivityLog', activityLogSchema, 'activitylogs');
    }

    //////////////////////////////////////////////////////////////
    // ✅ STEP 1: FETCH LAST 30 POSTS (FOR DUPLICATE CHECKING)
    //////////////////////////////////////////////////////////////

    const last30 = await fetchLast30InstagramPosts(settings); // [{ id, thumbnailUrl, caption, audioId, duration }]
    
    const last30Hashes = await Promise.all(
      last30.map(async (post) => {
        const buffer = await downloadVideoBuffer(post.url);
        const frame = await extractFirstFrame(buffer);
        return await generateVisualHash(frame);
      })
    );
    
    const last30Captions = last30.map(p => p.caption);
    const last30Durations = last30.map(p => p.duration);
    const last30AudioIds = last30.map(p => p.audioId).filter(Boolean);
    const last30Ids = last30.map(p => p.id);

    console.log(`✅ [STEP 1] Built blacklist: ${last30Hashes.length} hashes, ${last30Captions.length} captions, ${last30AudioIds.length} audio IDs`);

    //////////////////////////////////////////////////////
    // ✅ STEP 2: SCRAPE CANDIDATES, SORT BY ENGAGEMENT, FILTER DOWN  
    //////////////////////////////////////////////////////

    let candidates = await scrapeInstagramVideos(settings); // [{ id, videoUrl, caption, engagement, audioId, duration }]
    
    candidates = candidates
      .filter(v => v.engagement >= 10000) // ✅ Only use high-engagement
      .sort((a, b) => b.engagement - a.engagement); // ✅ Highest to lowest

    console.log(`✅ [STEP 2] Found ${candidates.length} high-engagement candidates`);

    //////////////////////////////////////////////////////////////////////////
    // ✅ STEP 3: Iterate and find the FIRST valid (not top 1 by default)
    //////////////////////////////////////////////////////////////////////////

    console.log('🔍 [STEP 3] Finding FIRST unique video (not always #1)...');
    let selectedVideo = null;
    let selectedHash = null;
    let selectedBuffer = null;

    for (const video of candidates) {
      console.log(`🔍 Checking video ${video.id} (engagement: ${video.engagement})...`);
      
      // ⛔ Skip if exact ID or duration already posted
      if (last30Ids.includes(video.id)) {
        console.log(`⛔ Skipping video ${video.id} - exact ID match`);
        continue;
      }
      if (last30Durations.some(d => isDurationSimilar(d, video.duration))) {
        console.log(`⛔ Skipping video ${video.id} - duration match (±1s)`);
        continue;
      }

      // Download only when cheap checks pass; prefer hashing from thumbnail URL to avoid full video in memory
      let hash;
      try {
        const { generateThumbnailHash } = require('../utils/instagramScraper');
        hash = await generateThumbnailHash(video.thumbnailUrl || video.url);
      } catch (_) {
        const buffer = await downloadVideoBuffer(video.url);
        const frame = await extractFirstFrame(buffer);
        hash = await generateVisualHash(frame);
      }

      const isDuplicateVisual = last30Hashes.includes(hash);
      const isDuplicateCaption = last30Captions.some(c => compareCaptionSimilarity(video.caption, c) > 0.9);
      const isDuplicateAudio = last30AudioIds.includes(video.audioId);

      if (isDuplicateVisual || isDuplicateCaption || isDuplicateAudio) {
        console.log(`⛔ Skipping duplicate video ${video.id} [Hash:${isDuplicateVisual} | Caption:${isDuplicateCaption} | Audio:${isDuplicateAudio}]`);
        continue; // ✅ Keep trying next-best
      }

      // ✅ This video passed all checks — it's unique
      selectedVideo = video;
      selectedHash = hash;
      // Defer downloading full video until after selection
      selectedBuffer = null;
      console.log(`✅ [STEP 3] Selected unique video: ${video.id} (may not be #1 engagement)`);
      break;
    }

    // 🧱 Failsafe
    if (!selectedVideo || !selectedBuffer) {
      console.log("❌ No unique video found after checking candidates.");
      return {
        success: false,
        error: 'No unique videos found',
        message: 'All candidates were duplicates of recent posts'
      };
    }

    ////////////////////////////////// 
    // ✅ STEP 4: UPLOAD TO S3
    //////////////////////////////////
    
    console.log('☁️ [STEP 4] Uploading to S3...');
    const { uploadBufferToS3, uploadUrlToS3 } = require('../utils/s3Uploader');
    const s3Key = `autopilot/manual/${Date.now()}_${Math.random().toString(36).substring(2, 8)}.mp4`;
    // Stream upload from source to minimize memory usage
    const s3Url = await uploadUrlToS3(selectedVideo.url, s3Key, 'video/mp4');
    console.log(`✅ [STEP 4] Uploaded to S3: ${s3Url}`);

    //////////////////////////////////
    // ✅ STEP 5: REWRITE CAPTION (NO DASHES)
    //////////////////////////////////
    
    console.log('✏️ [STEP 5] Generating smart caption...');
    const { generateSmartCaption } = require('./captionAI');
    let finalCaption = await generateSmartCaption(selectedVideo.caption, selectedVideo.engagement);
    finalCaption = finalCaption.replace(/[-–—]/g, "").trim(); // Remove dashes
    console.log(`✅ [STEP 5] Generated caption: ${finalCaption.substring(0, 100)}...`);

    //////////////////////////////////
    // ✅ STEP 6: POST TO INSTAGRAM
    //////////////////////////////////
    
    console.log('📱 [STEP 6] Posting to Instagram...');
    const { postToInstagram } = require('./instagramPoster');
    
    await postToInstagram({
      videoUrl: s3Url,
      caption: finalCaption,
      thumbnailUrl: s3Url,
      source: "manual"
    });
    
    console.log('✅ [STEP 6] Posted to Instagram successfully');

    //////////////////////////////////
    // ✅ STEP 7: LOG TO DATABASE ONLY
    //////////////////////////////////
    
    console.log('💾 [STEP 7] Logging to activitylogs...');
    await ActivityLogModel.create({
      platform: "instagram",
      source: "manual",
      originalVideoId: selectedVideo.id,
      videoUrl: s3Url,
      thumbnailUrl: s3Url,
      thumbnailHash: selectedHash,
      caption: finalCaption,
      engagement: selectedVideo.engagement,
      audioId: selectedVideo.audioId,
      duration: selectedVideo.duration,
      status: 'success',
      postedAt: new Date(),
    });

    console.log("✅ Posted next-best valid video (not always #1) to Instagram successfully.");

    return {
      success: true,
      status: "✅ Posted successfully with smart candidate selection",
      platform: "Instagram",
      thumbnailHash: selectedHash.substring(0, 12) + '...',
      audioId: selectedVideo.audioId ? selectedVideo.audioId.substring(0, 20) + '...' : 'none',
      s3Url: s3Url,
      videoId: selectedVideo.id,
      caption: finalCaption.substring(0, 100) + '...',
      candidateRank: 'First unique found (not always #1)',
      duplicateProtection: {
        visualHash: true,
        captionSimilarity: true,
        audioId: !!selectedVideo.audioId,
        duration: true,
        exactId: true
      }
    };

  } catch (error) {
    console.error('❌ [POST NOW ERROR]', error);
    throw error;
  }
}

module.exports = {
  executePostNow
};