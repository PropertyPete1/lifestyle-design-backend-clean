/**
 * Post Executor Service - Actually posts content to Instagram and YouTube
 * This is the missing piece that executes scheduled posts from the queue
 */

const fetch = require('node-fetch');
const FormData = require('form-data');

/**
 * Wait for Instagram media to be ready for publishing
 * @param {string} containerId - Instagram media container ID
 * @param {string} accessToken - Instagram access token
 */
async function waitForInstagramMediaReady(containerId, accessToken) {
  console.log('🔍 [IG STATUS] Checking media readiness...');
  
  const maxAttempts = 12; // 12 attempts = up to 2 minutes additional wait
  const delayMs = 10000; // 10 seconds between checks
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const statusResponse = await fetch(
        `https://graph.facebook.com/v18.0/${containerId}?fields=status_code&access_token=${accessToken}`
      );
      
      const statusData = await statusResponse.json();
      console.log(`🔍 [IG STATUS] Attempt ${attempt}/${maxAttempts} - Status:`, statusData);
      
      if (statusData.status_code === 'FINISHED') {
        console.log('✅ [IG STATUS] Media is ready for publishing!');
        return;
      }
      
      if (statusData.status_code === 'ERROR') {
        throw new Error(`Instagram media processing failed: ${JSON.stringify(statusData)}`);
      }
      
      if (attempt < maxAttempts) {
        console.log(`⏳ [IG STATUS] Media not ready yet (${statusData.status_code}), waiting ${delayMs/1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    } catch (error) {
      console.error(`❌ [IG STATUS] Error checking media status (attempt ${attempt}):`, error.message);
      if (attempt === maxAttempts) {
        throw new Error(`Failed to verify media readiness after ${maxAttempts} attempts`);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  
  throw new Error('Instagram media did not become ready within the expected timeframe');
}

/**
 * Post video to Instagram using Graph API
 * @param {Object} postData - Post data from queue
 * @param {Object} settings - User settings with tokens
 * @returns {Promise<Object>} Post result
 */
async function postToInstagram(postData, settings) {
  try {
    // ✅ Sanity check: log scheduled time + caption
    console.log(`🕖 [POST TO IG] Running for ${postData.scheduledTime} | Caption: ${postData.caption?.slice(0, 40)}...`);
    console.log('📱 [INSTAGRAM POST] Starting Instagram post...');
    
    if (!settings.instagramToken || !settings.igBusinessId) {
      throw new Error('Missing Instagram credentials');
    }
    
    // ✅ Extract data from Mongoose document (handle both plain objects and Mongoose docs)
    const cleanPostData = postData.toObject ? postData.toObject() : postData;
    const { videoUrl, caption, trendingAudio } = cleanPostData;
    
    // 🧪 [DEBUG] Full post data analysis
    console.log('📱 [INSTAGRAM POST] Starting Instagram post...');
    console.log('🧪 [DEBUG] Full postData received:', JSON.stringify(postData, null, 2));
    console.log('🔗 [IG DEBUG] Video URL:', videoUrl);
    console.log('📝 [IG DEBUG] Caption length:', caption ? caption.length : 'null');
    console.log('🎵 [IG DEBUG] Trending audio:', trendingAudio || 'none');
    
    // ✅ Make sure S3 upload completed BEFORE creating media container
    if (!videoUrl) {
      console.error('❌ [CRITICAL] Video URL is undefined/null');
      console.error('🔍 [DEBUG] PostData keys:', Object.keys(postData));
      throw new Error('Video URL is undefined - S3 upload failed');
    }
    
    // 🧪 [DEBUG] Validate URL format
    if (!videoUrl.startsWith('http')) {
      console.error('❌ [CRITICAL] Video URL invalid format:', videoUrl);
      throw new Error('Video URL is not a valid HTTP URL');
    }
    
    console.log('✅ [VALIDATION] Video URL is valid, proceeding with Instagram API...');
    
    // ✅ Wait for Instagram media to be ready before publishing (FIX 1)
    console.log('⏰ [IG] Waiting 90 seconds for Instagram video processing...');
    await new Promise((resolve) => setTimeout(resolve, 90000)); // wait 90 sec
    console.log('✅ [IG] Instagram video processing wait completed');
    
    // ✅ Step 1: Create container
    const containerParams = new URLSearchParams({
      media_type: 'REELS',
      video_url: videoUrl, // ✅ must be public S3 link
      caption: caption,
      access_token: settings.instagramToken,
      share_to_feed: 'true'
    });
    
    if (trendingAudio) {
      containerParams.append('audio_name', trendingAudio);
    }
    
    // 🧪 [DEBUG] Instagram API call details
    console.log('📤 [IG API] Creating media container...');
    console.log('🔗 [IG API] URL:', `https://graph.facebook.com/v18.0/${settings.igBusinessId}/media`);
    console.log('📋 [IG API] Parameters:', Object.fromEntries(containerParams));
    
    const containerResponse = await fetch(
      `https://graph.facebook.com/v18.0/${settings.igBusinessId}/media`,
      {
        method: 'POST',
        body: containerParams
      }
    );
    
    console.log('📥 [IG API] Container response status:', containerResponse.status);
    
    const containerData = await containerResponse.json();
    
    console.log('📝 [IG API] Container response data:', JSON.stringify(containerData, null, 2));
    
    if (!containerData.id) {
      console.error('❌ [IG ERROR] Failed to create media container');
      console.error('🔍 [IG ERROR] Response details:', containerData);
      throw new Error(`Instagram container creation failed: ${JSON.stringify(containerData)}`);
    }
    
    console.log('📦 [INSTAGRAM] Media container created:', containerData.id);
    
    // ✅ Step 1.5: Check media status before publishing (NEW FIX)
    await waitForInstagramMediaReady(containerData.id, settings.instagramToken);
    
    // ✅ Step 2: Publish the post
    const publishParams = new URLSearchParams({
      creation_id: containerData.id,
      access_token: settings.instagramToken
    });
    
    const publishResponse = await fetch(
      `https://graph.facebook.com/v18.0/${settings.igBusinessId}/media_publish`,
      {
        method: 'POST',
        body: publishParams
      }
    );
    
    const publishData = await publishResponse.json();
    
    if (!publishData.id) {
      console.error('❌ [IG ERROR] Failed to publish media:', publishData);
      throw new Error('Instagram post publish failed');
    }
    
    console.log(`✅ [IG POSTED] Post ID: ${publishData.id}`);
    
    return {
      success: true,
      platform: 'instagram',
      postId: publishData.id,
      url: `https://www.instagram.com/p/${publishData.id}`,
      caption: caption
    };
    
  } catch (error) {
    console.error('🚨 [POST TO IG ERROR]', error);
    return false;
  }
}

/**
 * Refresh YouTube access token using refresh token
 * @param {Object} settings - User settings with tokens
 * @returns {Promise<string>} New access token
 */
async function refreshYouTubeToken(settings) {
  try {
    console.log('🔄 [YOUTUBE AUTH] Refreshing access token...');
    
    if (!settings.youtubeRefreshToken || !settings.youtubeClientId || !settings.youtubeClientSecret) {
      throw new Error('Missing YouTube refresh credentials');
    }
    
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: settings.youtubeClientId,
        client_secret: settings.youtubeClientSecret,
        refresh_token: settings.youtubeRefreshToken,
        grant_type: 'refresh_token'
      })
    });
    
    const tokenData = await tokenResponse.json();
    
    if (!tokenResponse.ok) {
      throw new Error(`Token refresh failed: ${tokenData.error_description || tokenData.error}`);
    }
    
    console.log('✅ [YOUTUBE AUTH] Token refreshed successfully');
    return tokenData.access_token;
    
  } catch (error) {
    console.error('❌ [YOUTUBE AUTH] Token refresh error:', error);
    throw error;
  }
}

/**
 * Post video to YouTube using YouTube Data API
 * @param {Object} postData - Post data from queue
 * @param {Object} settings - User settings with tokens
 * @returns {Promise<Object>} Post result
 */
async function postToYouTube(postData, settings) {
  try {
    console.log('📺 [YOUTUBE POST] Starting YouTube upload...');
    
    if (!settings.youtubeRefreshToken || !settings.youtubeClientId || !settings.youtubeClientSecret) {
      throw new Error('Missing YouTube credentials');
    }
    
    // Always refresh token to ensure it's valid
    const freshAccessToken = await refreshYouTubeToken(settings);
    
    // Optionally save the new token back to settings (for efficiency in future calls)
    try {
      const SettingsModel = require('mongoose').model('SettingsClean');
      await SettingsModel.updateOne({}, { youtubeAccessToken: freshAccessToken });
      console.log('💾 [YOUTUBE AUTH] Updated access token in database');
    } catch (saveError) {
      console.log('⚠️ [YOUTUBE AUTH] Could not save token to database (not critical):', saveError.message);
    }
    
    // ✅ Extract data from Mongoose document (handle both plain objects and Mongoose docs)
    const cleanPostData = postData.toObject ? postData.toObject() : postData;
    const { videoUrl, caption } = cleanPostData;
    const s3Url = videoUrl; // YouTube uses same video URL
    
    // Download video from S3
    console.log('⬇️ [YOUTUBE] Downloading video from S3...');
    const videoResponse = await fetch(s3Url);
    const videoBuffer = await videoResponse.buffer();
    
    // Create form data for upload
    const formData = new FormData();
    formData.append('snippet', JSON.stringify({
      title: caption.substring(0, 100), // YouTube title limit
      description: caption,
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
      caption: caption
    };
    
  } catch (error) {
    console.error('❌ [YOUTUBE POST ERROR]', error);
    return {
      success: false,
      platform: 'youtube',
      error: error.message,
      caption: postData.caption
    };
  }
}

/**
 * Execute a scheduled post from the queue
 * @param {Object} queueItem - Scheduled post from SchedulerQueueModel
 * @param {Object} settings - User settings
 * @returns {Promise<Object>} Execution result
 */
async function executeScheduledPost(queueItem, settings) {
  try {
    console.log(`🚀 [POST EXECUTOR] Executing ${queueItem.platform} post: ${queueItem._id}`);
    
    let result;
    
    if (queueItem.platform === 'instagram') {
      result = await postToInstagram(queueItem, settings);
    } else if (queueItem.platform === 'youtube') {
      result = await postToYouTube(queueItem, settings);
    } else {
      throw new Error(`Unsupported platform: ${queueItem.platform}`);
    }
    
    return {
      ...result,
      queueId: queueItem._id,
      scheduledTime: queueItem.scheduledTime,
      actualTime: new Date()
    };
    
  } catch (error) {
    console.error('❌ [POST EXECUTOR ERROR]', error);
    return {
      success: false,
      queueId: queueItem._id,
      platform: queueItem.platform,
      error: error.message,
      scheduledTime: queueItem.scheduledTime,
      actualTime: new Date()
    };
  }
}

module.exports = {
  postToInstagram,
  postToYouTube,
  executeScheduledPost,
  refreshYouTubeToken
};