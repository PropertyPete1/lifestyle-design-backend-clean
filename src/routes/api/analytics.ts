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
      console.log('📷 [ANALYTICS] Fetching Instagram data with credentials...');
      console.log(`🔑 Using IG Business ID: ${settings.igBusinessId}`);
      console.log(`🔑 Using IG Token: ${settings.instagramToken ? 'Present' : 'Missing'}`);
      
      try {
        // Get Instagram account info
        const accountUrl = `https://graph.facebook.com/v19.0/${settings.igBusinessId}?fields=followers_count,media_count&access_token=${settings.instagramToken}`;
        console.log(`📡 [IG] Fetching: ${accountUrl.replace(settings.instagramToken, 'TOKEN_HIDDEN')}`);
        
        const accountResponse = await fetch(accountUrl);
        const accountData = await accountResponse.json();

        console.log('📊 [IG] Account response:', accountData);

        if (accountData.error) {
          console.error('❌ [IG ANALYTICS] API Error:', accountData.error);
          analytics.instagram.followers = `Error: ${accountData.error.message}`;
        } else {
          analytics.instagram.followers = accountData.followers_count || 0;
          console.log(`✅ [IG] Got ${accountData.followers_count} followers`);
          
          // Get Instagram insights for reach/impressions  
          const insightsUrl = `https://graph.facebook.com/v19.0/${settings.igBusinessId}/insights?metric=impressions,reach,profile_views&period=day&access_token=${settings.instagramToken}`;
          console.log(`📡 [IG] Fetching insights...`);
          
          const insightsResponse = await fetch(insightsUrl);
          const insightsData = await insightsResponse.json();

          console.log('📊 [IG] Insights response:', insightsData);

          if (!insightsData.error && insightsData.data) {
            const reachMetric = insightsData.data.find(m => m.name === 'reach');
            if (reachMetric && reachMetric.values && reachMetric.values.length > 0) {
              analytics.instagram.reach = reachMetric.values[reachMetric.values.length - 1].value || 0;
              console.log(`✅ [IG] Got reach: ${analytics.instagram.reach}`);
            }
          } else {
            console.log('⚠️ [IG] No insights data or error:', insightsData.error);
          }

          // Calculate engagement rate from recent posts
          const mediaUrl = `https://graph.facebook.com/v19.0/${settings.igBusinessId}/media?fields=like_count,comments_count&limit=10&access_token=${settings.instagramToken}`;
          console.log(`📡 [IG] Fetching media for engagement...`);
          
          const mediaResponse = await fetch(mediaUrl);
          const mediaData = await mediaResponse.json();

          console.log('📊 [IG] Media response:', mediaData);

          if (!mediaData.error && mediaData.data && mediaData.data.length > 0) {
            let totalEngagement = 0;
            mediaData.data.forEach(post => {
              totalEngagement += (post.like_count || 0) + (post.comments_count || 0);
            });
            const avgEngagement = totalEngagement / mediaData.data.length;
            analytics.instagram.engagementRate = accountData.followers_count > 0 
              ? avgEngagement / accountData.followers_count 
              : 0;
            console.log(`✅ [IG] Calculated engagement rate: ${(analytics.instagram.engagementRate * 100).toFixed(2)}%`);
          } else {
            console.log('⚠️ [IG] No media data or error:', mediaData.error);
          }
        }
      } catch (igError) {
        console.error('❌ [IG ANALYTICS] Fetch error:', igError.message);
        analytics.instagram.followers = `Error: ${igError.message}`;
      }
    } else {
      console.log('⚠️ [IG] Missing credentials - instagramToken:', !!settings.instagramToken, 'igBusinessId:', !!settings.igBusinessId);
    }

    // Fetch YouTube analytics if configured  
    if (settings.youtubeAccessToken) {
      console.log('📺 [ANALYTICS] Fetching YouTube data using youtubeAnalytics service...');
      console.log(`🔑 Using YT Token: ${settings.youtubeAccessToken ? 'Present' : 'Missing'}`);
      console.log(`🔑 Using YT Refresh Token: ${settings.youtubeRefreshToken ? 'Present' : 'Missing'}`);
      console.log(`🔑 Using YT Client ID: ${settings.youtubeClientId ? 'Present' : 'Missing'}`);
      console.log(`🔑 Using YT Client Secret: ${settings.youtubeClientSecret ? 'Present' : 'Missing'}`);
      
      try {
        // Use our YouTube analytics service with token refresh capability
        const youtubeAnalytics = require('../../services/youtubeAnalytics');
        const youtubeData = await youtubeAnalytics.getYouTubeAnalytics(settings);

        console.log('📊 [YT] Service response:', youtubeData);

        if (youtubeData.error) {
          console.error('❌ [YT ANALYTICS] Service Error:', youtubeData.error);
          analytics.youtube.subscribers = `Error: ${youtubeData.error}`;
        } else {
          // Map the data from our YouTube analytics service
          analytics.youtube.subscribers = youtubeData.subscriberCount || 0;
          analytics.youtube.reach = youtubeData.views || 0;
          analytics.youtube.videos = youtubeData.videoCount || 0;
          analytics.youtube.engagement = youtubeData.engagement || 0;
          analytics.youtube.channelTitle = youtubeData.channelTitle || 'Unknown';
          analytics.youtube.estimatedMinutesWatched = youtubeData.estimatedMinutesWatched || 0;
          analytics.youtube.isPosting = youtubeData.isPosting || false;
          analytics.youtube.lastUpdated = youtubeData.lastUpdated;
          
          console.log(`✅ [YT] Got ${analytics.youtube.subscribers} subscribers, ${analytics.youtube.reach.toLocaleString()} total views for ${analytics.youtube.channelTitle}`);
        }
      } catch (ytError) {
        console.error('❌ [YT ANALYTICS] Fetch error:', ytError.message);
        analytics.youtube.subscribers = `Error: ${ytError.message}`;
      }
    } else {
      console.log('⚠️ [YT] Missing YouTube access token');
      console.log(`📋 [YT] Have accessToken: ${!!settings.youtubeAccessToken}, refreshToken: ${!!settings.youtubeRefreshToken}, clientId: ${!!settings.youtubeClientId}, clientSecret: ${!!settings.youtubeClientSecret}`);
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

// YouTube token refresh is now handled by the youtubeAnalytics service

/**
 * GET /api/analytics/debug - Debug endpoint to check credentials and API responses
 */
router.get('/debug', async (req, res) => {
  try {
    console.log('🔍 [DEBUG] Checking credentials and API connectivity...');

    const settings = await Settings.findOne();
    if (!settings) {
      return res.status(404).json({
        success: false,
        error: 'No settings found in MongoDB'
      });
    }

    const debug = {
      credentials: {
        instagramToken: settings.instagramToken ? `✅ Present (${settings.instagramToken.substring(0, 10)}...)` : '❌ Missing',
        igBusinessId: settings.igBusinessId ? `✅ Present (${settings.igBusinessId})` : '❌ Missing',
        youtubeAccessToken: settings.youtubeAccessToken ? `✅ Present (${settings.youtubeAccessToken.substring(0, 10)}...)` : '❌ Missing',
        youtubeChannelId: settings.youtubeChannelId ? `✅ Present (${settings.youtubeChannelId})` : '❌ Missing',
        youtubeRefreshToken: settings.youtubeRefreshToken ? `✅ Present (${settings.youtubeRefreshToken.substring(0, 10)}...)` : '❌ Missing'
      },
      tests: {}
    };

    // Test Instagram API
    if (settings.instagramToken && settings.igBusinessId) {
      try {
        const igTestUrl = `https://graph.facebook.com/v19.0/${settings.igBusinessId}?fields=followers_count&access_token=${settings.instagramToken}`;
        const igResponse = await fetch(igTestUrl);
        const igData = await igResponse.json();
        
        debug.tests.instagram = {
          status: igData.error ? 'Error' : 'Success',
          response: igData
        };
      } catch (err) {
        debug.tests.instagram = {
          status: 'Error',
          error: err.message
        };
      }
    } else {
      debug.tests.instagram = {
        status: 'Skipped',
        reason: 'Missing credentials'
      };
    }

    // Test YouTube API
    if (settings.youtubeAccessToken && settings.youtubeChannelId) {
      try {
        const ytTestUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${settings.youtubeChannelId}&access_token=${settings.youtubeAccessToken}`;
        const ytResponse = await fetch(ytTestUrl);
        const ytData = await ytResponse.json();
        
        debug.tests.youtube = {
          status: ytData.error ? 'Error' : 'Success',
          response: ytData
        };
      } catch (err) {
        debug.tests.youtube = {
          status: 'Error',
          error: err.message
        };
      }
    } else {
      debug.tests.youtube = {
        status: 'Skipped',
        reason: 'Missing credentials'
      };
    }

    res.status(200).json({
      success: true,
      debug,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ [DEBUG ERROR]', error);
    res.status(500).json({
      success: false,
      error: 'Debug check failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;