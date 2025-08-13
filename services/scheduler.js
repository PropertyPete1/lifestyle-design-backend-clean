// Runtime JS shim for executeQueueItemOnce to avoid requiring TypeScript at runtime
// Uses existing JS poster services to execute a single scheduled queue item

async function executeQueueItemOnce(queueItem, settings) {
  const platform = String(queueItem.platform || 'instagram').toLowerCase();
  const videoUrl = queueItem.videoUrl || queueItem.s3Url;
  const caption = queueItem.caption || '';
  if (!videoUrl) {
    throw new Error('Missing videoUrl');
  }

  if (platform === 'instagram') {
    const { postToInstagram } = require('./instagramPoster');
    const res = await postToInstagram({
      videoUrl,
      caption,
      thumbnailHash: queueItem.visualHash || queueItem.thumbnailHash || null,
      source: 'autopilot'
    });
    return {
      success: !!res?.success,
      externalPostId: res?.postId,
      note: res?.message || res?.error || null
    };
  }

  if (platform === 'youtube') {
    const { postToYouTube } = require('./youtubePoster');
    const res = await postToYouTube({
      videoUrl,
      caption,
      thumbnailHash: queueItem.visualHash || queueItem.thumbnailHash || null,
      source: 'autopilot'
    });
    return {
      success: !!res?.success,
      externalPostId: res?.postId,
      note: res?.message || res?.error || null
    };
  }

  return { success: false, note: 'unsupported-platform' };
}

module.exports = { executeQueueItemOnce };



