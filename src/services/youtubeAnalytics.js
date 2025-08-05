// ✅ YouTube Analytics Service - Phase 9 AutoPilot System with Token Refresh
let fetch;
try {
  fetch = require('node-fetch');
} catch (err) {
  // Custom HTTP client fallback for Render compatibility
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
      
      if (options.body) {
        req.write(options.body);
      }
      
      req.end();
    });
  };
}

/**
 * Refresh YouTube access token using refresh token
 * @param {Object} settings - Settings object with YouTube credentials
 * @returns {String} New access token
 */
async function refreshYouTubeToken(settings) {
  try {
    console.log('🔄 [YOUTUBE TOKEN] Refreshing access token...');
    
    if (!settings.youtubeRefreshToken || !settings.youtubeClientId || !settings.youtubeClientSecret) {
      throw new Error('Missing refresh token or client credentials');
    }

    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const params = new URLSearchParams({
      client_id: settings.youtubeClientId,
      client_secret: settings.youtubeClientSecret,
      refresh_token: settings.youtubeRefreshToken,
      grant_type: 'refresh_token'
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
    }

    const tokenData = await response.json();
    
    // Update the access token in MongoDB
    await settings.constructor.updateOne(
      { _id: settings._id },
      { youtubeAccessToken: tokenData.access_token }
    );

    console.log('✅ [YOUTUBE TOKEN] Access token refreshed successfully');
    return tokenData.access_token;

  } catch (error) {
    console.error('❌ [YOUTUBE TOKEN] Refresh failed:', error.message);
    throw error;
  }
}

/**
 * Fetches YouTube analytics data using YouTube Data API
 * @param {Object} settings - Settings object with YouTube credentials
 * @returns {Object} YouTube analytics data
 */
async function getYouTubeAnalytics(settings) {
  try {
    console.log('📺 [YT ANALYTICS] Fetching YouTube analytics...');

    if (!settings.youtubeAccessToken) {
      console.log('⚠️ [YT ANALYTICS] Missing YouTube credentials');
      console.log(`📋 [YT ANALYTICS] Have clientId: ${!!settings.youtubeClientId}, clientSecret: ${!!settings.youtubeClientSecret}, accessToken: ${!!settings.youtubeAccessToken}, refreshToken: ${!!settings.youtubeRefreshToken}`);
      return {
        error: 'YouTube credentials not configured',
        subscriberCount: 0,
        estimatedMinutesWatched: 0,
        views: 0,
        videoCount: 0
      };
    }

    let accessToken = settings.youtubeAccessToken;

    // Get channel statistics using "mine=true" instead of channelId to get authenticated user's channel
    const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&mine=true&access_token=${accessToken}`;
    
    console.log('🔗 [YT ANALYTICS] Calling API:', channelUrl.replace(accessToken, 'TOKEN_HIDDEN'));
    
    let channelResponse = await fetch(channelUrl);
    
    // If token expired (401), try to refresh it
    if (channelResponse.status === 401) {
      console.log('🔄 [YT ANALYTICS] Access token expired, attempting refresh...');
      try {
        accessToken = await refreshYouTubeToken(settings);
        // Retry with new token
        const newChannelUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&mine=true&access_token=${accessToken}`;
        channelResponse = await fetch(newChannelUrl);
      } catch (refreshError) {
        console.error('❌ [YT ANALYTICS] Token refresh failed:', refreshError.message);
        return {
          error: `YouTube API authentication failed: ${refreshError.message}`,
          subscriberCount: 0,
          estimatedMinutesWatched: 0,
          views: 0,
          videoCount: 0
        };
      }
    }
    
    if (!channelResponse.ok) {
      const errorText = await channelResponse.text();
      console.error('❌ [YT ANALYTICS] API Error:', channelResponse.status, errorText);
      return {
        error: `YouTube API error: ${channelResponse.status} - ${errorText}`,
        subscriberCount: 0,
        estimatedMinutesWatched: 0,
        views: 0,
        videoCount: 0
      };
    }
    
    const channelData = await channelResponse.json();
    console.log('📊 [YT ANALYTICS] Channel data:', channelData);

    if (!channelData.items || channelData.items.length === 0) {
      return {
        error: 'No YouTube channel found for authenticated user',
        subscriberCount: 0,
        estimatedMinutesWatched: 0,
        views: 0,
        videoCount: 0
      };
    }

    const channel = channelData.items[0];
    const stats = channel.statistics;
    const snippet = channel.snippet;
    
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

    // Get recent video analytics for watch time estimation using the channel ID from the authenticated response
    const channelId = channel.id;
    const videosUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&maxResults=10&order=date&type=video&access_token=${accessToken}`;
    
    let videosData = { items: [] };
    try {
      const videosResponse = await fetch(videosUrl);
      if (videosResponse.ok) {
        videosData = await videosResponse.json();
      }
    } catch (error) {
      console.warn('⚠️ [YT ANALYTICS] Failed to fetch recent videos:', error.message);
    }

    // Check if posted recently (last 7 days)
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const isPosting = videosData.items && videosData.items.some(video => 
      new Date(video.snippet.publishedAt) > oneWeekAgo
    );

    // Estimate watch time (approximate based on views)
    const estimatedMinutesWatched = Math.round((parseInt(stats.viewCount) || 0) * 2.5); // Average 2.5 min per view

    // Calculate engagement rate (simplified)
    const avgViews = parseInt(stats.viewCount) / parseInt(stats.videoCount);
    const engagementRate = parseInt(stats.subscriberCount) > 0 ? 
      (avgViews / parseInt(stats.subscriberCount) * 100) : 0;

    const analytics = {
      subscriberCount: parseInt(stats.subscriberCount) || 0,
      views: parseInt(stats.viewCount) || 0,
      videoCount: parseInt(stats.videoCount) || 0,
      estimatedMinutesWatched: estimatedMinutesWatched,
      recentVideos: videosData.items?.length || 0,
      channelTitle: snippet.title,
      channelId: channelId,
      engagement: Math.round(engagementRate * 100) / 100,
      avgViews: Math.round(avgViews),
      isPosting,
      lastUpdated: new Date().toISOString()
    };

    console.log(`✅ [YT ANALYTICS] Fetched: ${analytics.subscriberCount} subscribers, ${analytics.views.toLocaleString()} views for ${analytics.channelTitle}`);
    
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
  getYouTubeAnalytics,
  refreshYouTubeToken
};