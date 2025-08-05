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
  youtubeChannelId: String,
  youtubeChannelHandle: String, // @username format for fallback scraping
  
  // AWS S3
  s3AccessKey: String,
  s3SecretKey: String,
  s3BucketName: String,
  s3Region: { type: String, default: 'us-east-1' },
  
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
  trendingAudio: { type: Boolean, default: false },
  
  // Platform Selection
  instagramEnabled: { type: Boolean, default: true },
  youtubeEnabled: { type: Boolean, default: true },
  
  // Engagement Thresholds
  minEngagement: { type: Number, default: 10000 },
  
  // Scheduling Settings
  postsPerDay: { type: Number, default: 3 },
  lastAutopilotRun: Date,
  
  // Analytics Cache Fields
  cachedIgFollowers: Number,
  cachedIgReach: Number,
  cachedIgEngagement: Number,
  cachedIgMediaCount: Number,
  cachedIgUsername: String,
  cachedIgAccountName: String,
  cachedIgLastUpdate: Date,
  
  cachedYouTubeSubscribers: Number,
  cachedYouTubeViews: Number,
  cachedYouTubeVideos: Number,
  cachedYouTubeChannelTitle: String,
  cachedYouTubeLastUpdate: Date,
}, { 
  timestamps: true,
  collection: 'SettingsClean' // Use clean collection name
});

export default mongoose.model('Settings', settingsSchema);