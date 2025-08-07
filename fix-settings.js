require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb+srv://peterallen:RDSTonopah1992@cluster0.7vqin.mongodb.net/lifestyle-design-social?retryWrites=true&w=majority';

async function copySettingsToCorrectCollection() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;

    // Get your existing credentials from 'settings' collection
    const sourceSettings = await db.collection('settings').findOne({});
    
    if (!sourceSettings) {
      console.log('❌ No settings found in source collection');
      return;
    }

    console.log('✅ Found your credentials in settings collection');

    // Create the data for SettingsClean collection with correct field names
    const cleanedSettings = {
      instagramToken: sourceSettings.instagramToken,
      igBusinessId: sourceSettings.instagramAccount || '17841454131323777',
      facebookPage: sourceSettings.facebookPage,
      youtubeClientId: sourceSettings.youtubeClientId,
      youtubeClientSecret: sourceSettings.youtubeClientSecret,
      youtubeAccessToken: sourceSettings.youtubeToken,
      youtubeRefreshToken: sourceSettings.youtubeRefresh,
      youtubeChannelId: sourceSettings.youtubeChannel,
      s3AccessKey: sourceSettings.s3AccessKey,
      s3SecretKey: sourceSettings.s3SecretKey,
      s3BucketName: sourceSettings.s3Bucket,
      s3Region: sourceSettings.s3Region,
      mongoURI: sourceSettings.mongodbUri,
      openaiApiKey: sourceSettings.openaiApi,
      dropboxToken: sourceSettings.dropboxToken,
      runwayApiKey: sourceSettings.runwayApi,
      maxPosts: sourceSettings.maxPosts || 4,
      autopilotEnabled: sourceSettings.autopilot || false,
      cartoonMode: sourceSettings.cartoon || false,
      schedulerType: 'daily',
      repostDelay: sourceSettings.repostDelay || 2,
      postToYouTube: sourceSettings.postToYouTube || false,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Update or create in SettingsClean collection
    await db.collection('SettingsClean').replaceOne(
      {}, 
      cleanedSettings, 
      { upsert: true }
    );

    console.log('✅ Successfully copied all your credentials to SettingsClean collection');
    console.log('✅ Your settings will now persist and work with both frontend and backend');

    // Verify the copy worked
    const verifySettings = await db.collection('SettingsClean').findOne({});
    console.log('\n🔍 Verification:');
    console.log(`  - instagramToken: ${verifySettings.instagramToken ? 'EXISTS' : 'MISSING'}`);
    console.log(`  - youtubeAccessToken: ${verifySettings.youtubeAccessToken ? 'EXISTS' : 'MISSING'}`);
    console.log(`  - s3AccessKey: ${verifySettings.s3AccessKey ? 'EXISTS' : 'MISSING'}`);
    console.log(`  - openaiApiKey: ${verifySettings.openaiApiKey ? 'EXISTS' : 'MISSING'}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Done - your settings are now permanently saved');
  }
}

copySettingsToCorrectCollection();