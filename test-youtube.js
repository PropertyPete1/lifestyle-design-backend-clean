require('dotenv').config();
const mongoose = require('mongoose');

// MongoDB connection
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb+srv://peterallen:RDSTonopah1992@cluster0.7vqin.mongodb.net/lifestyle-design-social?retryWrites=true&w=majority';

// Settings Model
const settingsSchema = new mongoose.Schema({
  instagramToken: String,
  igBusinessId: String,
  facebookPage: String,
  youtubeClientId: String,
  youtubeClientSecret: String,
  youtubeAccessToken: String,
  youtubeRefreshToken: String,
  youtubeChannelId: String,
  s3AccessKey: String,
  s3SecretKey: String,
  s3BucketName: String,
  s3Region: String,
  mongoURI: String,
  openaiApiKey: String,
  dropboxToken: String,
  runwayApiKey: String,
  maxPosts: { type: Number, default: 4 },
  autopilotEnabled: { type: Boolean, default: false },
  cartoonMode: { type: Boolean, default: false },
  schedulerType: { type: String, default: 'daily' },
  repostDelay: { type: Number, default: 2 },
  postToYouTube: { type: Boolean, default: false },
}, { timestamps: true, collection: 'SettingsClean' });

const SettingsModel = mongoose.model('SettingsClean', settingsSchema);

async function testYouTubeCredentials() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // Get settings
    const settings = await SettingsModel.findOne({});
    if (!settings) {
      console.log('❌ No settings found in MongoDB');
      return;
    }

    console.log('\n🔍 [YOUTUBE TEST] YouTube credentials check:');
    console.log(`  - youtubeClientId: ${settings.youtubeClientId ? 'EXISTS' : 'MISSING'}`);
    console.log(`  - youtubeClientSecret: ${settings.youtubeClientSecret ? 'EXISTS' : 'MISSING'}`);
    console.log(`  - youtubeAccessToken: ${settings.youtubeAccessToken ? 'EXISTS' : 'MISSING'}`);
    console.log(`  - youtubeRefreshToken: ${settings.youtubeRefreshToken ? 'EXISTS' : 'MISSING'}`);
    console.log(`  - youtubeChannelId: ${settings.youtubeChannelId ? 'EXISTS' : 'MISSING'}`);

    if (settings.youtubeAccessToken) {
      console.log(`\n🔗 [YOUTUBE TEST] Access Token: ${settings.youtubeAccessToken.substring(0, 50)}...`);
      
      // Test YouTube API
      const fetch = require('node-fetch');
      const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&mine=true&access_token=${settings.youtubeAccessToken}`;
      
      console.log('\n🔗 [YOUTUBE TEST] Testing API call...');
      const response = await fetch(channelUrl);
      const data = await response.json();
      
      if (response.ok) {
        console.log('✅ [YOUTUBE TEST] API call successful!');
        console.log(`📊 [YOUTUBE TEST] Channel: ${data.items?.[0]?.snippet?.title}`);
        console.log(`📊 [YOUTUBE TEST] Subscribers: ${data.items?.[0]?.statistics?.subscriberCount}`);
        console.log(`📊 [YOUTUBE TEST] Videos: ${data.items?.[0]?.statistics?.videoCount}`);
      } else {
        console.log(`❌ [YOUTUBE TEST] API call failed: ${response.status}`);
        console.log(`❌ [YOUTUBE TEST] Error: ${JSON.stringify(data, null, 2)}`);
      }
    } else {
      console.log('\n⚠️ [YOUTUBE TEST] No access token found - cannot test API');
    }

  } catch (error) {
    console.error('❌ [YOUTUBE TEST] Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

testYouTubeCredentials();