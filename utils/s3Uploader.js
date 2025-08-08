/**
 * S3 Uploader Utility - Upload videos to AWS S3 for hosting
 * Replaces old ngrok temporary file hosting
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Configure AWS SDK
const configureAWS = (settings) => {
  if (!settings.s3AccessKey || !settings.s3SecretKey || !settings.s3BucketName) {
    throw new Error('Missing S3 credentials: accessKey, secretKey, and bucketName are required');
  }

  console.log('✅ [AWS CONFIG] Configured with region:', settings.s3Region || 'us-east-1');
};

/**
 * Upload file to S3 and return public URL
 * @param {string} localPath - Local file path
 * @param {string} s3Key - S3 object key
 * @param {Object} settings - Settings with S3 credentials
 * @returns {Promise<string>} Public S3 URL
 */
async function uploadToS3(localPath, s3Key, settings) {
  try {
    console.log('☁️ [S3 UPLOAD] Starting upload:', s3Key);
    
    // Configure client with user's credentials
    configureAWS(settings);
    const s3Client = new S3Client({
      region: settings.s3Region || 'us-east-1',
      credentials: {
        accessKeyId: settings.s3AccessKey,
        secretAccessKey: settings.s3SecretKey,
      },
    });
    
    const fileContent = fs.readFileSync(localPath);
    const params = {
      Bucket: settings.s3BucketName,
      Key: s3Key,
      Body: fileContent,
      ContentType: 'video/mp4',
    };

    const uploader = new Upload({ client: s3Client, params });
    const result = await uploader.done();
    const publicUrl = `https://${settings.s3BucketName}.s3.${settings.s3Region || 'us-east-1'}.amazonaws.com/${s3Key}`;
    
    console.log('✅ [S3 UPLOAD] Success:', publicUrl);
    return publicUrl;
    
  } catch (error) {
    console.error('❌ [S3 UPLOAD ERROR]', error);
    throw new Error(`S3 upload failed: ${error.message}`);
  }
}

/**
 * Upload buffer to S3 (for downloaded videos)
 * @param {Buffer} buffer - File buffer
 * @param {string} s3Key - S3 object key
 * @param {Object} settings - Settings with S3 credentials
 * @returns {Promise<string>} Public S3 URL
 */
async function uploadBufferToS3(buffer, s3Key, settingsOrContentType = 'video/mp4') {
  // Handle both old signature (buffer, key, settings) and new signature (buffer, key, contentType)
  const contentType = typeof settingsOrContentType === 'string' ? settingsOrContentType : 'video/mp4';
  try {
    console.log('☁️ [S3 BUFFER UPLOAD] Starting upload:', s3Key);
    
    // Use environment variables directly (bulletproof approach)
    const s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
    
    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: s3Key,
      Body: buffer,
      ContentType: contentType,
      // Removed ACL: 'public-read' - ACLs disabled on bucket
    };

    const uploader = new Upload({ client: s3Client, params });
    const result = await uploader.done();
    const publicUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${s3Key}`;
    console.log('✅ [S3 BUFFER UPLOAD] Success:', publicUrl);
    return publicUrl;
    
  } catch (error) {
    console.error('❌ [S3 BUFFER UPLOAD ERROR]', error);
    throw new Error(`S3 buffer upload failed: ${error.message}`);
  }
}

/**
 * Generate unique S3 key for autopilot videos
 * @param {string} platform - Platform name (instagram/youtube)
 * @returns {string} Unique S3 key
 */
function generateS3Key(platform) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `autopilot/${platform}/${timestamp}_${random}.mp4`;
}

module.exports = {
  uploadToS3,
  uploadBufferToS3,
  generateS3Key,
  uploadUrlToS3
};

/**
 * Stream a remote URL directly into S3 without buffering the whole file in memory
 * @param {string} fileUrl - Remote file URL (e.g., Instagram media URL)
 * @param {string} s3Key - S3 object key
 * @param {string} contentType - MIME type (default video/mp4)
 * @returns {Promise<string>} Public S3 URL
 */
async function uploadUrlToS3(fileUrl, s3Key, contentType = 'video/mp4') {
  try {
    console.log('☁️ [S3 STREAM UPLOAD] Streaming URL to S3:', s3Key);

    const response = await fetch(fileUrl);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to fetch remote file: ${response.status}`);
    }

    const s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: s3Key,
      Body: response.body, // stream
      ContentType: contentType,
    };

    const uploader = new Upload({ client: s3Client, params });
    const result = await uploader.done();
    const publicUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${s3Key}`;
    console.log('✅ [S3 STREAM UPLOAD] Success:', publicUrl);
    return publicUrl;
  } catch (error) {
    console.error('❌ [S3 STREAM UPLOAD ERROR]', error);
    throw new Error(`S3 stream upload failed: ${error.message}`);
  }
}

module.exports.uploadUrlToS3 = uploadUrlToS3;
