/**
 * Post History Utility - Track posted videos to avoid duplicates
 * Maintains history of last 30 posted videos per platform
 */

/**
 * Get last 30 posted videos for platform
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
        status: 'posted' // Only get successfully posted videos
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
    // Check thumbnail similarity
    if (posted.thumbnailHash === video.thumbnailHash) {
      return true;
    }
    
    // Check caption similarity (exact match for now)
    if (posted.caption && video.caption && 
        posted.caption.toLowerCase().trim() === video.caption.toLowerCase().trim()) {
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
  getLast30PostedVideos,
  isAlreadyPosted,
  looksSimilar,
  filterUniqueVideos,
  logPostedVideo
};
 * Post History Utility - Track posted videos to avoid duplicates
 * Maintains history of last 30 posted videos per platform
 */

/**
 * Get last 30 posted videos for platform
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
        status: 'posted' // Only get successfully posted videos
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
    // Check thumbnail similarity
    if (posted.thumbnailHash === video.thumbnailHash) {
      return true;
    }
    
    // Check caption similarity (exact match for now)
    if (posted.caption && video.caption && 
        posted.caption.toLowerCase().trim() === video.caption.toLowerCase().trim()) {
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
  getLast30PostedVideos,
  isAlreadyPosted,
  looksSimilar,
  filterUniqueVideos,
  logPostedVideo
};