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

    // Fetch Instagram analytics using enhanced service
    if (settings.instagramToken && settings.igBusinessId) {
      console.log('📷 [ANALYTICS] Fetching Instagram data using enhanced service...');
      
      try {
        // Use our enhanced Instagram analytics service with smart caching
        const instagramAnalytics = require('../../services/instagramAnalytics');
        const igData = await instagramAnalytics.getInstagramAnalytics(settings);

        console.log('📊 [IG] Service response:', igData);

        if (igData.error && !igData.cached) {
          console.error('❌ [IG ANALYTICS] Service Error:', igData.error);
          analytics.instagram.followers = `Error: ${igData.error}`;
        } else {
          // Map the data from our Instagram analytics service
          analytics.instagram.followers = igData.followers || 0;
          analytics.instagram.reach = igData.reach || 0;
          analytics.instagram.engagementRate = igData.engagementRate || 0;
          analytics.instagram.mediaCount = igData.mediaCount || 0;
          analytics.instagram.accountName = igData.accountName || 'Unknown';
          analytics.instagram.username = igData.username || 'unknown';
          analytics.instagram.lastUpdated = igData.lastUpdated;
          analytics.instagram.source = igData.source;
          
          // Add cache/error info if present
          if (igData.cached) {
            analytics.instagram.cached = true;
            analytics.instagram.stale = igData.stale;
            if (igData.error) {
              analytics.instagram.cacheReason = igData.error;
            }
          }
          
          console.log(`✅ [IG] Got ${analytics.instagram.followers} followers, ${analytics.instagram.engagementRate}% engagement for @${analytics.instagram.username}${igData.cached ? ' (cached)' : ''}`);
        }
      } catch (igError) {
        console.error('❌ [IG ANALYTICS] Service error:', igError.message);
        analytics.instagram.followers = `Error: ${igError.message}`;
      }
    } else {
      console.log('⚠️ [IG] Missing credentials - instagramToken:', !!settings.instagramToken, 'igBusinessId:', !!settings.igBusinessId);
    }

    // Fetch YouTube analytics - try API first, fallback to scraping
    console.log('📺 [ANALYTICS] Fetching YouTube data using youtubeAnalytics service...');
    console.log(`🔑 Using YT Token: ${settings.youtubeAccessToken ? 'Present' : 'Missing'}`);
    console.log(`🔑 Using YT Channel ID: ${settings.youtubeChannelId ? 'Present' : 'Missing'}`);
    console.log(`🔑 Using YT Channel Handle: ${settings.youtubeChannelHandle ? 'Present' : 'Missing'}`);
    
    try {
      // Always use our YouTube analytics service - it handles both API and scraping
      const youtubeAnalytics = require('../../services/youtubeAnalytics');
      const youtubeData = await youtubeAnalytics.getYouTubeAnalytics(settings);

      console.log('📊 [YT] Service response:', youtubeData);

      if (youtubeData.error && !youtubeData.scraped) {
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
        analytics.youtube.source = youtubeData.source || 'unknown';
        
        // Add scraping indicator if data was scraped
        if (youtubeData.scraped) {
          analytics.youtube.scraped = true;
          analytics.youtube.scrapeReason = youtubeData.error || 'API quota exceeded';
        }
        
        console.log(`✅ [YT] Got ${analytics.youtube.subscribers} subscribers, ${analytics.youtube.reach.toLocaleString()} total views for ${analytics.youtube.channelTitle}${youtubeData.scraped ? ' (scraped)' : ''}`);
      }
    } catch (ytError) {
      console.error('❌ [YT ANALYTICS] Service error:', ytError.message);
      analytics.youtube.subscribers = `Error: ${ytError.message}`;
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