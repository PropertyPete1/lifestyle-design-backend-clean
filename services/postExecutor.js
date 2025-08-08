/**
 * Execute a scheduled post for a given queue item
 * Uses existing Instagram and YouTube posting services
 */

const { postToInstagram } = require('./instagramPoster');
const { postToYouTube } = require('./youtubePoster');

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

  if (platform === 'instagram') {
    const result = await postToInstagram({
      videoUrl,
      caption,
      source: 'autopilot'
    });
    return result;
  }

  if (platform === 'youtube') {
    const result = await postToYouTube({
      videoUrl,
      caption,
      source: 'autopilot'
    });
    return result;
  }

  return { success: false, platform, error: `Unsupported platform: ${platform}` };
}

module.exports = { executeScheduledPost };

