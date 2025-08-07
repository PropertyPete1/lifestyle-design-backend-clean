/**
 * Post Executor Service - Actually posts content to Instagram and YouTube
 * This is the missing piece that executes scheduled posts from the queue
 */

const fetch = require('node-fetch');
const FormData = require('form-data');

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
    
    const { videoUrl, caption, trendingAudio } = postData;
    
    console.log(`🔗 [IG DEBUG] Video URL: ${videoUrl}`);
    
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
    
    const containerResponse = await fetch(
      `https://graph.facebook.com/v18.0/${settings.igBusinessId}/media`,
      {
        method: 'POST',
        body: containerParams
      }
    );
    
    const containerData = await containerResponse.json();
    
    if (!containerData.id) {
      console.error('❌ [IG ERROR] Failed to create media container:', containerData);
      throw new Error('Instagram container creation failed');
    }
    
    console.log('📦 [INSTAGRAM] Media container created:', containerData.id);
    
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
 * Post video to YouTube using YouTube Data API
 * @param {Object} postData - Post data from queue
 * @param {Object} settings - User settings with tokens
 * @returns {Promise<Object>} Post result
 */
async function postToYouTube(postData, settings) {
  try {
    console.log('📺 [YOUTUBE POST] Starting YouTube upload...');
    
    if (!settings.youtubeAccessToken) {
      throw new Error('Missing YouTube credentials');
    }
    
    const { s3Url, caption } = postData;
    
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
          'Authorization': `Bearer ${settings.youtubeAccessToken}`,
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
  executeScheduledPost
};