/**
 * Analytics Routes
 * Handles all analytics endpoints for Instagram and YouTube
 */

const express = require('express');
const { InstagramAnalyticsService } = require('../services/instagramAnalytics');
const { YouTubeAnalyticsService } = require('../services/youtubeAnalytics');

const router = express.Router();

/**
 * Dashboard Analytics Endpoint
 * Combines Instagram and YouTube analytics for heart indicators
 */
router.get('/dashboard/analytics', async (req, res) => {
  console.log('🔍 [DASHBOARD ANALYTICS] Fetching combined analytics...');
  
  try {
    // Load settings from database
    const Settings = require('../models/settings.js');
    const settings = await Settings.findOne({}).lean();
    
    if (!settings) {
      console.warn('⚠️ [DASHBOARD ANALYTICS] No settings found in database');
      return res.json({
        instagram: { isPosting: false, growthRate: 0 },
        youtube: { isPosting: false, growthRate: 0 }
      });
    }

    const results = {
      instagram: { isPosting: false, growthRate: 0 },
      youtube: { isPosting: false, growthRate: 0 }
    };

    // Fetch Instagram analytics
    try {
      if (settings.instagramToken && settings.igBusinessId) {
        console.log('📊 [DASHBOARD ANALYTICS] Fetching Instagram analytics...');
        const igAnalytics = await InstagramAnalyticsService.getAnalytics({
          instagramToken: settings.instagramToken,
          igBusinessId: settings.igBusinessId,
          facebookPageId: settings.facebookPageId
        });
        
        results.instagram = {
          isPosting: igAnalytics.isPosting,
          growthRate: igAnalytics.growthRate
        };
        
        console.log('✅ [DASHBOARD ANALYTICS] Instagram analytics fetched');
      } else {
        console.warn('⚠️ [DASHBOARD ANALYTICS] Instagram credentials not configured');
      }
    } catch (error) {
      console.error('❌ [DASHBOARD ANALYTICS] Instagram analytics failed:', error.message);
      // Continue with YouTube even if Instagram fails
    }

    // Fetch YouTube analytics
    try {
      if (settings.youtubeToken && settings.youtubeChannelId) {
        console.log('📊 [DASHBOARD ANALYTICS] Fetching YouTube analytics...');
        const ytAnalytics = await YouTubeAnalyticsService.getAnalytics({
          youtubeToken: settings.youtubeToken,
          youtubeRefreshToken: settings.youtubeRefreshToken,
          youtubeClientId: settings.youtubeClientId,
          youtubeClientSecret: settings.youtubeClientSecret,
          youtubeChannelId: settings.youtubeChannelId
        });
        
        results.youtube = {
          isPosting: ytAnalytics.isPosting,
          growthRate: ytAnalytics.growthRate
        };
        
        console.log('✅ [DASHBOARD ANALYTICS] YouTube analytics fetched');
      } else {
        console.warn('⚠️ [DASHBOARD ANALYTICS] YouTube credentials not configured');
      }
    } catch (error) {
      console.error('❌ [DASHBOARD ANALYTICS] YouTube analytics failed:', error.message);
      // Continue with response even if YouTube fails
    }

    console.log('✅ [DASHBOARD ANALYTICS] Combined analytics completed:', results);
    res.json(results);

  } catch (error) {
    console.error('❌ [DASHBOARD ANALYTICS] Critical error:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch dashboard analytics',
      instagram: { isPosting: false, growthRate: 0 },
      youtube: { isPosting: false, growthRate: 0 }
    });
  }
});

/**
 * Instagram Analytics Endpoint
 */
router.get('/instagram/analytics', async (req, res) => {
  console.log('🔍 [INSTAGRAM ANALYTICS ENDPOINT] Starting request...');
  
  try {
    // Load settings from database
    const Settings = require('../models/settings.js');
    const settings = await Settings.findOne({}).lean();
    
    if (!settings || !settings.instagramToken || !settings.igBusinessId) {
      console.warn('⚠️ [INSTAGRAM ANALYTICS ENDPOINT] Instagram credentials not configured');
      return res.status(400).json({ 
        error: 'Instagram credentials not configured',
        success: false 
      });
    }

    const analytics = await InstagramAnalyticsService.getAnalytics({
      instagramToken: settings.instagramToken,
      igBusinessId: settings.igBusinessId,
      facebookPageId: settings.facebookPageId
    });

    console.log('✅ [INSTAGRAM ANALYTICS ENDPOINT] Success');
    res.json({ success: true, analytics });

  } catch (error) {
    console.error('❌ [INSTAGRAM ANALYTICS ENDPOINT] Error:', error.message);
    res.status(500).json({ 
      error: 'Failed to get Instagram analytics',
      success: false,
      details: error.message 
    });
  }
});

/**
 * YouTube Analytics Endpoint
 */
router.get('/youtube/analytics', async (req, res) => {
  console.log('🔍 [YOUTUBE ANALYTICS ENDPOINT] Starting request...');
  
  try {
    // Load settings from database
    const Settings = require('../models/settings.js');
    const settings = await Settings.findOne({}).lean();
    
    if (!settings || !settings.youtubeToken || !settings.youtubeChannelId) {
      console.warn('⚠️ [YOUTUBE ANALYTICS ENDPOINT] YouTube credentials not configured');
      return res.status(400).json({ 
        error: 'YouTube credentials not configured',
        success: false 
      });
    }

    const analytics = await YouTubeAnalyticsService.getAnalytics({
      youtubeToken: settings.youtubeToken,
      youtubeRefreshToken: settings.youtubeRefreshToken,
      youtubeClientId: settings.youtubeClientId,
      youtubeClientSecret: settings.youtubeClientSecret,
      youtubeChannelId: settings.youtubeChannelId
    });

    console.log('✅ [YOUTUBE ANALYTICS ENDPOINT] Success');
    res.json({ success: true, analytics });

  } catch (error) {
    console.error('❌ [YOUTUBE ANALYTICS ENDPOINT] Error:', error.message);
    res.status(500).json({ 
      error: 'Failed to get YouTube analytics',
      success: false,
      details: error.message 
    });
  }
});

module.exports = router;