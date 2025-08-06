/**
 * Video Enhancement Utility - Improve video quality using FFmpeg
 * Enhances downloaded Instagram videos before uploading to S3
 */

const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

/**
 * Enhance video quality using FFmpeg
 * @param {string} inputPath - Path to input video file
 * @param {string} outputPath - Path for enhanced output video (optional)
 * @returns {Promise<string>} Path to enhanced video
 */
async function enhanceVideoQuality(inputPath, outputPath = null) {
  return new Promise((resolve, reject) => {
    try {
      console.log('🎥 [VIDEO ENHANCER] Starting video enhancement...');
      
      // Generate output path if not provided
      if (!outputPath) {
        const dir = path.dirname(inputPath);
        const filename = path.basename(inputPath, path.extname(inputPath));
        const ext = path.extname(inputPath);
        outputPath = path.join(dir, `${filename}_enhanced${ext}`);
      }
      
      // FFmpeg enhancement pipeline
      ffmpeg(inputPath)
        // Video codec and quality settings
        .videoCodec('libx264')
        .outputOptions([
          '-preset medium',          // Balance between speed and compression
          '-crf 23',                // Constant Rate Factor (18-28, lower = better quality)
          '-movflags +faststart',   // Optimize for web streaming
          '-pix_fmt yuv420p',       // Pixel format for compatibility
          '-profile:v baseline',    // H.264 baseline profile for maximum compatibility
          '-level 3.0'              // H.264 level for mobile compatibility
        ])
        
        // Audio settings
        .audioCodec('aac')
        .audioBitrate('128k')
        .audioChannels(2)
        .audioFrequency(44100)
        
        // Video filters for enhancement
        .videoFilters([
          'eq=contrast=1.1:brightness=0.02:saturation=1.1', // Slight contrast/saturation boost
          'unsharp=5:5:0.8:3:3:0.4',                       // Subtle sharpening
          'scale=1080:1920:flags=lanczos'                   // Ensure 1080x1920 (9:16 ratio) with high-quality scaling
        ])
        
        // Frame rate settings
        .fps(30)
        
        // Output path
        .output(outputPath)
        
        // Event handlers
        .on('start', (commandLine) => {
          console.log('🎥 [VIDEO ENHANCER] FFmpeg command:', commandLine);
        })
        
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`🎥 [VIDEO ENHANCER] Progress: ${Math.round(progress.percent)}%`);
          }
        })
        
        .on('end', () => {
          console.log('✅ [VIDEO ENHANCER] Enhancement completed:', outputPath);
          
          // Optional: Remove original file to save space
          try {
            if (inputPath !== outputPath && fs.existsSync(inputPath)) {
              fs.unlinkSync(inputPath);
              console.log('🗑️ [VIDEO ENHANCER] Removed original file');
            }
          } catch (cleanupError) {
            console.warn('⚠️ [VIDEO ENHANCER] Could not remove original file:', cleanupError.message);
          }
          
          resolve(outputPath);
        })
        
        .on('error', (error) => {
          console.error('❌ [VIDEO ENHANCER] Enhancement failed:', error);
          reject(error);
        })
        
        // Start processing
        .run();
        
    } catch (error) {
      console.error('❌ [VIDEO ENHANCER] Setup error:', error);
      reject(error);
    }
  });
}

/**
 * Get video information using FFprobe
 * @param {string} videoPath - Path to video file
 * @returns {Promise<Object>} Video metadata
 */
async function getVideoInfo(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (error, metadata) => {
      if (error) {
        console.error('❌ [VIDEO INFO] Error getting video info:', error);
        reject(error);
      } else {
        console.log('📋 [VIDEO INFO] Video metadata retrieved');
        resolve({
          duration: metadata.format.duration,
          width: metadata.streams[0].width,
          height: metadata.streams[0].height,
          fps: metadata.streams[0].r_frame_rate,
          codec: metadata.streams[0].codec_name,
          bitrate: metadata.format.bit_rate,
          size: metadata.format.size
        });
      }
    });
  });
}

/**
 * Convert video to optimal format for social media
 * @param {string} inputPath - Input video path
 * @param {string} outputPath - Output video path
 * @param {Object} options - Conversion options
 * @returns {Promise<string>} Output path
 */
async function optimizeForSocialMedia(inputPath, outputPath, options = {}) {
  const defaults = {
    width: 1080,
    height: 1920,  // 9:16 aspect ratio for Instagram/TikTok
    fps: 30,
    maxDuration: 60, // 60 seconds max
    quality: 'high'  // 'high', 'medium', 'low'
  };
  
  const settings = { ...defaults, ...options };
  
  return new Promise((resolve, reject) => {
    try {
      console.log('📱 [SOCIAL OPTIMIZER] Optimizing for social media...');
      
      let ffmpegCommand = ffmpeg(inputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-preset fast',
          '-movflags +faststart',
          '-pix_fmt yuv420p'
        ])
        .size(`${settings.width}x${settings.height}`)
        .fps(settings.fps);
      
      // Quality settings based on preference
      if (settings.quality === 'high') {
        ffmpegCommand.outputOptions(['-crf 20']);
      } else if (settings.quality === 'medium') {
        ffmpegCommand.outputOptions(['-crf 25']);
      } else {
        ffmpegCommand.outputOptions(['-crf 30']);
      }
      
      // Limit duration if specified
      if (settings.maxDuration) {
        ffmpegCommand.duration(settings.maxDuration);
      }
      
      ffmpegCommand
        .output(outputPath)
        .on('end', () => {
          console.log('✅ [SOCIAL OPTIMIZER] Optimization completed');
          resolve(outputPath);
        })
        .on('error', reject)
        .run();
        
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  enhanceVideoQuality,
  getVideoInfo,
  optimizeForSocialMedia
};