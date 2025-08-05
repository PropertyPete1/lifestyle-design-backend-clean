/**
 * S3 Uploader Utility - Upload videos to AWS S3 for hosting
 * Replaces old ngrok temporary file hosting
 */

const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');

// Configure AWS SDK
const configureAWS = (settings) => {
  AWS.config.update({
    accessKeyId: settings.s3AccessKey,
    secretAccessKey: settings.s3SecretKey,
    region: settings.s3Region || 'us-east-1',
  });
};

const s3 = new AWS.S3();

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
    
    // Configure AWS with user's credentials
    configureAWS(settings);
    
    const fileContent = fs.readFileSync(localPath);
    const params = {
      Bucket: settings.s3BucketName,
      Key: s3Key,
      Body: fileContent,
      ACL: 'public-read',
      ContentType: 'video/mp4',
    };

    const result = await s3.upload(params).promise();
    const publicUrl = `https://${settings.s3BucketName}.s3.amazonaws.com/${s3Key}`;
    
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
async function uploadBufferToS3(buffer, s3Key, settings) {
  try {
    console.log('☁️ [S3 BUFFER UPLOAD] Starting upload:', s3Key);
    
    // Configure AWS with user's credentials
    configureAWS(settings);
    
    const params = {
      Bucket: settings.s3BucketName,
      Key: s3Key,
      Body: buffer,
      ACL: 'public-read',
      ContentType: 'video/mp4',
    };

    const result = await s3.upload(params).promise();
    const publicUrl = `https://${settings.s3BucketName}.s3.amazonaws.com/${s3Key}`;
    
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
  generateS3Key
};