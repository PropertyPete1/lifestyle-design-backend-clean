/**
 * YouTube Posting Service for Post Now
 * Posts videos to YouTube using YouTube Data API
 */

const fetch = require('node-fetch');
const FormData = require('form-data');

/**
 * Refresh YouTube access token
 */
async function refreshYouTubeToken(settings) {
  const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
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
  
  if (!refreshResponse.ok) {
    throw new Error(`Token refresh failed: ${refreshData.error_description || refreshData.error}`);
  }
  
  return refreshData.access_token;
}

/**
 * Post video to YouTube with real Data API implementation
 * @param {Object} options - Posting options
 * @param {string} options.videoUrl - S3 video URL
 * @param {string} options.caption - Video caption
 * @param {string} options.thumbnailHash - Visual hash for tracking
 * @param {string} options.source - Source identifier (postNow)
 * @returns {Promise<Object>} Result object
 */
async function postToYouTube(options) {
  try {
    console.log('📺 [YOUTUBE] Post Now called with:', {
      videoUrl: options.videoUrl?.substring(0, 50) + '...',
      caption: options.caption?.substring(0, 50) + '...',
      source: options.source,
      thumbnailHash: options.thumbnailHash?.substring(0, 12) + '...'
    });

    // Get settings for YouTube credentials (avoid model overwrite)
    const mongoose = require('mongoose');
    let SettingsModel;
    try {
      SettingsModel = mongoose.model('SettingsClean');
    } catch (error) {
      SettingsModel = require('../src/models/settings');
    }
    const settings = await SettingsModel.findOne({});
    
    if (!settings || !settings.youtubeRefreshToken || !settings.youtubeClientId || !settings.youtubeClientSecret) {
      throw new Error('Missing YouTube credentials in settings');
    }

    const { videoUrl, caption } = options;
    
    if (!videoUrl) {
      throw new Error('Video URL is required for YouTube posting');
    }

    console.log('📺 [YOUTUBE POST] Starting YouTube upload...');
    
    // Refresh access token
    const freshAccessToken = await refreshYouTubeToken(settings);
    
    // Optionally save the new token back to settings
    try {
      await SettingsModel.updateOne({}, { youtubeAccessToken: freshAccessToken });
      console.log('💾 [YOUTUBE AUTH] Updated access token in database');
    } catch (saveError) {
      console.log('⚠️ [YOUTUBE AUTH] Could not save token to database (not critical):', saveError.message);
    }
    
    // Download video from S3
    console.log('⬇️ [YOUTUBE] Downloading video from S3...');
    const videoResponse = await fetch(videoUrl);
    const videoBuffer = await videoResponse.buffer();
    
    // Create form data for upload
    const formData = new FormData();
    formData.append('snippet', JSON.stringify({
      title: caption.substring(0, 100), // YouTube title limit
      description: caption || 'Posted via Post Now',
      tags: ['realestate', 'lifestyle', 'property'],
      categoryId: '26' // How-to & Style category
    }));
    formData.append('status', JSON.stringify({
      privacyStatus: 'public'
    }));
    formData.append('media', videoBuffer, {
      filename: 'video.mp4',
      contentType: 'video/mp4'
    });
    
    const uploadResponse = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${freshAccessToken}`,
          ...formData.getHeaders()
        },
        body: formData
      }
    );
    
    const uploadData = await uploadResponse.json();
    
    if (!uploadResponse.ok) {
      throw new Error(`YouTube upload failed: ${uploadData.error?.message || 'Unknown error'}`);
    }
    
    console.log('✅ [YOUTUBE] Video uploaded successfully:', uploadData.id);
    
    return {
      success: true,
      platform: 'youtube',
      postId: uploadData.id,
      url: `https://www.youtube.com/watch?v=${uploadData.id}`,
      message: 'Posted successfully to YouTube'
    };
    
  } catch (error) {
    console.error('❌ [YOUTUBE] Post Now failed:', error);
    return {
      success: false,
      platform: 'youtube',
      error: error.message
    };
  }
}

module.exports = {
  postToYouTube
};