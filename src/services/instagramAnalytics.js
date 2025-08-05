// ✅ Instagram Analytics Service - Phase 9 AutoPilot System
let fetch;
try {
  fetch = require('node-fetch');
} catch (err) {
  // Fallback to axios for Render compatibility
  const axios = require('axios');
  fetch = async (url, options = {}) => {
    const config = {
      url,
      method: options.method || 'GET',
      headers: options.headers || {},
      data: options.body
    };
    const response = await axios(config);
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.data
    };
  };
}

/**
 * Fetches Instagram analytics data using Graph API
 * @param {Object} settings - Settings object with Instagram credentials
 * @returns {Object} Instagram analytics data
 */
async function getInstagramAnalytics(settings) {
  try {
    console.log('📊 [IG ANALYTICS] Fetching Instagram analytics...');

    if (!settings.instagramToken || !settings.igBusinessId) {
      return {
        error: 'Instagram credentials not configured',
        followers_count: 0,
        engagement_rate: 0,
        reach: 0,
        media_count: 0
      };
    }

    // Get account insights
    const accountUrl = `https://graph.facebook.com/v19.0/${settings.igBusinessId}?fields=followers_count,media_count&access_token=${settings.instagramToken}`;
    
    const accountResponse = await fetch(accountUrl);
    const accountData = await accountResponse.json();

    if (accountData.error) {
      console.warn('⚠️ [IG ANALYTICS] Account API error:', accountData.error.message);
      return {
        error: accountData.error.message,
        followers_count: 0,
        engagement_rate: 0,
        reach: 0,
        media_count: 0
      };
    }

    // Get recent media insights for engagement calculation
    const mediaUrl = `https://graph.facebook.com/v19.0/${settings.igBusinessId}/media?fields=like_count,comments_count&limit=10&access_token=${settings.instagramToken}`;
    
    const mediaResponse = await fetch(mediaUrl);
    const mediaData = await mediaResponse.json();

    let totalEngagement = 0;
    let mediaCount = 0;

    if (mediaData.data && mediaData.data.length > 0) {
      mediaData.data.forEach(post => {
        totalEngagement += (post.like_count || 0) + (post.comments_count || 0) * 2;
        mediaCount++;
      });
    }

    // Calculate engagement rate
    const avgEngagementPerPost = mediaCount > 0 ? totalEngagement / mediaCount : 0;
    const engagementRate = accountData.followers_count > 0 
      ? avgEngagementPerPost / accountData.followers_count 
      : 0;

    const analytics = {
      followers_count: accountData.followers_count || 0,
      media_count: accountData.media_count || 0,
      engagement_rate: engagementRate,
      reach: Math.round(avgEngagementPerPost * 10), // Estimated reach
      total_engagement: totalEngagement
    };

    console.log(`✅ [IG ANALYTICS] Fetched: ${analytics.followers_count} followers, ${(analytics.engagement_rate * 100).toFixed(1)}% engagement`);
    
    return analytics;

  } catch (error) {
    console.error('❌ [IG ANALYTICS ERROR]', error);
    return {
      error: error.message,
      followers_count: 0,
      engagement_rate: 0,
      reach: 0,
      media_count: 0
    };
  }
}

module.exports = {
  getInstagramAnalytics
};