// ✅ Instagram Scraper Service - Phase 9 AutoPilot System
const fetch = require('node-fetch');

/**
 * Scrapes latest Instagram videos using Graph API
 * @param {Object} Settings - Mongoose Settings model
 * @param {number} limit - Number of videos to fetch (default: 500)
 * @returns {Array} Array of video objects with engagement data
 */
async function scrapeLatestInstagramVideos(Settings, limit = 500) {
  try {
    console.log('🔄 [INSTAGRAM SCRAPER] Starting to scrape latest videos...');
    
    const settings = await Settings.findOne();
    if (!settings || !settings.instagramToken || !settings.igBusinessId) {
      throw new Error('Instagram credentials not found in settings');
    }

    const accessToken = settings.instagramToken;
    const businessAccountId = settings.igBusinessId;

    // Get media from Instagram Graph API
    const mediaUrl = `https://graph.facebook.com/v19.0/${businessAccountId}/media?fields=id,media_type,media_url,thumbnail_url,caption,timestamp,like_count,comments_count,permalink&access_token=${accessToken}&limit=${limit}`;
    
    console.log('📡 [INSTAGRAM SCRAPER] Fetching from Graph API...');
    const response = await fetch(mediaUrl);
    const data = await response.json();

    if (data.error) {
      throw new Error(`Instagram API Error: ${data.error.message}`);
    }

    // Filter for videos only and calculate engagement
    const videos = data.data
      .filter(item => item.media_type === 'VIDEO')
      .map(video => ({
        id: video.id,
        caption: video.caption || '',
        mediaUrl: video.media_url,
        thumbnailUrl: video.thumbnail_url,
        timestamp: video.timestamp,
        likeCount: video.like_count || 0,
        commentsCount: video.comments_count || 0,
        engagement: (video.like_count || 0) + (video.comments_count || 0) * 5, // Comments worth 5x likes
        permalink: video.permalink,
        downloadUrl: video.media_url // Direct download URL
      }))
      .sort((a, b) => b.engagement - a.engagement); // Sort by highest engagement

    console.log(`✅ [INSTAGRAM SCRAPER] Found ${videos.length} videos, top engagement: ${videos[0]?.engagement || 0}`);
    return videos;

  } catch (error) {
    console.error('❌ [INSTAGRAM SCRAPER ERROR]', error);
    throw error;
  }
}

/**
 * Gets last 30 autopilot posts to avoid duplicates
 * @param {string} platform - Platform to check (instagram/youtube)
 * @returns {Array} Array of recent post fingerprints
 */
async function getLast30AutopilotPosts(platform = 'instagram') {
  try {
    const { MongoClient } = require('mongodb');
    const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/lifestyle-design';
    const client = new MongoClient(mongoUrl);

    console.log(`🔍 [DUPLICATE CHECK] Checking last 30 ${platform} posts...`);
    
    try {
      await client.connect();
      const db = client.db();
      const queue = db.collection('autopilot_queue');
      
      // Get last 30 posts for this platform
      const recentPosts = await queue.find({
        platform: platform,
        autopilotGenerated: true,
        status: { $in: ['completed', 'scheduled', 'processing'] }
      })
      .sort({ createdAt: -1 })
      .limit(30)
      .toArray();

      console.log(`✅ [DUPLICATE CHECK] Found ${recentPosts.length} recent ${platform} posts`);
      return recentPosts;

    } finally {
      await client.close();
    }
  } catch (error) {
    console.error('❌ [DUPLICATE CHECK ERROR]', error);
    return [];
  }
}

/**
 * Generates content fingerprint to detect similar content
 * @param {Object} video - Video object
 * @returns {string} Unique fingerprint
 */
function generateContentFingerprint(video) {
  const caption = (video.caption || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const duration = video.duration || 0;
  return `${caption.substring(0, 50)}_${duration}`;
}

/**
 * Downloads Instagram media from direct URL
 * @param {string} mediaUrl - Direct media URL from Instagram
 * @returns {Buffer} File buffer
 */
async function downloadInstagramMedia(mediaUrl) {
  try {
    console.log('⬇️ [DOWNLOAD] Downloading Instagram video...');
    const response = await fetch(mediaUrl);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }
    const buffer = await response.buffer();
    console.log(`✅ [DOWNLOAD] Video downloaded (${buffer.length} bytes)`);
    return buffer;
  } catch (error) {
    console.error('❌ [DOWNLOAD ERROR]', error);
    throw error;
  }
}

module.exports = {
  scrapeLatestInstagramVideos,
  getLast30AutopilotPosts,
  generateContentFingerprint,
  downloadInstagramMedia
};