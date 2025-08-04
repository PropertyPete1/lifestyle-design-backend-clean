const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  instagramToken: String,
  igBusinessId: String,
  facebookPageId: String,
  youtubeToken: String,
  youtubeRefreshToken: String,
  youtubeChannelId: String,
  youtubeClientId: String,
  youtubeClientSecret: String,
  openaiKey: String,
  s3AccessKeyId: String,
  s3SecretAccessKey: String,
  s3BucketName: String,
  s3Region: String,
  mongoUri: String
}, { timestamps: true });

module.exports = mongoose.model('SettingsClean', settingsSchema);