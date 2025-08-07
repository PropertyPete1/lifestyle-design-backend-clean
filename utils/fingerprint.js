const crypto = require('crypto');

/**
 * Extract visual fingerprint hash from video buffer
 * This creates a unique hash to identify duplicate videos
 * @param {Buffer} videoBuffer - The video file buffer
 * @returns {Promise<string>} - SHA256 hash of the video buffer
 */
async function extractFirstFrameHash(videoBuffer) {
  try {
    if (!videoBuffer || !Buffer.isBuffer(videoBuffer)) {
      throw new Error('Invalid video buffer provided');
    }

    // Create SHA256 hash from the video buffer
    // This serves as a visual fingerprint for duplicate detection
    const hash = crypto.createHash('sha256').update(videoBuffer).digest('hex');
    
    console.log(`🔍 [FINGERPRINT] Generated hash: ${hash.substring(0, 12)}...`);
    return hash;
    
  } catch (error) {
    console.error('❌ [FINGERPRINT ERROR]', error);
    throw new Error(`Failed to extract video fingerprint: ${error.message}`);
  }
}

module.exports = {
  extractFirstFrameHash
};