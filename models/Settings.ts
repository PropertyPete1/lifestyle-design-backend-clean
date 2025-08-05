import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema({
  // Instagram API
  instagramToken: String,
  igBusinessId: String,
  
  // YouTube API
  youtubeClientId: String,
  youtubeClientSecret: String,
  youtubeAccessToken: String,
  youtubeRefreshToken: String,
  
  // AWS S3
  s3AccessKey: String,
  s3SecretKey: String,
  s3BucketName: String,
  
  // Database
  mongoURI: String,
  
  // AI Services
  openaiApiKey: String,
  
  // Cloud Storage
  dropboxToken: String,
  
  // Video Generation
  runwayApiKey: String,
  
  // AutoPilot Settings
  maxPosts: { type: Number, default: 4 },
  autopilotEnabled: { type: Boolean, default: false },
  cartoonMode: { type: Boolean, default: false },
  schedulerType: { type: String, default: 'daily' },
}, { 
  timestamps: true,
  collection: 'SettingsClean' // Use clean collection name
});

export default mongoose.model('Settings', settingsSchema);