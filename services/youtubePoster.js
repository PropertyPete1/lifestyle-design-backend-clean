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
    
    // Build YouTube metadata: title, description, tags
    function extractHashtags(text = '') {
      const matches = (text.match(/#[A-Za-z0-9_]+/g) || []).map(h => h.replace('#', '').toLowerCase());
      return Array.from(new Set(matches));
    }
    function stripCta(text = '') {
      return text.replace(/\n/g, ' ')
        .replace(/⬆️/g, '')
        .replace(/⬇️/g, '')
        .replace(/link in bio/gi, '')
        .replace(/link in profile/gi, '')
        .replace(/dm\s*“?info”?/gi, '')
        .replace(/dm\s*"?info"?/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    }
    function extractCity(text = '') {
      const m = text.match(/\bin\s+([A-Za-z][A-Za-z\s]{1,30})\b/);
      if (!m) return null;
      const city = m[1].trim();
      if (/^bio$/i.test(city) || /^profile$/i.test(city)) return null;
      // Title case
      return city.replace(/\b([a-z])(\w*)/g, (_, a, b) => a.toUpperCase() + b.toLowerCase());
    }
    function extractRate(text = '') {
      const m = text.match(/(\d{1,2}(?:\.\d{1,2})?)%/);
      return m ? `${m[1]}% Rate` : null;
    }
    function extractClosingCosts(text = '') {
      if (/closing costs/i.test(text)) {
        if (/all|paid|covered/i.test(text)) return 'Closing Costs Paid';
        return 'Closing Costs Incentive';
      }
      return null;
    }
    function extractPrice(text = '') {
      const m = text.match(/\$\s?([0-9]{2,3}(?:,[0-9]{3})+)/);
      return m ? `$${m[1]}` : null;
    }
    function summarizeForTitle(raw = '') {
      const text = stripCta(raw.replace(/#[^\s]+/g, ''));
      const city = extractCity(text);
      const rate = extractRate(text);
      const cc = extractClosingCosts(text);
      const price = extractPrice(text);
      const parts = [];
      if (cc) parts.push(cc);
      if (rate) parts.push(rate);
      if (price && city) parts.push(`${price} • ${city}`);
      else if (city) parts.push(`New Homes in ${city}`);
      else if (price) parts.push(`Homes from ${price}`);
      const base = parts.length ? parts.join(' • ') : 'New Homes Available';
      return base.slice(0, 95);
    }
    function buildTrendingList() {
      const envList = (process.env.TRENDING_HASHTAGS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (envList.length) return envList;
      return ['realestate','reels','viral','househunting','luxuryhomes','interiordesign','realtor','dreamhome','architecture','property'];
    }
    const userTags = extractHashtags(caption);
    const trending = buildTrendingList();
    // Replace up to 2 of the user tags with trending ones not already included
    const finalTags = [...userTags];
    for (const t of trending) {
      if (finalTags.length >= 12) break;
      if (!finalTags.includes(t)) finalTags.push(t);
    }
    // Limit tags to 12
    const limitedTags = finalTags.slice(0, 12);
    // Only add CTA if not already present anywhere
    const hasCta = /(link in bio|link in profile)/i.test(caption || '');
    const captionWithCta = hasCta ? caption : `⬆️ Fill out the link in bio for info ⬆️\n\n${caption}`;

    // Build title from description highlights (no hashtags, no CTA)
    const baseTitle = summarizeForTitle(captionWithCta);
    // Keep original caption; append hashtags if not already present
    const existingHashtags = extractHashtags(captionWithCta);
    const extra = limitedTags.filter(t => !existingHashtags.includes(t));
    const hashtagsLine = extra.length ? extra.map(t => `#${t}`).join(' ') : '';
    const title = baseTitle;
    // Description uses the IG caption with CTA + the full hashtag list
    const description = (hashtagsLine ? `${captionWithCta}\n\n${hashtagsLine}` : captionWithCta).slice(0, 4900);

    // Use Resumable upload to avoid multipart issues
    const initMetadata = {
      snippet: {
        title,
        description,
        tags: limitedTags,
        categoryId: '26'
      },
      status: {
        privacyStatus: 'public'
      }
    };

    console.log('📺 [YOUTUBE] Initiating resumable upload...');
    const initResp = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status,recordingDetails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${freshAccessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': String(videoBuffer.length)
      },
      body: JSON.stringify({
        ...initMetadata,
        recordingDetails: {
          locationDescription: 'Texas',
          location: { latitude: 31.0, longitude: -100.0, altitude: 0 }
        }
      })
    });
    if (!initResp.ok) {
      const t = await initResp.text();
      throw new Error(`YouTube init failed: ${t}`);
    }
    const uploadUrl = initResp.headers.get('location');
    if (!uploadUrl) throw new Error('YouTube init missing upload URL');

    console.log('📺 [YOUTUBE] Uploading video bytes...');
    const contentRange = `bytes 0-${videoBuffer.length - 1}/${videoBuffer.length}`;
    const putResp = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${freshAccessToken}`,
        'Content-Type': 'video/mp4',
        'Content-Length': String(videoBuffer.length),
        'Content-Range': contentRange
      },
      body: videoBuffer
    });
    let uploadData;
    try {
      uploadData = await putResp.json();
    } catch (_) {
      const txt = await putResp.text();
      throw new Error(`YouTube upload response not JSON: ${txt.slice(0, 200)}`);
    }
    if (!putResp.ok) {
      throw new Error(`YouTube upload failed: ${uploadData.error?.message || 'Unknown error'}`);
    }
    
    console.log('✅ [YOUTUBE] Video uploaded successfully:', uploadData.id);

    // Upload custom thumbnail using first frame (0s)
    try {
      const { generateThumbnailBuffer } = require('../utils/videoThumbnail');
      const thumbBuffer = await generateThumbnailBuffer(videoUrl, 0.0);
      const boundary = '-------thumb-' + Math.random().toString(36).slice(2);
      const multipartBody = Buffer.concat([
        Buffer.from(`--${boundary}\r\n` +
                    'Content-Disposition: form-data; name="media"; filename="thumb.jpg"\r\n' +
                    'Content-Type: image/jpeg\r\n\r\n'),
        thumbBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`)
      ]);
      const thumbResp = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${uploadData.id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${freshAccessToken}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(multipartBody.length)
        },
        body: multipartBody
      });
      if (!thumbResp.ok) {
        const tt = await thumbResp.text();
        console.log('⚠️ [YOUTUBE] Thumbnail upload failed:', tt.slice(0, 200));
      } else {
        console.log('🖼️ [YOUTUBE] Custom thumbnail set from first frame');
      }
    } catch (thumbErr) {
      console.log('⚠️ [YOUTUBE] Could not set custom thumbnail:', thumbErr.message);
    }
    
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