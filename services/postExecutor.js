/**
 * Execute a scheduled post for a given queue item
 * Uses existing Instagram and YouTube posting services
 */

// Idempotent execute via TypeScript scheduler wrapper
let executeQueueItemOnce;
try {
  executeQueueItemOnce = require('./scheduler').executeQueueItemOnce;
} catch (_) {
  // Fallback will be resolved when ts-node/register is active
  executeQueueItemOnce = require('./scheduler').executeQueueItemOnce;
}

/**
 * @param {Object} queueItem - Scheduled post from SchedulerQueue
 * @param {Object} settings - Settings document with credentials
 * @returns {Promise<{success:boolean, platform:string, postId?:string, url?:string, error?:string}>}
 */
async function executeScheduledPost(queueItem, settings) {
  const videoUrl = queueItem.videoUrl || queueItem.s3Url;
  const caption = queueItem.caption || '';
  const platform = queueItem.platform;

  if (!videoUrl) {
    return { success: false, platform, error: 'Missing videoUrl for scheduled post' };
  }

  // Use exactly-once wrapper for both platforms
  const result = await executeQueueItemOnce(queueItem, settings);
  if (result.success) {
    return { success: true, platform, postId: result.externalPostId, url: undefined };
  }
  if (result.deduped) {
    return { success: true, platform, postId: result.externalPostId, url: undefined };
  }
  return { success: false, platform, error: result.note || 'post failed' };

  return { success: false, platform, error: `Unsupported platform: ${platform}` };
}

module.exports = { executeScheduledPost };

