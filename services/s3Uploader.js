// ✅ S3 Uploader Service - Phase 9 AutoPilot System
const AWS = require('aws-sdk');

/**
 * Uploads video to S3 bucket
 * @param {Object} options - Upload options
 * @param {Buffer} options.file - File buffer
 * @param {string} options.filename - Filename
 * @param {Object} Settings - Mongoose Settings model
 * @returns {Object} Upload result with Location URL
 */
async function uploadToS3(options, Settings) {
  try {
    console.log('☁️ [S3 UPLOAD] Starting upload to S3...');
    
    const settings = await Settings.findOne();
    if (!settings || !settings.s3AccessKey || !settings.s3SecretKey || !settings.s3BucketName) {
      throw new Error('S3 credentials not found in settings');
    }

    // Configure AWS
    AWS.config.update({
      accessKeyId: settings.s3AccessKey,
      secretAccessKey: settings.s3SecretKey,
      region: settings.s3Region || 'us-east-1'
    });

    const s3 = new AWS.S3();
    
    const uploadParams = {
      Bucket: settings.s3BucketName,
      Key: `autopilot/${options.filename}`,
      Body: options.file,
      ContentType: 'video/mp4',
      ACL: 'public-read' // Make publicly accessible for Instagram/YouTube
    };

    console.log(`📤 [S3 UPLOAD] Uploading to bucket: ${settings.s3BucketName}`);
    const result = await s3.upload(uploadParams).promise();
    
    console.log(`✅ [S3 UPLOAD] Upload successful: ${result.Location}`);
    return result;

  } catch (error) {
    console.error('❌ [S3 UPLOAD ERROR]', error);
    throw error;
  }
}

/**
 * Generates unique filename for autopilot uploads
 * @param {string} platform - Platform (instagram/youtube)
 * @returns {string} Unique filename
 */
function generateAutopilotFilename(platform = 'instagram') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `autopilot-${platform}-${timestamp}-${random}.mp4`;
}

module.exports = {
  uploadToS3,
  generateAutopilotFilename
};