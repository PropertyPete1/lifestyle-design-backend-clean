// ✅ S3 Uploader Service - Phase 9 AutoPilot System
let AWS = null;
let isAWSAvailable = false;

try {
  AWS = require('aws-sdk');
  isAWSAvailable = true;
  console.log('✅ AWS SDK loaded successfully - S3 uploads enabled');
} catch (err) {
  console.warn('⚠️ AWS SDK not available, S3 upload disabled:', err.message);
  console.log('📦 [AWS SDK] Attempting to load alternative AWS client...');
  
  // Try to use @aws-sdk/client-s3 (v3) as fallback
  try {
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    AWS = {
      S3: function(config) {
        const client = new S3Client({
          region: config.region,
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey
          }
        });
        return {
          upload: async (params) => {
            const command = new PutObjectCommand({
              Bucket: params.Bucket,
              Key: params.Key,
              Body: params.Body
            });
            const result = await client.send(command);
            return {
              promise: () => Promise.resolve({
                Location: `https://${params.Bucket}.s3.amazonaws.com/${params.Key}`,
                Key: params.Key,
                Bucket: params.Bucket
              })
            };
          }
        };
      },
      config: { update: () => {} }
    };
    isAWSAvailable = true;
    console.log('✅ AWS SDK v3 loaded as fallback');
  } catch (v3Error) {
    console.warn('⚠️ AWS SDK v3 also not available:', v3Error.message);
    // Create a mock AWS object for final fallback
    AWS = {
      S3: function() {
        return {
          upload: () => {
            throw new Error('AWS SDK not installed - S3 upload unavailable');
          }
        };
      },
      config: { update: () => {} }
    };
  }
}

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
    
    // Check if AWS SDK is available
    if (!isAWSAvailable || !AWS || typeof AWS.S3 !== 'function') {
      console.warn('⚠️ [S3 UPLOAD] AWS SDK not available, simulating upload');
      // Return a mock response for testing/fallback
      return {
        Location: `https://mock-s3-bucket.s3.amazonaws.com/${options.filename}`,
        Key: options.filename,
        Bucket: 'mock-bucket',
        mock: true,
        note: 'Mock upload - AWS SDK not available on this platform'
      };
    }
    
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