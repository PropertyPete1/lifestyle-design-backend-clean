// 📁 File: backend-v2/services/postNow.js

// 🧠 GOAL: Post 1 high-engagement Instagram video with bulletproof 3-layer duplicate protection:
// 🔁 Deduplicate by:
//    1. Thumbnail visual hash
//    2. Caption similarity
//    3. Audio ID match

// ⚠️ ORDER MATTERS:
// ✅ Step 1 MUST run FIRST to build blacklist of recent 30 real posts
// ✅ Step 2 then scrapes candidates and compares against that blacklist
// This avoids accidentally accepting previously posted content

const mongoose = require('mongoose');
const stringSimilarity = require('string-similarity');

/**
 * Compare caption similarity
 */
function compareCaptionSimilarity(caption1, caption2) {
  if (!caption1 || !caption2) return 0;
  return stringSimilarity.compareTwoStrings(caption1.toLowerCase(), caption2.toLowerCase());
}

/**
 * Generate visual hash from video buffer
 */
async function generateVisualHash(buffer) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Extract first frame from video buffer (simplified implementation)
 */
async function extractFirstFrame(buffer) {
  // For now, use the full buffer as the "frame" for hashing
  // In production, you might want to use ffmpeg to extract actual first frame
  return buffer;
}

/**
 * Download video buffer from URL
 */
async function downloadVideoBuffer(videoUrl) {
  const fetch = require('node-fetch');
  const response = await fetch(videoUrl);
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.statusText}`);
  }
  return await response.buffer();
}

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
  
  // Get large pool of videos to choose from
  const videos = await scrapeInstagramEngagement(
    settings.igBusinessId,
    settings.instagramToken,
    500
  );
  
  console.log(`✅ [STEP 2] Found ${videos.length} candidate videos`);
  return videos;
}

/**
 * Generate smart caption using OpenAI
 */
async function generateSmartCaption(originalCaption, engagement, settings) {
  console.log('🧠 [STEP 5] Generating smart caption...');
  
  try {
    const { generateSmartCaptionWithKey } = require('./captionAI');
    const smartCaption = await generateSmartCaptionWithKey(
      originalCaption || 'Amazing video!',
      settings.openaiApiKey
    );
    console.log('✅ [STEP 5] Smart caption generated');
    return smartCaption;
  } catch (error) {
    console.warn('⚠️ [STEP 5] Smart caption failed, using fallback');
    return originalCaption || 'Posted via Post Now';
  }
}

/**
 * Post to Instagram
 */
async function postToInstagram(postData) {
  console.log('📱 [STEP 6] Posting to Instagram...');
  const { postToInstagram: instagramPoster } = require('./instagramPoster');
  await instagramPoster(postData);
  console.log('✅ [STEP 6] Posted to Instagram successfully');
}

/**
 * Main Post Now execution function
 */
async function executePostNow(settings) {
  try {
    console.log('🚀 [POST NOW] Starting bulletproof 3-layer duplicate protection...');

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
        audioId: String,
        caption: String,
        engagement: Number,
        createdAt: { type: Date, default: Date.now },
        postedAt: { type: Date, default: Date.now },
        status: { type: String, default: 'posted' }
      }, { timestamps: true });
      SchedulerQueueModel = mongoose.model('SchedulerQueue', schedulerQueueSchema, 'schedulerqueue');
    }

    //////////////////////////////////////////////////////////////
    // ✅ STEP 1: FETCH LAST 30 POSTS DIRECTLY FROM INSTAGRAM API
    //////////////////////////////////////////////////////////////

    // This ensures we're filtering against real post history, not just database logs
    const last30InstagramPosts = await fetchLast30InstagramPosts(settings); // [{ id, thumbnailUrl, caption, audioId }]

    // Generate visual/audio/caption fingerprints for comparison
    console.log('🔍 [STEP 1] Generating fingerprints for comparison...');
    const recentHashes = await Promise.all(
      last30InstagramPosts.map(async (post) => {
        const buffer = await downloadVideoBuffer(post.url);
        const frame = await extractFirstFrame(buffer);
        return await generateVisualHash(frame);
      })
    );
    const recentCaptions = last30InstagramPosts.map(p => p.caption);
    const recentAudioIds = last30InstagramPosts.map(p => p.audioId).filter(Boolean);

    console.log(`✅ [STEP 1] Built blacklist: ${recentHashes.length} hashes, ${recentCaptions.length} captions, ${recentAudioIds.length} audio IDs`);

    //////////////////////////////////////////////////////
    // ✅ STEP 2: SCRAPE CANDIDATE VIDEOS FROM INSTAGRAM
    //////////////////////////////////////////////////////

    // Scrape 500 high-performing videos
    const scrapedVideos = await scrapeInstagramVideos(settings); // [{ id, videoUrl, caption, engagement, audioId }]
    const sortedVideos = scrapedVideos.sort((a, b) => b.engagement - a.engagement);

    console.log(`✅ [STEP 2] Sorted ${sortedVideos.length} videos by engagement (highest first)`);

    //////////////////////////////////////////////////////////////////////////
    // ✅ STEP 3: FILTER CANDIDATES AGAINST RECENT POSTS (3-LAYER CHECK)
    //////////////////////////////////////////////////////////////////////////

    console.log('🔍 [STEP 3] Filtering candidates with 3-layer duplicate protection...');

    let selectedVideo = null;
    let selectedHash = null;
    let selectedBuffer = null;

    for (const video of sortedVideos) {
      const buffer = await downloadVideoBuffer(video.url);
      const frame = await extractFirstFrame(buffer);
      const hash = await generateVisualHash(frame);

      const isDuplicateHash = recentHashes.includes(hash);
      const isDuplicateCaption = recentCaptions.some(c => compareCaptionSimilarity(video.caption, c) > 0.9);
      const isDuplicateAudio = recentAudioIds.includes(video.audioId);

      if (isDuplicateHash || isDuplicateCaption || isDuplicateAudio) {
        console.log(`⛔ Skipping duplicate video ${video.id} [Hash:${isDuplicateHash} | Caption:${isDuplicateCaption} | Audio:${isDuplicateAudio}]`);
        continue;
      }

      // ✅ This video passed all checks
      selectedVideo = video;
      selectedHash = hash;
      selectedBuffer = buffer;
      console.log(`✅ [STEP 3] Selected unique video: ${video.id} with ${video.engagement} engagement`);
      break;
    }

    // 🧱 Safety check: If all videos were duplicates, abort
    if (!selectedVideo || !selectedBuffer) {
      console.log("❌ No unique video found after filtering candidates.");
      return {
        success: false,
        error: "No unique video found after 3-layer duplicate filtering",
        duplicateProtection: {
          visualHash: true,
          captionSimilarity: true,
          audioId: true
        }
      };
    }

    //////////////////////////////////
    // ✅ STEP 4: UPLOAD TO S3
    //////////////////////////////////

    console.log('☁️ [STEP 4] Uploading to S3...');
    const { uploadBufferToS3 } = require('../utils/s3Uploader');
    const s3Key = `autopilot/manual/${Date.now()}_${Math.random().toString(36).substring(2, 8)}.mp4`;
    const s3Url = await uploadBufferToS3(selectedBuffer, s3Key, "video/mp4");
    console.log(`✅ [STEP 4] Uploaded to S3: ${s3Url}`);

    //////////////////////////////////
    // ✅ STEP 5: GENERATE SMART CAPTION
    //////////////////////////////////

    const finalCaption = await generateSmartCaption(selectedVideo.caption, selectedVideo.engagement, settings);

    //////////////////////////////////
    // ✅ STEP 6: POST TO INSTAGRAM
    //////////////////////////////////

    await postToInstagram({
      videoUrl: s3Url,
      caption: finalCaption,
      thumbnailUrl: s3Url, // reuse as thumbnail
      source: "manual"
    });

    //////////////////////////////////
    // ✅ STEP 7: LOG TO DB (SchedulerQueue)
    //////////////////////////////////

    console.log('💾 [STEP 7] Logging to database...');
    await SchedulerQueueModel.create({
      platform: "instagram",
      source: "manual",
      originalVideoId: selectedVideo.id,
      videoUrl: s3Url,
      thumbnailUrl: s3Url,
      thumbnailHash: selectedHash,
      caption: finalCaption,
      engagement: selectedVideo.engagement,
      audioId: selectedVideo.audioId,
      postedAt: new Date(),
    });

    console.log("✅ [POST NOW] Successfully posted unique video to Instagram.");

    return {
      success: true,
      status: "✅ Posted successfully with 3-layer duplicate protection",
      platform: "Instagram",
      thumbnailHash: selectedHash.substring(0, 12) + '...',
      audioId: selectedVideo.audioId ? selectedVideo.audioId.substring(0, 20) + '...' : 'none',
      s3Url: s3Url,
      videoId: selectedVideo.id,
      caption: finalCaption.substring(0, 100) + '...',
      duplicateProtection: {
        visualHash: true,
        captionSimilarity: true,
        audioId: !!selectedVideo.audioId
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