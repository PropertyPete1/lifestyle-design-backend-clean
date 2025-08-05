/**
 * YouTube Analytics Service
 * Fetches real YouTube analytics data using YouTube Data API v3
 * Includes OAuth2 token refresh functionality
 */

class YouTubeAnalyticsService {
  
  /**
   * Get YouTube analytics data using YouTube Data API v3
   */
  static async getAnalytics(settings) {
    console.log('🔍 [YOUTUBE ANALYTICS] Starting analytics fetch...');
    
    if (!settings.youtubeToken || !settings.youtubeChannelId) {
      console.error('❌ [YOUTUBE ANALYTICS] Missing required tokens - youtubeToken or youtubeChannelId');
      throw new Error('YouTube credentials not configured');
    }

    try {
      // Try to get channel data first
      let channelData;
      let accessToken = settings.youtubeToken;
      
      try {
        channelData = await this.getChannelData(accessToken, settings.youtubeChannelId);
      } catch (error) {
        // If we get a 403 error, try to refresh the token
        if (error.message.includes('403') || error.message.includes('401')) {
          console.log('🔄 [YOUTUBE ANALYTICS] Token expired, attempting refresh...');
          accessToken = await this.refreshAccessToken(settings);
          channelData = await this.getChannelData(accessToken, settings.youtubeChannelId);
        } else {
          throw error;
        }
      }
      
      // Get recent videos for additional analytics
      const recentVideos = await this.getRecentVideos(accessToken, settings.youtubeChannelId);
      
      // Calculate analytics
      const analytics = this.calculateAnalytics(channelData, recentVideos);
      
      console.log('✅ [YOUTUBE ANALYTICS] Successfully fetched analytics');
      
      return {
        ...analytics,
        isPosting: true // Indicates YouTube is active
      };
      
    } catch (error) {
      console.error('❌ [YOUTUBE ANALYTICS] API Error:', error.message);
      
      // Check for specific error types
      if (error.message.includes('403')) {
        console.error('❌ [YOUTUBE ANALYTICS] Forbidden - Token may be expired or insufficient permissions');
      } else if (error.message.includes('401')) {
        console.error('❌ [YOUTUBE ANALYTICS] Unauthorized - Token invalid');
      } else if (error.message.includes('quota')) {
        console.error('❌ [YOUTUBE ANALYTICS] Quota exceeded');
      }
      
      throw error;
    }
  }

  /**
   * Refresh YouTube OAuth2 access token
   */
  static async refreshAccessToken(settings) {
    if (!settings.youtubeRefreshToken || !settings.youtubeClientId || !settings.youtubeClientSecret) {
      throw new Error('Missing OAuth2 credentials for token refresh');
    }

    console.log('🔄 [YOUTUBE ANALYTICS] Refreshing access token...');

    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const body = new URLSearchParams({
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
      body: body.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ [YOUTUBE ANALYTICS] Token refresh failed:', response.status, errorText);
      throw new Error(`YouTube token refresh failed: ${response.status}`);
    }

    const tokenData = await response.json();
    console.log('✅ [YOUTUBE ANALYTICS] Token refreshed successfully');
    
    // TODO: Save the new access token back to settings
    // For now, just return it for this session
    return tokenData.access_token;
  }

  /**
   * Get YouTube channel data
   */
  static async getChannelData(accessToken, channelId) {
    const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id=${channelId}&access_token=${accessToken}`;
    
    console.log('🔍 [YOUTUBE ANALYTICS] Fetching channel data...');
    
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ [YOUTUBE ANALYTICS] Channel data error:', response.status, errorText);
      throw new Error(`YouTube API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.items || data.items.length === 0) {
      throw new Error('Channel not found');
    }
    
    const channel = data.items[0];
    console.log('✅ [YOUTUBE ANALYTICS] Channel data fetched:', { 
      title: channel.snippet.title,
      subscribers: channel.statistics.subscriberCount,
      videos: channel.statistics.videoCount 
    });
    
    return channel;
  }

  /**
   * Get recent videos for additional analytics
   */
  static async getRecentVideos(accessToken, channelId) {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&type=video&order=date&maxResults=10&access_token=${accessToken}`;
    
    console.log('🔍 [YOUTUBE ANALYTICS] Fetching recent videos...');
    
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ [YOUTUBE ANALYTICS] Recent videos error:', response.status, errorText);
      // Don't throw here, as this is supplementary data
      return [];
    }
    
    const data = await response.json();
    console.log('✅ [YOUTUBE ANALYTICS] Recent videos fetched:', data.items?.length || 0);
    
    return data.items || [];
  }

  /**
   * Get video statistics for view calculations
   */
  static async getVideoStatistics(accessToken, videoIds) {
    if (videoIds.length === 0) return [];
    
    const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoIds.join(',')}&access_token=${accessToken}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error('❌ [YOUTUBE ANALYTICS] Video stats error:', response.status);
      return [];
    }
    
    const data = await response.json();
    return data.items || [];
  }

  /**
   * Calculate comprehensive analytics
   */
  static calculateAnalytics(channelData, recentVideos) {
    const stats = channelData.statistics;
    
    const subscribers = parseInt(stats.subscriberCount) || 0;
    const totalVideos = parseInt(stats.videoCount) || 0;
    const totalViews = parseInt(stats.viewCount) || 0;
    
    // Calculate average views per video
    const avgViews = totalVideos > 0 ? Math.floor(totalViews / totalVideos) : 0;
    
    // Calculate watch time (estimated based on views)
    // Assuming average video length of 5 minutes and 50% completion rate
    const estimatedWatchTimeMinutes = Math.floor(totalViews * 2.5);
    const watchTimeHours = Math.floor(estimatedWatchTimeMinutes / 60);
    
    // Calculate growth rate (simplified - could be enhanced with historical data)
    const growthRate = this.calculateGrowthRate(subscribers, recentVideos.length);
    
    return {
      subscribers,
      videos: totalVideos,
      views: totalViews,
      avgViews,
      watchTime: `${watchTimeHours.toLocaleString()} hours`,
      growthRate
    };
  }

  /**
   * Calculate growth rate based on recent activity
   */
  static calculateGrowthRate(subscribers, recentVideosCount) {
    // Simple growth calculation based on recent posting activity
    // More recent videos = higher engagement potential
    const activityMultiplier = Math.min(recentVideosCount / 10, 1); // 0-1 based on recent videos
    const subscriberTier = subscribers > 100000 ? 0.5 : subscribers > 10000 ? 0.7 : 1; // Larger channels grow slower
    
    return Math.round(activityMultiplier * subscriberTier * 5 * 10) / 10; // Return percentage with 1 decimal
  }
}

module.exports = { YouTubeAnalyticsService };