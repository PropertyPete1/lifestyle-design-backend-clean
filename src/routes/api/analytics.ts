import express from 'express';
import Settings from '../../models/Settings';

const router = express.Router();

/**
 * GET /api/analytics - Unified analytics endpoint
 * Returns analytics data for dashboard display
 */
router.get('/', async (req, res) => {
  try {
    console.log('📊 [ANALYTICS] Fetching unified analytics data...');

    const settings = await Settings.findOne();
    
    // Default analytics data structure
    const analytics = {
      instagram: {
        followers: 'N/A',
        engagement: 'N/A',
        reach: 'N/A',
        posts: 'N/A',
        configured: false
      },
      youtube: {
        subscribers: 'N/A',
        watchTime: 'N/A', 
        views: 'N/A',
        videos: 'N/A',
        configured: false
      },
      overall: {
        totalPosts: 0,
        totalEngagement: 0,
        autopilotActive: false,
        lastActivity: null
      }
    };

    if (settings) {
      // Check if platforms are configured
      analytics.instagram.configured = !!(settings.instagramToken && settings.igBusinessId);
      analytics.youtube.configured = !!(settings.youtubeClientId && settings.youtubeAccessToken);
      analytics.overall.autopilotActive = settings.autopilotEnabled || false;

      // If Instagram is configured, try to fetch real data
      if (analytics.instagram.configured) {
        try {
          const { getInstagramAnalytics } = require('../../services/instagramAnalytics');
          const igData = await getInstagramAnalytics(settings);
          
          if (igData && !igData.error) {
            analytics.instagram = {
              ...analytics.instagram,
              followers: igData.followers_count?.toLocaleString() || 'N/A',
              engagement: igData.engagement_rate ? `${(igData.engagement_rate * 100).toFixed(1)}%` : 'N/A',
              reach: igData.reach?.toLocaleString() || 'N/A',
              posts: igData.media_count?.toLocaleString() || 'N/A'
            };
          }
        } catch (igError) {
          console.warn('⚠️ [ANALYTICS] Instagram API error:', igError.message);
          // Keep default values with configured = true
        }
      }

      // If YouTube is configured, try to fetch real data
      if (analytics.youtube.configured) {
        try {
          const { getYouTubeAnalytics } = require('../../services/youtubeAnalytics');
          const ytData = await getYouTubeAnalytics(settings);
          
          if (ytData && !ytData.error) {
            analytics.youtube = {
              ...analytics.youtube,
              subscribers: ytData.subscriberCount?.toLocaleString() || 'N/A',
              watchTime: ytData.estimatedMinutesWatched ? `${Math.round(ytData.estimatedMinutesWatched / 60)} hrs` : 'N/A',
              views: ytData.views?.toLocaleString() || 'N/A',
              videos: ytData.videoCount?.toLocaleString() || 'N/A'
            };
          }
        } catch (ytError) {
          console.warn('⚠️ [ANALYTICS] YouTube API error:', ytError.message);
          // Keep default values with configured = true
        }
      }
    }

    // Get activity data from autopilot queue
    try {
      const { MongoClient } = require('mongodb');
      const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/lifestyle-design';
      const client = new MongoClient(mongoUrl);

      try {
        await client.connect();
        const db = client.db();
        const queue = db.collection('autopilot_queue');

        // Get total posts and last activity
        const totalPosts = await queue.countDocuments({ autopilotGenerated: true });
        const lastActivity = await queue.findOne(
          { autopilotGenerated: true }, 
          { sort: { createdAt: -1 } }
        );

        analytics.overall.totalPosts = totalPosts;
        analytics.overall.lastActivity = lastActivity?.createdAt || null;

      } finally {
        await client.close();
      }
    } catch (dbError) {
      console.warn('⚠️ [ANALYTICS] Database error:', dbError.message);
    }

    console.log('✅ [ANALYTICS] Analytics data compiled successfully');
    
    res.status(200).json({
      success: true,
      data: analytics,
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

export default router;