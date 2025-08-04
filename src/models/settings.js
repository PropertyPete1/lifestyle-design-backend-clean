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

  dropboxToken: String,
  mongoURI: String,

  runwayApiKey: String,
  openaiApiKey: String,

  s3AccessKey: String,
  s3SecretAccessKey: String,
  s3BucketName: String,
  s3Region: String,
}, { timestamps: true });

module.exports = mongoose.model('SettingsClean', settingsSchema);