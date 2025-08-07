/**
 * Post History Management - Visual Thumbnail Analysis
 * Handles duplicate detection using visual thumbnail hashing
 */

const crypto = require('crypto');

/**
 * Generate visual hash from thumbnail URL using Sharp
 * @param {string} thumbnailUrl - URL of the thumbnail image
 * @returns {Promise<string>} Visual hash string
 */
async function generateThumbnailHash(thumbnailUrl) {
  try {
    console.log(`📸 [THUMBNAIL] Downloading for visual analysis: ${thumbnailUrl}`);
    
    const sharp = require('sharp');
    const fetch = require('node-fetch');
    
    // Download thumbnail
    const response = await fetch(thumbnailUrl);
    if (!response.ok) {
      console.log(`❌ [THUMBNAIL] Failed to download: ${response.status}`);
      return crypto.createHash('md5').update(thumbnailUrl).digest('hex').substring(0, 8);
    }
    
    const buffer = await response.buffer();
    
    // Process image: resize → grayscale → normalize → hash
    const processedBuffer = await sharp(buffer)
      .resize(64, 64) // Standardize size
      .grayscale() // Remove color variations
      .normalize() // Normalize brightness/contrast
      .raw() // Get raw pixel data
      .toBuffer();
    
    // Generate hash from pixel data
    const hash = crypto.createHash('md5').update(processedBuffer).digest('hex').substring(0, 8);
    
    console.log(`✅ [THUMBNAIL] Visual hash generated: ${hash}`);
    return hash;
    
  } catch (error) {
    console.log(`❌ [THUMBNAIL] Visual analysis failed:`, error.message);
    
    // Fallback: URL-based hash
    const fallbackHash = crypto.createHash('md5').update(thumbnailUrl).digest('hex').substring(0, 8);
    console.log(`🔄 [THUMBNAIL] Using URL fallback hash: ${fallbackHash}`);
    return fallbackHash;
  }
}

module.exports = {
  generateThumbnailHash
};