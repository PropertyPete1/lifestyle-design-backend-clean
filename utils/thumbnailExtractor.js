/**
 * Thumbnail Extraction Utility - Extract first frame and generate thumbnails
 * Creates thumbnails from videos for preview and visual similarity detection
 */

const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

/**
 * Extract first frame (0 seconds) as thumbnail
 * @param {string} videoPath - Path to video file
 * @param {string} outputPath - Path for thumbnail output (optional)
 * @returns {Promise<string>} Path to thumbnail image
 */
async function extractFirstFrame(videoPath, outputPath = null) {
  return new Promise((resolve, reject) => {
    try {
      console.log('📸 [THUMBNAIL] Extracting first frame...');
      
      // Generate output path if not provided
      if (!outputPath) {
        const dir = path.dirname(videoPath);
        const filename = path.basename(videoPath, path.extname(videoPath));
        outputPath = path.join(dir, `${filename}_thumbnail.jpg`);
      }
      
      ffmpeg(videoPath)
        .seekInput(0) // Extract frame at 0 seconds
        .frames(1)    // Extract only 1 frame
        .output(outputPath)
        .outputOptions([
          '-q:v 2',        // High quality JPEG (1-31, lower = better)
          '-vf scale=640:640:force_original_aspect_ratio=increase,crop=640:640' // Square crop for consistency
        ])
        .on('start', (commandLine) => {
          console.log('📸 [THUMBNAIL] FFmpeg command:', commandLine);
        })
        .on('end', () => {
          console.log('✅ [THUMBNAIL] First frame extracted:', outputPath);
          resolve(outputPath);
        })
        .on('error', (error) => {
          console.error('❌ [THUMBNAIL] Extraction failed:', error);
          reject(error);
        })
        .run();
        
    } catch (error) {
      console.error('❌ [THUMBNAIL] Setup error:', error);
      reject(error);
    }
  });
}

/**
 * Extract multiple thumbnails at different timestamps
 * @param {string} videoPath - Path to video file
 * @param {Array<number>} timestamps - Array of timestamps in seconds
 * @param {string} outputDir - Directory for thumbnail outputs
 * @returns {Promise<Array<string>>} Array of thumbnail paths
 */
async function extractMultipleThumbnails(videoPath, timestamps = [0, 5, 10], outputDir = null) {
  try {
    console.log('📸 [THUMBNAIL] Extracting multiple thumbnails...');
    
    if (!outputDir) {
      outputDir = path.dirname(videoPath);
    }
    
    const filename = path.basename(videoPath, path.extname(videoPath));
    const thumbnailPaths = [];
    
    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = timestamps[i];
      const outputPath = path.join(outputDir, `${filename}_thumb_${timestamp}s.jpg`);
      
      await new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .seekInput(timestamp)
          .frames(1)
          .output(outputPath)
          .outputOptions([
            '-q:v 2',
            '-vf scale=640:640:force_original_aspect_ratio=increase,crop=640:640'
          ])
          .on('end', () => {
            console.log(`✅ [THUMBNAIL] Extracted thumbnail at ${timestamp}s`);
            thumbnailPaths.push(outputPath);
            resolve();
          })
          .on('error', reject)
          .run();
      });
    }
    
    console.log(`✅ [THUMBNAIL] Extracted ${thumbnailPaths.length} thumbnails`);
    return thumbnailPaths;
    
  } catch (error) {
    console.error('❌ [THUMBNAIL] Multiple extraction failed:', error);
    throw error;
  }
}

/**
 * Generate visual hash for similarity detection
 * @param {string} thumbnailPath - Path to thumbnail image
 * @returns {Promise<string>} Visual hash for comparison
 */
async function generateVisualHash(thumbnailPath) {
  try {
    console.log('🔍 [VISUAL HASH] Generating visual hash...');
    
    // Read the image file
    const imageBuffer = fs.readFileSync(thumbnailPath);
    
    // Create a simple hash based on file content
    // Note: For production, you might want to use perceptual hashing
    const hash = crypto.createHash('md5').update(imageBuffer).digest('hex');
    
    // Take first 16 characters for shorter hash
    const visualHash = hash.substring(0, 16);
    
    console.log('✅ [VISUAL HASH] Hash generated:', visualHash);
    return visualHash;
    
  } catch (error) {
    console.error('❌ [VISUAL HASH] Generation failed:', error);
    throw error;
  }
}

/**
 * Extract thumbnail and generate visual hash in one operation
 * @param {string} videoPath - Path to video file
 * @returns {Promise<Object>} Object with thumbnailPath and visualHash
 */
async function extractThumbnailWithHash(videoPath) {
  try {
    console.log('📸🔍 [THUMBNAIL+HASH] Starting combined extraction...');
    
    // Extract first frame
    const thumbnailPath = await extractFirstFrame(videoPath);
    
    // Generate visual hash
    const visualHash = await generateVisualHash(thumbnailPath);
    
    console.log('✅ [THUMBNAIL+HASH] Combined extraction completed');
    return {
      thumbnailPath,
      visualHash
    };
    
  } catch (error) {
    console.error('❌ [THUMBNAIL+HASH] Combined extraction failed:', error);
    throw error;
  }
}

/**
 * Create a preview grid from multiple thumbnails
 * @param {Array<string>} thumbnailPaths - Array of thumbnail paths
 * @param {string} outputPath - Path for grid output
 * @returns {Promise<string>} Path to preview grid
 */
async function createPreviewGrid(thumbnailPaths, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      console.log('🖼️ [PREVIEW GRID] Creating thumbnail grid...');
      
      if (thumbnailPaths.length === 0) {
        reject(new Error('No thumbnails provided'));
        return;
      }
      
      // Create a simple horizontal grid
      let ffmpegCommand = ffmpeg();
      
      // Add all thumbnail inputs
      thumbnailPaths.forEach(path => {
        ffmpegCommand.input(path);
      });
      
      // Create horizontal concatenation filter
      const filterString = thumbnailPaths.map((_, i) => `[${i}:v]`).join('') + 
                          `hstack=inputs=${thumbnailPaths.length}[v]`;
      
      ffmpegCommand
        .complexFilter([filterString])
        .outputOptions(['-map', '[v]'])
        .output(outputPath)
        .on('end', () => {
          console.log('✅ [PREVIEW GRID] Grid created:', outputPath);
          resolve(outputPath);
        })
        .on('error', reject)
        .run();
        
    } catch (error) {
      console.error('❌ [PREVIEW GRID] Creation failed:', error);
      reject(error);
    }
  });
}

/**
 * Clean up temporary thumbnail files
 * @param {Array<string>} thumbnailPaths - Array of thumbnail paths to delete
 */
async function cleanupThumbnails(thumbnailPaths) {
  try {
    console.log('🗑️ [CLEANUP] Removing temporary thumbnails...');
    
    for (const thumbnailPath of thumbnailPaths) {
      if (fs.existsSync(thumbnailPath)) {
        fs.unlinkSync(thumbnailPath);
        console.log(`🗑️ [CLEANUP] Removed: ${path.basename(thumbnailPath)}`);
      }
    }
    
    console.log('✅ [CLEANUP] Thumbnail cleanup completed');
    
  } catch (error) {
    console.warn('⚠️ [CLEANUP] Could not clean up thumbnails:', error.message);
  }
}

module.exports = {
  extractFirstFrame,
  extractMultipleThumbnails,
  generateVisualHash,
  extractThumbnailWithHash,
  createPreviewGrid,
  cleanupThumbnails
};