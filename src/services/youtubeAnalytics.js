// ✅ YouTube Analytics Service - Phase 9 AutoPilot System
const fetch = require('node-fetch');

/**
 * Fetches YouTube analytics data using YouTube Data API
 * @param {Object} settings - Settings object with YouTube credentials
 * @returns {Object} YouTube analytics data
 */
async function getYouTubeAnalytics(settings) {
  try {
    console.log('📺 [YT ANALYTICS] Fetching YouTube analytics...');

    if (!settings.youtubeAccessToken || !settings.youtubeChannelId) {
      return {
        error: 'YouTube credentials not configured',
        subscriberCount: 0,
        estimatedMinutesWatched: 0,
        views: 0,
        videoCount: 0
      };
    }

    // Get channel statistics
    const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${settings.youtubeChannelId}&access_token=${settings.youtubeAccessToken}`;
    
    const channelResponse = await fetch(channelUrl);
    const channelData = await channelResponse.json();

    if (channelData.error) {
      console.warn('⚠️ [YT ANALYTICS] Channel API error:', channelData.error.message);
      return {
        error: channelData.error.message,
        subscriberCount: 0,
        estimatedMinutesWatched: 0,
        views: 0,
        videoCount: 0
      };
    }

    const stats = channelData.items?.[0]?.statistics;
    
    if (!stats) {
      console.warn('⚠️ [YT ANALYTICS] No statistics available');
      return {
        error: 'No statistics available',
        subscriberCount: 0,
        estimatedMinutesWatched: 0,
        views: 0,
        videoCount: 0
      };
    }

    // Get recent video analytics for watch time estimation
    const videosUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${settings.youtubeChannelId}&maxResults=10&order=date&type=video&access_token=${settings.youtubeAccessToken}`;
    
    const videosResponse = await fetch(videosUrl);
    const videosData = await videosResponse.json();

    // Estimate watch time (approximate based on views)
    const estimatedMinutesWatched = Math.round((parseInt(stats.viewCount) || 0) * 2.5); // Average 2.5 min per view

    const analytics = {
      subscriberCount: parseInt(stats.subscriberCount) || 0,
      views: parseInt(stats.viewCount) || 0,
      videoCount: parseInt(stats.videoCount) || 0,
      estimatedMinutesWatched: estimatedMinutesWatched,
      recentVideos: videosData.items?.length || 0
    };

    console.log(`✅ [YT ANALYTICS] Fetched: ${analytics.subscriberCount} subscribers, ${analytics.views.toLocaleString()} views`);
    
    return analytics;

  } catch (error) {
    console.error('❌ [YT ANALYTICS ERROR]', error);
    return {
      error: error.message,
      subscriberCount: 0,
      estimatedMinutesWatched: 0,
      views: 0,
      videoCount: 0
    };
  }
}

module.exports = {
  getYouTubeAnalytics
};