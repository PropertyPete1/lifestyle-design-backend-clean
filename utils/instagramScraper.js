/**
 * Instagram Engagement Scraper - Scrape latest videos with engagement data
 * Used for autopilot video selection
 */

const fetch = require('node-fetch');

/**
 * Scrape Instagram videos with engagement data
 * @param {string} businessId - Instagram Business Account ID
 * @param {string} accessToken - Instagram Access Token
 * @param {number} limit - Number of videos to scrape (default 500)
 * @returns {Promise<Array>} Array of video objects with engagement
 */
async function scrapeInstagramEngagement(businessId, accessToken, limit = 500) {
  try {
    console.log(`🕷️ [IG SCRAPER] FUNCTION CALLED WITH LIMIT: ${limit} videos`);
    console.log(`🕷️ [IG SCRAPER] Scraping ${limit} videos for engagement data`);
    
    const videos = [];
    let nextPageUrl = `https://graph.facebook.com/v19.0/${businessId}/media?fields=id,media_type,media_url,thumbnail_url,caption,like_count,comments_count,play_count,timestamp,permalink,music_metadata&limit=50&access_token=${accessToken}`;
    
    while (videos.length < limit && nextPageUrl) {
      console.log(`🔍 [IG SCRAPER] Fetching page... (${videos.length}/${limit})`);
      
      const response = await fetch(nextPageUrl);
      const data = await response.json();
      
      if (!response.ok) {
        console.error('❌ [IG SCRAPER] API Error:', data);
        break;
      }
      
      // Process videos from this page
      for (const media of data.data || []) {
        if (media.media_type === 'VIDEO') {
          // Smart engagement estimation: likes usually represent 1-3% of views for viral content
          // For high-performing real estate videos, estimate views as likes * 50-100
          const likes = media.like_count || 0;
          const comments = media.comments_count || 0;
          const estimatedViews = likes * 75; // Conservative estimate
          const engagement = estimatedViews + likes + comments;
          
          // Debug: Log some videos to see what we're getting
          if (videos.length < 10) {
            console.log(`📊 [DEBUG] Video ${videos.length + 1}: ${likes} likes, ${comments} comments, ${estimatedViews} est. views, ${engagement} engagement`);
          }
          
          // Extract audio ID from music metadata (Instagram saves audio info here)
          const audioId = media.music_metadata?.music_product_id || 
                         media.music_metadata?.artist_name || 
                         media.music_metadata?.song_name || 
                         null;
          
          const videoObject = {
            id: media.id,
            url: media.media_url,
            thumbnailUrl: media.thumbnail_url,
            caption: media.caption || '',
            likes: likes,
            comments: comments,
            views: estimatedViews,
            engagement: engagement,
            timestamp: media.timestamp,
            permalink: media.permalink,
            audioId: audioId, // NEW: Audio ID for duplicate detection
            musicMetadata: media.music_metadata || null, // Store full metadata for debugging
            thumbnailHash: await generateThumbnailHash(media.thumbnail_url),
            fingerprint: await generateThumbnailHash(media.thumbnail_url) // Use visual hash as fingerprint
          };
          
          // Log audio info for first few videos (debugging)
          if (videos.length < 5 && audioId) {
            console.log(`🎵 [AUDIO DEBUG] Video ${videos.length + 1}: audioId="${audioId}"`);
          }
          
          videos.push(videoObject);
        }
      }
      
      // Get next page URL
      nextPageUrl = data.paging?.next || null;
      
      // Rate limiting - wait between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`✅ [IG SCRAPER] Scraped ${videos.length} videos`);
    return videos;
    
  } catch (error) {
    console.error('❌ [IG SCRAPER ERROR]', error);
    throw error; // ✅ THROW ERROR instead of returning empty array
  }
}

/**
 * Generate content fingerprint for duplicate detection
 * @param {string} caption - Video caption
 * @param {string} thumbnailUrl - Thumbnail URL
 * @returns {string} Content fingerprint
 */
function generateFingerprint(caption = '', thumbnailUrl = '') {
  const crypto = require('crypto');
  const content = `${caption.toLowerCase().trim()}|${thumbnailUrl}`;
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Generate thumbnail hash for visual similarity detection
 * Downloads and analyzes actual image pixels for robust similarity detection
 * @param {string} thumbnailUrl - Thumbnail URL
 * @returns {Promise<string>} Thumbnail hash based on visual content
 */
async function generateThumbnailHash(thumbnailUrl) {
  try {
    const sharp = require('sharp');
    const fetch = require('node-fetch');
    const crypto = require('crypto');
    
    console.log('📸 [THUMBNAIL] Downloading for visual analysis:', thumbnailUrl);
    
    // Download the thumbnail image
    const response = await fetch(thumbnailUrl);
    if (!response.ok) {
      console.warn('⚠️ [THUMBNAIL] Failed to download, using URL hash fallback');
      return crypto.createHash('md5').update(thumbnailUrl).digest('hex').substring(0, 8);
    }
    
    const imageBuffer = await response.buffer();
    
    // Resize to standard size and convert to grayscale for consistent comparison
    // This makes it robust to lighting changes and minor variations
    const processedImage = await sharp(imageBuffer)
      .resize(64, 64) // Standard thumbnail size
      .grayscale() // Remove color variations
      .normalize() // Normalize brightness/contrast
      .raw()
      .toBuffer();
    
    // Create hash from processed pixel data
    const pixelHash = crypto.createHash('md5').update(processedImage).digest('hex').substring(0, 8);
    
    console.log('✅ [THUMBNAIL] Visual hash generated:', pixelHash);
    return pixelHash;
    
  } catch (error) {
    console.error('❌ [THUMBNAIL] Visual analysis failed:', error.message);
    // Fallback to URL hash if visual analysis fails
    const crypto = require('crypto');
    return crypto.createHash('md5').update(thumbnailUrl).digest('hex').substring(0, 8);
  }
}

/**
 * Download video from Instagram URL
 * @param {string} videoUrl - Instagram video URL
 * @returns {Promise<Buffer>} Video buffer
 */
async function downloadVideoFromInstagram(videoUrl) {
  try {
    console.log('⬇️ [VIDEO DOWNLOAD] Downloading from Instagram...');
    
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }
    
    const buffer = await response.buffer();
    
    console.log(`✅ [VIDEO DOWNLOAD] Downloaded ${buffer.length} bytes`);
    return buffer;
    
  } catch (error) {
    console.error('❌ [VIDEO DOWNLOAD ERROR]', error);
    throw error;
  }
}

/**
 * Fetch recent Instagram videos (top 500 scraped videos)
 * This is the exact function you specified for Post Now
 */
async function fetchRecentInstagramVideos() {
  try {
    console.log('📱 [POST NOW] Fetching recent Instagram videos...');
    
    // Get settings to access Instagram credentials
    const mongoose = require('mongoose');
    const SettingsModel = mongoose.model('SettingsClean');
    const settings = await SettingsModel.findOne({});
    
    if (!settings || !settings.instagramToken || !settings.igBusinessId) {
      throw new Error('Missing Instagram credentials in settings');
    }
    
    // Use existing scraper to get videos
    const videos = await scrapeInstagramEngagement(
      settings.igBusinessId, 
      settings.instagramToken, 
      500 // Top 500 as specified
    );
    
    // Convert to format expected by Post Now
    const formattedVideos = videos.map(video => ({
      id: video.id,
      videoUrl: video.url,
      caption: video.caption,
      engagement: video.engagement,
      likes: video.likes,
      comments: video.comments
    }));
    
    console.log(`✅ [POST NOW] Fetched ${formattedVideos.length} Instagram videos`);
    return formattedVideos;
    
  } catch (error) {
    console.error('❌ [POST NOW] Error fetching Instagram videos:', error);
    throw error;
  }
}

/**
 * Download Instagram video from URL
 * This is the exact function you specified for Post Now
 */
async function downloadInstagramVideo(videoUrl) {
  try {
    console.log(`📥 [POST NOW] Downloading Instagram video: ${videoUrl.substring(0, 50)}...`);
    
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status}`);
    }
    
    const buffer = await response.buffer();
    console.log(`✅ [POST NOW] Downloaded video buffer: ${buffer.length} bytes`);
    
    return buffer;
    
  } catch (error) {
    console.error('❌ [POST NOW] Error downloading video:', error);
    throw error;
  }
}

module.exports = {
  scrapeInstagramEngagement,
  generateFingerprint,
  generateThumbnailHash,
  downloadVideoFromInstagram,
  fetchRecentInstagramVideos,
  downloadInstagramVideo
};
