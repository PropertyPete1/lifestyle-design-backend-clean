// 📁 File: backend-v2/services/postNow.js

// 🧠 GOAL: Post 1 high-engagement video from Instagram using visual hash protection + caption fallback
// 🔁 Process is triggered manually via "Post Now" dashboard button

// 🔒 DO NOT:
// - Repost anything from the last 30 most recent posts
// - Use video ID as a filter (many videos have different IDs but same content)

// ✅ DO:
// SCRAPE → FILTER → DOWNLOAD → HASH → VALIDATE → S3 → CAPTION → POST → LOG

const stringSimilarity = require('string-similarity');
const mongoose = require('mongoose');

async function executePostNow(settings) {
  try {
    console.log('🚀 [POST NOW] Starting step-by-step process...');

    // Import required functions
    const { scrapeInstagramEngagement } = require('../utils/instagramScraper');
    const { uploadBufferToS3 } = require('../utils/s3Uploader');
    const { extractFirstFrameHash } = require('../utils/fingerprint');
    const { postToInstagram } = require('./instagramPoster');
    const { postToYouTube } = require('./youtubePoster');
    const { generateSmartCaptionWithKey } = require('./captionAI');
    const fetch = require('node-fetch');

    // --------------------------------------------
    // ✅ STEP 1: SCRAPE INSTAGRAM
    // - Use Instagram Graph API to fetch 500 latest video posts
    // - Extract engagement (likes + comments) for each video
    // - Sort by engagement DESC (highest to lowest)
    // --------------------------------------------
    console.log('📱 [STEP 1] Scraping Instagram videos...');
    const scrapedVideos = await scrapeInstagramEngagement(
      settings.igBusinessId,
      settings.instagramToken,
      500
    );
    
    if (scrapedVideos.length === 0) {
      throw new Error('No videos found from Instagram scraping');
    }

    const sortedVideos = scrapedVideos.sort((a, b) => b.engagement - a.engagement);
    console.log(`✅ [STEP 1] Scraped ${sortedVideos.length} videos, sorted by engagement`);

    // --------------------------------------------
    // ✅ STEP 2: FETCH LAST 30 POSTS FROM DB
    // - Pull last 30 posts from SchedulerQueueModel
    // - Extract their thumbnail hashes + captions
    // --------------------------------------------
    console.log('🗄️ [STEP 2] Fetching last 30 posts from database...');
    // Check if model already exists to avoid overwrite error
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

    const recentPosts = await SchedulerQueueModel.find({ 
      platform: "instagram", 
      status: "posted" 
    })
    .sort({ postedAt: -1 })
    .limit(30)
    .lean();

    const recentHashes = recentPosts.map(p => p.thumbnailHash).filter(Boolean);
    const recentCaptions = recentPosts.map(p => p.caption).filter(Boolean);

    console.log(`✅ [STEP 2] Found ${recentPosts.length} recent posts`);
    console.log(`📸 [STEP 2] ${recentHashes.length} hashes, ${recentCaptions.length} captions for filtering`);

    // --------------------------------------------
    // ✅ STEP 3: LOOP THROUGH SCRAPED VIDEOS
    // - For each video:
    //   1. Download
    //   2. Extract thumbnail (first frame)
    //   3. Generate visual hash
    //   4. Check for duplicate by hash and caption similarity
    // --------------------------------------------
    console.log('🔍 [STEP 3] Processing videos for uniqueness...');
    let selectedVideo = null;
    let selectedHash = null;
    let videoBuffer = null;

    for (const video of sortedVideos) {
      try {
        console.log(`🎬 [STEP 3] Processing video ${video.id} (engagement: ${video.engagement})...`);
        
        // Download video buffer
        const response = await fetch(video.url);
        videoBuffer = await response.buffer();
        
        // Generate visual hash from video buffer
        const thumbnailHash = await extractFirstFrameHash(videoBuffer);

        // Check hash duplicate
        const isHashDuplicate = recentHashes.includes(thumbnailHash);
        console.log(`📸 [HASH CHECK] ${thumbnailHash.substring(0, 12)}... - Duplicate: ${isHashDuplicate}`);

        // Check caption similarity
        const isCaptionDuplicate = recentCaptions.some(prevCaption => {
          const similarity = stringSimilarity.compareTwoStrings(
            (prevCaption || '').toLowerCase(),
            (video.caption || '').toLowerCase()
          );
          return similarity >= 0.85;
        });
        console.log(`📝 [CAPTION CHECK] Similarity check - Duplicate: ${isCaptionDuplicate}`);

        if (isHashDuplicate || isCaptionDuplicate) {
          console.log(`🚫 [DUPLICATE] Skipping video ${video.id} - hash or caption match`);
          continue;
        }

        // ✅ Unique video found!
        selectedVideo = video;
        selectedHash = thumbnailHash;
        console.log(`✅ [STEP 3] Selected unique video: ${video.id}`);
        break;

      } catch (error) {
        console.error(`❌ Error processing video ${video.id}:`, error.message);
        continue;
      }
    }

    if (!selectedVideo || !videoBuffer) {
      throw new Error("No unique videos found after filtering");
    }

    // --------------------------------------------
    // ✅ STEP 4: UPLOAD TO S3
    // - Upload selected video buffer to S3
    // - Use unique path like autopilot/manual/<timestamp>_<random>.mp4
    // --------------------------------------------
    console.log('☁️ [STEP 4] Uploading to S3...');
    const generateRandomId = () => Math.random().toString(36).substring(2, 8);
    const s3Key = `autopilot/manual/${Date.now()}_${generateRandomId()}.mp4`;
    const s3Url = await uploadBufferToS3(videoBuffer, s3Key, "video/mp4");
    console.log(`✅ [STEP 4] S3 upload successful: ${s3Url}`);

    // --------------------------------------------
    // ✅ STEP 5: GENERATE CAPTION (GPT or fallback)
    // --------------------------------------------
    console.log('✏️ [STEP 5] Generating smart caption...');
    let finalCaption = selectedVideo.caption || 'Posted via Post Now';
    
    try {
      if (settings.openaiApiKey) {
        finalCaption = await generateSmartCaptionWithKey(
          selectedVideo.caption, 
          settings.openaiApiKey
        );
        console.log(`✅ [STEP 5] AI caption generated: ${finalCaption.substring(0, 50)}...`);
      } else {
        console.log(`📝 [STEP 5] Using original caption (no OpenAI key)`);
      }
    } catch (captionError) {
      console.log(`⚠️ [STEP 5] Caption generation failed, using original: ${captionError.message}`);
    }

    // --------------------------------------------
    // ✅ STEP 6: POST TO INSTAGRAM (and/or YouTube)
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

    // Optional YouTube Upload
    let youtubeResult = { success: true };
    if (settings.autoPostToYouTube) {
      console.log('🎥 [STEP 6] Posting to YouTube...');
      youtubeResult = await postToYouTube({
        videoUrl: s3Url,
        caption: finalCaption,
        thumbnailHash: selectedHash,
        source: "manual"
      });
      console.log(`✅ [STEP 6] YouTube post: ${youtubeResult.success ? 'Success' : 'Failed'}`);
    }

    // --------------------------------------------
    // ✅ STEP 7: LOG TO MONGODB
    // --------------------------------------------
    console.log('💾 [STEP 7] Saving to MongoDB...');
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

    console.log("✅ [POST NOW] Completed unique post to Instagram with full step-by-step flow");

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