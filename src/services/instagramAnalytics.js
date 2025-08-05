/**
 * Instagram Analytics Service
 * Fetches real Instagram analytics data using Graph API
 */

class InstagramAnalyticsService {
  
  /**
   * Get Instagram analytics data using Graph API
   */
  static async getAnalytics(settings) {
    console.log('🔍 [INSTAGRAM ANALYTICS] Starting analytics fetch...');
    
    if (!settings.instagramToken || !settings.igBusinessId) {
      console.error('❌ [INSTAGRAM ANALYTICS] Missing required tokens - instagramToken or igBusinessId');
      throw new Error('Instagram credentials not configured');
    }

    try {
      // Get basic account info
      const accountData = await this.getAccountInfo(settings);
      
      // Get insights data
      const insightsData = await this.getInsights(settings);
      
      // Calculate growth rate (mock for now, could be enhanced with historical data)
      const growthRate = this.calculateGrowthRate(insightsData);
      
      console.log('✅ [INSTAGRAM ANALYTICS] Successfully fetched analytics');
      
      return {
        followers: accountData.followers_count || 0,
        posts: accountData.media_count || 0,
        engagement: this.calculateEngagementRate(insightsData, accountData.followers_count),
        reach: insightsData.reach || 0,
        impressions: insightsData.impressions || 0,
        profileViews: insightsData.profile_views || 0,
        growthRate,
        isPosting: true // Indicates Instagram is active
      };
      
    } catch (error) {
      console.error('❌ [INSTAGRAM ANALYTICS] API Error:', error.message);
      
      // Check for specific error types
      if (error.message.includes('400')) {
        console.error('❌ [INSTAGRAM ANALYTICS] Bad Request - Check token/account IDs');
      } else if (error.message.includes('403')) {
        console.error('❌ [INSTAGRAM ANALYTICS] Forbidden - Token may be expired or insufficient permissions');
      }
      
      throw error;
    }
  }

  /**
   * Get basic Instagram account information
   */
  static async getAccountInfo(settings) {
    const url = `https://graph.facebook.com/v19.0/${settings.igBusinessId}?fields=followers_count,media_count,biography,name,username,profile_picture_url&access_token=${settings.instagramToken}`;
    
    console.log('🔍 [INSTAGRAM ANALYTICS] Fetching account info...');
    
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ [INSTAGRAM ANALYTICS] Account info error:', response.status, errorText);
      throw new Error(`Instagram API error: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('✅ [INSTAGRAM ANALYTICS] Account info fetched:', { 
      followers: data.followers_count, 
      media: data.media_count,
      username: data.username 
    });
    
    return data;
  }

  /**
   * Get Instagram insights data
   */
  static async getInsights(settings) {
    // Get insights for the last 30 days
    const since = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
    const until = Math.floor(Date.now() / 1000);
    
    const url = `https://graph.facebook.com/v19.0/${settings.igBusinessId}/insights?metric=impressions,reach,profile_views&period=days_28&since=${since}&until=${until}&access_token=${settings.instagramToken}`;
    
    console.log('🔍 [INSTAGRAM ANALYTICS] Fetching insights...');
    
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ [INSTAGRAM ANALYTICS] Insights error:', response.status, errorText);
      throw new Error(`Instagram API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Parse insights data
    const insights = {};
    if (data.data && Array.isArray(data.data)) {
      data.data.forEach((metric) => {
        if (metric.values && metric.values.length > 0) {
          // Get the most recent value
          const latestValue = metric.values[metric.values.length - 1];
          insights[metric.name] = latestValue.value || 0;
        }
      });
    }
    
    console.log('✅ [INSTAGRAM ANALYTICS] Insights fetched:', insights);
    
    return insights;
  }

  /**
   * Calculate engagement rate
   */
  static calculateEngagementRate(insights, followers) {
    if (!followers || followers === 0) return '0%';
    
    // Engagement rate = (reach / followers) * 100
    const reach = insights.reach || 0;
    const engagementRate = (reach / followers) * 100;
    
    return Math.min(engagementRate, 100).toFixed(1) + '%';
  }

  /**
   * Calculate growth rate (simplified)
   */
  static calculateGrowthRate(insights) {
    // For now, use profile views as a proxy for growth
    const profileViews = insights.profile_views || 0;
    
    // Convert to a percentage (this could be enhanced with historical data)
    return Math.min(profileViews / 1000, 10); // Cap at 10%
  }
}

module.exports = { InstagramAnalyticsService };