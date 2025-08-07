/**
 * Post History Utility - Track posted videos to avoid duplicates
 * Fetches last 30 posts directly from Instagram API for accurate duplicate detection
 */

const fetch = require('node-fetch');
const { generateThumbnailHash } = require('./instagramScraper');

/**
 * Get last 30 posted videos directly from Instagram API
 * @param {Object} settings - User settings with Instagram credentials
 * @returns {Promise<Array>} Array of last 30 Instagram posts with visual hashes
 */
async function getLast30InstagramPosts(settings) {
  try {
    console.log(`📱 [INSTAGRAM API] Fetching last 30 posts from your Instagram account...`);
    
    // Validate Instagram credentials
    if (!settings.igBusinessId || !settings.instagramToken) {
      console.error('❌ [INSTAGRAM API] Missing credentials - igBusinessId or instagramToken not found');
      return [];
    }
    
    const mediaUrl = `https://graph.facebook.com/v19.0/${settings.igBusinessId}/media?fields=id,media_type,media_url,thumbnail_url,caption,timestamp,permalink&limit=30&access_token=${settings.instagramToken}`;
    
    const response = await fetch(mediaUrl);
    const data = await response.json();
    
    if (!response.ok) {
      console.error('❌ [INSTAGRAM API] HTTP Error:', response.status, response.statusText);
      console.error('❌ [INSTAGRAM API] Response:', data);
      console.error('❌ [INSTAGRAM API] URL:', mediaUrl.replace(settings.instagramToken, 'TOKEN_HIDDEN'));
      return [];
    }
    
    console.log(`📱 [INSTAGRAM API] Found ${data.data.length} recent posts`);
    
    // Generate visual hashes for each post
    const postsWithHashes = [];
    for (const post of data.data) {
      if (post.media_type === 'VIDEO' && post.thumbnail_url) {
        try {
          const thumbnailHash = await generateThumbnailHash(post.thumbnail_url);
          const crypto = require('crypto');
          const caption = post.caption || '';
          const fingerprint = crypto.createHash('md5').update(`${caption.toLowerCase().trim()}|${post.thumbnail_url}`).digest('hex');
          
          postsWithHashes.push({
            id: post.id,
            thumbnailHash,
            fingerprint,
            caption,
            timestamp: post.timestamp,
            permalink: post.permalink
          });
        } catch (error) {
          console.log(`⚠️ [HASH] Skipping post ${post.id} - hash generation failed:`, error.message);
        }
      }
    }
    
    console.log(`📱 [INSTAGRAM API] Generated hashes for ${postsWithHashes.length} video posts`);
    console.log(`📊 [DEBUG] Instagram posts found: ${postsWithHashes.length} videos with fingerprints`);
    return postsWithHashes;
    
  } catch (error) {
    console.error('❌ [INSTAGRAM API ERROR]', error);
    return [];
  }
}

/**
 * Get last 30 posted videos for platform (FALLBACK: Database method)
 * @param {string} platform - Platform name (instagram/youtube)
 * @param {Object} SchedulerQueueModel - Mongoose model for scheduler queue
 * @returns {Promise<Array>} Array of last 30 posted videos
 */
async function getLast30PostedVideos(platform, SchedulerQueueModel) {
  try {
    console.log(`📚 [POST HISTORY] Getting last 30 posted videos for ${platform}`);
    
    const postedVideos = await SchedulerQueueModel
      .find({ 
        platform: platform,
        $or: [
          { status: 'posted' },
          { status: 'completed' } // Include old posts marked as 'completed' before the fix
        ]
      })
      .sort({ postedAt: -1 }) // Most recent first
      .limit(30)
      .select('fingerprint thumbnailHash caption originalVideoId')
      .exec();
    
    console.log(`📚 [POST HISTORY] Found ${postedVideos.length} posted videos`);
    return postedVideos;
    
  } catch (error) {
    console.error('❌ [POST HISTORY ERROR]', error);
    return [];
  }
}

/**
 * Check if video was already posted (by fingerprint)
 * @param {string} fingerprint - Video fingerprint
 * @param {Array} postedVideos - Array of posted videos
 * @returns {boolean} True if already posted
 */
function isAlreadyPosted(fingerprint, postedVideos) {
  return postedVideos.some(posted => posted.fingerprint === fingerprint);
}

/**
 * Check if video looks similar to recent posts
 * @param {Object} video - Video object with thumbnailHash and caption
 * @param {Array} postedVideos - Array of posted videos
 * @returns {boolean} True if looks similar
 */
function looksSimilar(video, postedVideos) {
  return postedVideos.some(posted => {
    // ✅ PRIORITY CHECK: Visual thumbnail similarity (now robust to lighting changes)
    if (posted.thumbnailHash === video.thumbnailHash) {
      console.log(`🚫 [DUPLICATE] Visually similar thumbnail detected: ${video.id}`);
      return true;
    }
    
    // Check caption similarity (exact match for now)
    if (posted.caption && video.caption && 
        posted.caption.toLowerCase().trim() === video.caption.toLowerCase().trim()) {
      console.log(`🚫 [DUPLICATE] Same caption detected: ${video.id}`);
      return true;
    }
    
    return false;
  });
}

/**
 * Filter out duplicate and similar videos
 * @param {Array} scrapedVideos - Scraped videos array
 * @param {Array} postedVideos - Posted videos array
 * @returns {Array} Filtered unique videos
 */
function filterUniqueVideos(scrapedVideos, postedVideos) {
  console.log(`🔍 [FILTER] Filtering ${scrapedVideos.length} scraped videos against ${postedVideos.length} posted videos`);
  
  const uniqueVideos = scrapedVideos.filter(video => {
    // Skip if already posted
    if (isAlreadyPosted(video.fingerprint, postedVideos)) {
      console.log(`⏭️ [FILTER] Skipping already posted: ${video.id}`);
      return false;
    }
    
    // Skip if looks similar
    if (looksSimilar(video, postedVideos)) {
      console.log(`⏭️ [FILTER] Skipping similar video: ${video.id}`);
      return false;
    }
    
    return true;
  });
  
  console.log(`✅ [FILTER] ${uniqueVideos.length} unique videos remaining`);
  return uniqueVideos;
}

/**
 * Log posted video to history (called after successful post)
 * @param {Object} videoData - Posted video data
 * @param {Object} SchedulerQueueModel - Mongoose model
 * @returns {Promise<void>}
 */
async function logPostedVideo(videoData, SchedulerQueueModel) {
  try {
    console.log('📝 [POST HISTORY] Logging posted video to history');
    
    await SchedulerQueueModel.updateOne(
      { _id: videoData._id },
      { 
        $set: { 
          status: 'posted',
          postedAt: new Date(),
          fingerprint: videoData.fingerprint,
          thumbnailHash: videoData.thumbnailHash
        }
      }
    );
    
    console.log('✅ [POST HISTORY] Video logged successfully');
    
  } catch (error) {
    console.error('❌ [POST HISTORY LOG ERROR]', error);
  }
}

module.exports = {
  getLast30InstagramPosts,
  getLast30PostedVideos,
  isAlreadyPosted,
  looksSimilar,
  filterUniqueVideos
};
