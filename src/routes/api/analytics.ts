import express from 'express';
import Settings from '../../models/Settings';

// Fetch compatibility for backend
let fetch: any;
try {
  fetch = require('node-fetch');
} catch (err) {
  const axios = require('axios');
  fetch = async (url: string, options: any = {}) => {
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

const router = express.Router();

/**
 * GET /api/analytics - Real analytics data from Instagram & YouTube APIs
 * Returns dashboard data with live metrics and upcoming posts
 */
router.get('/', async (req, res) => {
  try {
    console.log('📊 [ANALYTICS] Fetching real analytics data from APIs...');

    const settings = await Settings.findOne();
    if (!settings) {
      return res.status(404).json({
        success: false,
        error: 'Settings not found. Please configure your credentials first.'
      });
    }

    // Response structure matching dashboard requirements
    const analytics = {
      instagram: {
        followers: 0,
        reach: 0,
        engagementRate: 0,
        autopilotEnabled: settings.autopilotEnabled || false
      },
      youtube: {
        subscribers: 0,
        reach: 0,
        autopilotEnabled: settings.autopilotEnabled || false
      },
      upcomingPosts: [],
      credentials: {
        instagramAccessToken: settings.instagramToken ? '✅ Configured' : '❌ Missing',
        igBusinessAccountId: settings.igBusinessId ? '✅ Configured' : '❌ Missing',
        youtubeToken: settings.youtubeAccessToken ? '✅ Configured' : '❌ Missing',
        youtubeRefreshToken: settings.youtubeRefreshToken ? '✅ Configured' : '❌ Missing',
        s3Bucket: settings.s3BucketName ? '✅ Configured' : '❌ Missing',
        mongoUri: settings.mongoURI ? '✅ Configured' : '❌ Missing'
      }
    };

    // Fetch Instagram analytics if configured
    if (settings.instagramToken && settings.igBusinessId) {
      try {
        console.log('📷 [ANALYTICS] Fetching Instagram data...');
        
        // Get Instagram account info
        const accountUrl = `https://graph.facebook.com/v19.0/${settings.igBusinessId}?fields=followers_count,media_count&access_token=${settings.instagramToken}`;
        const accountResponse = await fetch(accountUrl);
        const accountData = await accountResponse.json();

        if (accountData.error) {
          console.error('❌ [IG ANALYTICS] Error:', accountData.error.message);
        } else {
          analytics.instagram.followers = accountData.followers_count || 0;
          
          // Get Instagram insights for reach/impressions  
          const insightsUrl = `https://graph.facebook.com/v19.0/${settings.igBusinessId}/insights?metric=impressions,reach,profile_views&period=day&since=7days&access_token=${settings.instagramToken}`;
          const insightsResponse = await fetch(insightsUrl);
          const insightsData = await insightsResponse.json();

          if (!insightsData.error && insightsData.data) {
            const reachMetric = insightsData.data.find(m => m.name === 'reach');
            if (reachMetric && reachMetric.values && reachMetric.values.length > 0) {
              analytics.instagram.reach = reachMetric.values[reachMetric.values.length - 1].value || 0;
            }
          }

          // Calculate engagement rate from recent posts
          const mediaUrl = `https://graph.facebook.com/v19.0/${settings.igBusinessId}/media?fields=like_count,comments_count&limit=10&access_token=${settings.instagramToken}`;
          const mediaResponse = await fetch(mediaUrl);
          const mediaData = await mediaResponse.json();

          if (!mediaData.error && mediaData.data && mediaData.data.length > 0) {
            let totalEngagement = 0;
            mediaData.data.forEach(post => {
              totalEngagement += (post.like_count || 0) + (post.comments_count || 0);
            });
            const avgEngagement = totalEngagement / mediaData.data.length;
            analytics.instagram.engagementRate = accountData.followers_count > 0 
              ? avgEngagement / accountData.followers_count 
              : 0;
          }
        }
      } catch (igError) {
        console.error('❌ [IG ANALYTICS] Fetch error:', igError.message);
      }
    }

    // Fetch YouTube analytics if configured
    if (settings.youtubeAccessToken && settings.youtubeChannelId) {
      try {
        console.log('📺 [ANALYTICS] Fetching YouTube data...');
        
        // Get YouTube channel statistics
        const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${settings.youtubeChannelId}&access_token=${settings.youtubeAccessToken}`;
        const channelResponse = await fetch(channelUrl);
        const channelData = await channelResponse.json();

        if (channelData.error) {
          console.error('❌ [YT ANALYTICS] Error:', channelData.error.message);
          
          // If access token expired, try to refresh
          if (channelData.error.message.includes('invalid_grant') || channelData.error.message.includes('expired')) {
            console.log('🔄 [YT ANALYTICS] Attempting token refresh...');
            const refreshed = await refreshYouTubeToken(settings);
            if (refreshed) {
              // Retry with new token
              const retryResponse = await fetch(channelUrl.replace(settings.youtubeAccessToken, refreshed));
              const retryData = await retryResponse.json();
              if (!retryData.error && retryData.items && retryData.items[0]) {
                const stats = retryData.items[0].statistics;
                analytics.youtube.subscribers = parseInt(stats.subscriberCount) || 0;
                analytics.youtube.reach = parseInt(stats.viewCount) || 0;
              }
            }
          }
        } else if (channelData.items && channelData.items[0]) {
          const stats = channelData.items[0].statistics;
          analytics.youtube.subscribers = parseInt(stats.subscriberCount) || 0;
          analytics.youtube.reach = parseInt(stats.viewCount) || 0;
        }
      } catch (ytError) {
        console.error('❌ [YT ANALYTICS] Fetch error:', ytError.message);
      }
    }

    // Get upcoming posts from autopilot queue
    try {
      const { MongoClient } = require('mongodb');
      const mongoUrl = process.env.MONGODB_URI || settings.mongoURI || 'mongodb://localhost:27017/lifestyle-design';
      const client = new MongoClient(mongoUrl);

      try {
        await client.connect();
        const db = client.db();
        const queue = db.collection('autopilot_queue');

        // Get upcoming scheduled posts
        const upcomingPosts = await queue.find({
          status: 'scheduled',
          scheduledAt: { $gte: new Date() }
        })
        .sort({ scheduledAt: 1 })
        .limit(5)
        .toArray();

        analytics.upcomingPosts = upcomingPosts.map(post => ({
          platform: post.platform === 'instagram' ? 'Instagram' : 'YouTube',
          caption: post.caption ? post.caption.substring(0, 100) + '...' : 'AI-generated caption',
          thumbnail: post.s3Url || '/default-video.jpg',
          scheduledTime: post.scheduledAt
        }));

      } finally {
        await client.close();
      }
    } catch (dbError) {
      console.warn('⚠️ [ANALYTICS] Database error:', dbError.message);
      analytics.upcomingPosts = [];
    }

    console.log('✅ [ANALYTICS] Real analytics data compiled successfully');
    console.log(`📊 Instagram: ${analytics.instagram.followers} followers, ${analytics.instagram.reach} reach`);
    console.log(`📺 YouTube: ${analytics.youtube.subscribers} subscribers, ${analytics.youtube.reach} total views`);
    console.log(`📅 Upcoming posts: ${analytics.upcomingPosts.length}`);
    
    res.status(200).json({
      success: true,
      ...analytics,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ [ANALYTICS ERROR]', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Refresh YouTube access token using refresh token
 */
async function refreshYouTubeToken(settings: any): Promise<string | null> {
  try {
    if (!settings.youtubeRefreshToken || !settings.youtubeClientId || !settings.youtubeClientSecret) {
      console.warn('⚠️ [YT REFRESH] Missing refresh credentials');
      return null;
    }

    const refreshUrl = 'https://oauth2.googleapis.com/token';
    const refreshResponse = await fetch(refreshUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: settings.youtubeClientId,
        client_secret: settings.youtubeClientSecret,
        refresh_token: settings.youtubeRefreshToken,
        grant_type: 'refresh_token'
      })
    });

    const refreshData = await refreshResponse.json();
    
    if (refreshData.error) {
      console.error('❌ [YT REFRESH] Error:', refreshData.error_description);
      return null;
    }

    if (refreshData.access_token) {
      // Update settings with new access token
      settings.youtubeAccessToken = refreshData.access_token;
      await settings.save();
      console.log('✅ [YT REFRESH] Access token refreshed successfully');
      return refreshData.access_token;
    }

    return null;
  } catch (error) {
    console.error('❌ [YT REFRESH] Failed to refresh token:', error);
    return null;
  }
}

export default router;