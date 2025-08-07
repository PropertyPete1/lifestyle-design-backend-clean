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
    console.log(`🕷️ [IG SCRAPER] Scraping ${limit} videos for engagement data`);
    
    const videos = [];
    let nextPageUrl = `https://graph.facebook.com/v19.0/${businessId}/media?fields=id,media_type,media_url,thumbnail_url,caption,like_count,comments_count,timestamp,permalink&limit=50&access_token=${accessToken}`;
    
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
          const engagement = (media.like_count || 0) + (media.comments_count || 0);
          
          videos.push({
            id: media.id,
            url: media.media_url,
            thumbnailUrl: media.thumbnail_url,
            caption: media.caption || '',
            likes: media.like_count || 0,
            comments: media.comments_count || 0,
            engagement: engagement,
            timestamp: media.timestamp,
            permalink: media.permalink,
            thumbnailHash: await generateThumbnailHash(media.thumbnail_url),
            fingerprint: await generateThumbnailHash(media.thumbnail_url) // Use visual hash as fingerprint
          });
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
    return [];
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

module.exports = {
  scrapeInstagramEngagement,
  generateFingerprint,
  generateThumbnailHash,
  downloadVideoFromInstagram
};
