/**
 * Instagram Posting Service for Post Now
 * Posts videos to Instagram using Graph API
 */

const fetch = require('node-fetch');

/**
 * Post video to Instagram with real Graph API implementation
 * @param {Object} options - Posting options
 * @param {string} options.videoUrl - S3 video URL
 * @param {string} options.caption - Video caption
 * @param {string} options.thumbnailHash - Visual hash for tracking
 * @param {string} options.source - Source identifier (postNow)
 * @returns {Promise<Object>} Result object
 */
async function postToInstagram(options) {
  try {
    console.log('📱 [INSTAGRAM] Post Now called with:', {
      videoUrl: options.videoUrl?.substring(0, 50) + '...',
      caption: options.caption?.substring(0, 50) + '...',
      source: options.source,
      thumbnailHash: options.thumbnailHash?.substring(0, 12) + '...'
    });

    // Get settings for Instagram credentials
    const SettingsModel = require('../src/models/settings');
    const settings = await SettingsModel.findOne({});
    
    if (!settings || !settings.instagramToken || !settings.igBusinessId) {
      throw new Error('Missing Instagram credentials in settings');
    }

    const { videoUrl, caption } = options;
    
    if (!videoUrl) {
      throw new Error('Video URL is required for Instagram posting');
    }

    // Wait for Instagram video processing
    console.log('⏰ [IG] Waiting 90 seconds for Instagram video processing...');
    await new Promise((resolve) => setTimeout(resolve, 90000));
    console.log('✅ [IG] Instagram video processing wait completed');
    
    // Step 1: Create media container
    const containerParams = new URLSearchParams({
      media_type: 'REELS',
      video_url: videoUrl,
      caption: caption || 'Posted via Post Now',
      access_token: settings.instagramToken,
      share_to_feed: 'true'
    });
    
    console.log('📤 [IG API] Creating media container...');
    const containerResponse = await fetch(
      `https://graph.facebook.com/v18.0/${settings.igBusinessId}/media`,
      {
        method: 'POST',
        body: containerParams
      }
    );
    
    const containerData = await containerResponse.json();
    
    if (!containerResponse.ok) {
      throw new Error(`Instagram container creation failed: ${containerData.error?.message || 'Unknown error'}`);
    }
    
    const containerId = containerData.id;
    console.log('✅ [IG API] Container created:', containerId);
    
    // Step 2: Wait for processing
    console.log('⏰ [IG] Waiting for container processing...');
    await new Promise((resolve) => setTimeout(resolve, 30000));
    
    // Step 3: Publish the media
    const publishParams = new URLSearchParams({
      creation_id: containerId,
      access_token: settings.instagramToken
    });
    
    console.log('📤 [IG API] Publishing media...');
    const publishResponse = await fetch(
      `https://graph.facebook.com/v18.0/${settings.igBusinessId}/media_publish`,
      {
        method: 'POST',
        body: publishParams
      }
    );
    
    const publishData = await publishResponse.json();
    
    if (!publishResponse.ok) {
      throw new Error(`Instagram publish failed: ${publishData.error?.message || 'Unknown error'}`);
    }
    
    console.log('✅ [INSTAGRAM] Post published successfully:', publishData.id);
    
    return {
      success: true,
      platform: 'instagram',
      postId: publishData.id,
      message: 'Posted successfully to Instagram'
    };
    
  } catch (error) {
    console.error('❌ [INSTAGRAM] Post Now failed:', error);
    return {
      success: false,
      platform: 'instagram',
      error: error.message
    };
  }
}

module.exports = {
  postToInstagram
};