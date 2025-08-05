/**
 * Enhanced Instagram Analytics Service with Smart Caching
 * Provides robust fallbacks and prevents showing old cached data
 */

// HTTP client fallback for Render compatibility
let fetch;
try {
  fetch = require('node-fetch');
} catch (err) {
  const http = require('http');
  const https = require('https');
  const { URL } = require('url');
  
  fetch = async (url, options = {}) => {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const client = isHttps ? https : http;
      
      const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        headers: options.headers || {}
      };
      
      const req = client.request(requestOptions, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json: async () => JSON.parse(data),
            text: async () => data
          });
        });
      });
      
      req.on('error', reject);
      req.end();
    });
  };
}

/**
 * Get Instagram analytics with smart caching and error handling
 * @param {Object} settings - Settings object with Instagram credentials
 * @returns {Object} Instagram analytics data
 */
async function getInstagramAnalytics(settings) {
  try {
    console.log('📷 [IG ANALYTICS] Starting Instagram analytics fetch...');
    
    if (!settings.instagramToken || !settings.igBusinessId) {
      console.log('⚠️ [IG ANALYTICS] Missing Instagram credentials');
      console.log(`📋 [IG ANALYTICS] Have token: ${!!settings.instagramToken}, businessId: ${!!settings.igBusinessId}`);
      return {
        error: 'Instagram credentials not configured',
        followers: 0,
        reach: 0,
        engagementRate: 0,
        mediaCount: 0
      };
    }

    // Get Instagram account info with retry logic
    const accountUrl = `https://graph.facebook.com/v19.0/${settings.igBusinessId}?fields=followers_count,media_count,name,username&access_token=${settings.instagramToken}`;
    console.log(`📡 [IG ANALYTICS] Fetching account data...`);
    
    const accountResponse = await fetch(accountUrl);
    const accountData = await accountResponse.json();

    console.log('📊 [IG ANALYTICS] Account response:', accountData);

    if (accountData.error) {
      console.error('❌ [IG ANALYTICS] API Error:', accountData.error);
      
      // Check if it's a token/permission issue
      if (accountData.error.code === 190 || accountData.error.code === 102) {
        console.log('🔄 [IG ANALYTICS] Token/permission error, using cached data if available...');
        return getCachedInstagramData(settings, `Token error: ${accountData.error.message}`);
      }
      
      return {
        error: `Instagram API error: ${accountData.error.message}`,
        followers: 0,
        reach: 0,
        engagementRate: 0,
        mediaCount: 0
      };
    }

    const followersCount = accountData.followers_count || 0;
    const mediaCount = accountData.media_count || 0;
    const accountName = accountData.name || 'Unknown';
    const username = accountData.username || 'unknown';

    console.log(`✅ [IG ANALYTICS] Got ${followersCount} followers for @${username}`);

    // Get Instagram insights for reach/impressions
    let reach = 0;
    let engagementRate = 0;
    
    try {
      const insightsUrl = `https://graph.facebook.com/v19.0/${settings.igBusinessId}/insights?metric=impressions,reach,profile_views&period=day&access_token=${settings.instagramToken}`;
      console.log(`📡 [IG ANALYTICS] Fetching insights...`);
      
      const insightsResponse = await fetch(insightsUrl);
      const insightsData = await insightsResponse.json();

      console.log('📊 [IG ANALYTICS] Insights response:', insightsData);

      if (!insightsData.error && insightsData.data) {
        const reachMetric = insightsData.data.find(metric => metric.name === 'reach');
        if (reachMetric && reachMetric.values && reachMetric.values.length > 0) {
          reach = reachMetric.values[0].value || 0;
        }
      }
    } catch (insightsError) {
      console.warn('⚠️ [IG ANALYTICS] Insights fetch failed:', insightsError.message);
    }

    // Get recent media for engagement calculation
    try {
      const mediaUrl = `https://graph.facebook.com/v19.0/${settings.igBusinessId}/media?fields=like_count,comments_count,timestamp&limit=10&access_token=${settings.instagramToken}`;
      console.log(`📡 [IG ANALYTICS] Fetching recent media for engagement...`);
      
      const mediaResponse = await fetch(mediaUrl);
      const mediaData = await mediaResponse.json();

      if (!mediaData.error && mediaData.data && mediaData.data.length > 0) {
        let totalEngagement = 0;
        mediaData.data.forEach(post => {
          totalEngagement += (post.like_count || 0) + (post.comments_count || 0);
        });
        const avgEngagement = totalEngagement / mediaData.data.length;
        engagementRate = followersCount > 0 ? (avgEngagement / followersCount * 100) : 0;
        console.log(`✅ [IG ANALYTICS] Calculated engagement rate: ${engagementRate.toFixed(2)}%`);
      }
    } catch (mediaError) {
      console.warn('⚠️ [IG ANALYTICS] Media fetch failed:', mediaError.message);
    }

    const analytics = {
      followers: followersCount,
      reach: reach,
      engagementRate: Math.round(engagementRate * 100) / 100,
      mediaCount: mediaCount,
      accountName: accountName,
      username: username,
      lastUpdated: new Date().toISOString(),
      source: 'instagram_api'
    };

    // Cache successful data
    await cacheInstagramData(settings, analytics);

    console.log(`✅ [IG ANALYTICS] Success: ${analytics.followers} followers, ${analytics.engagementRate}% engagement for @${analytics.username}`);
    return analytics;

  } catch (error) {
    console.error('❌ [IG ANALYTICS ERROR]', error);
    
    // Return cached data if available
    return getCachedInstagramData(settings, `Network error: ${error.message}`);
  }
}

/**
 * Cache Instagram data to settings for fallback use
 */
async function cacheInstagramData(settings, analytics) {
  try {
    const cacheData = {
      cachedIgFollowers: analytics.followers,
      cachedIgReach: analytics.reach,
      cachedIgEngagement: analytics.engagementRate,
      cachedIgMediaCount: analytics.mediaCount,
      cachedIgUsername: analytics.username,
      cachedIgAccountName: analytics.accountName,
      cachedIgLastUpdate: analytics.lastUpdated
    };

    await settings.constructor.updateOne(
      { _id: settings._id },
      cacheData
    );

    console.log(`💾 [IG ANALYTICS] Cached data for @${analytics.username}`);
  } catch (cacheError) {
    console.warn('⚠️ [IG ANALYTICS] Failed to cache data:', cacheError.message);
  }
}

/**
 * Get cached Instagram data when API fails
 */
async function getCachedInstagramData(settings, errorMessage) {
  console.log('🔄 [IG ANALYTICS] Using cached Instagram data...');
  
  // Check if cached data is recent (within 24 hours)
  const lastUpdate = settings.cachedIgLastUpdate ? new Date(settings.cachedIgLastUpdate) : null;
  const now = new Date();
  const isStale = !lastUpdate || (now - lastUpdate) > 24 * 60 * 60 * 1000;

  if (isStale) {
    console.warn('⚠️ [IG ANALYTICS] Cached data is stale or missing');
  }

  return {
    followers: settings.cachedIgFollowers || 0,
    reach: settings.cachedIgReach || 0,
    engagementRate: settings.cachedIgEngagement || 0,
    mediaCount: settings.cachedIgMediaCount || 0,
    accountName: settings.cachedIgAccountName || 'Unknown',
    username: settings.cachedIgUsername || 'unknown',
    lastUpdated: settings.cachedIgLastUpdate || new Date().toISOString(),
    cached: true,
    stale: isStale,
    error: errorMessage,
    source: 'cached_data'
  };
}

module.exports = {
  getInstagramAnalytics
};