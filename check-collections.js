require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb+srv://peterallen:RDSTonopah1992@cluster0.7vqin.mongodb.net/lifestyle-design-social?retryWrites=true&w=majority';

async function checkCollectionsData() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;

    // Check usersettings collection
    console.log('\n🔍 [USERSETTINGS] Collection data:');
    const userSettings = await db.collection('usersettings').findOne({});
    if (userSettings) {
      console.log(`  - instagramToken: ${userSettings.instagramToken ? userSettings.instagramToken.substring(0, 50) + '...' : 'MISSING'}`);
      console.log(`  - youtubeToken: ${userSettings.youtubeToken ? userSettings.youtubeToken.substring(0, 50) + '...' : 'MISSING'}`);
      console.log(`  - s3AccessKey: ${userSettings.s3AccessKey ? 'EXISTS' : 'MISSING'}`);
      console.log(`  - openaiApiKey: ${userSettings.openaiApiKey ? 'EXISTS' : 'MISSING'}`);
    }

    // Check settings collection
    console.log('\n🔍 [SETTINGS] Collection data:');
    const settings = await db.collection('settings').findOne({});
    if (settings) {
      console.log(`  - instagramToken: ${settings.instagramToken ? settings.instagramToken.substring(0, 50) + '...' : 'MISSING'}`);
      console.log(`  - youtubeToken: ${settings.youtubeToken ? settings.youtubeToken.substring(0, 50) + '...' : 'MISSING'}`);
      console.log(`  - s3AccessKey: ${settings.s3AccessKey ? 'EXISTS' : 'MISSING'}`);
      console.log(`  - openaiApi: ${settings.openaiApi ? 'EXISTS' : 'MISSING'}`);
    }

    // Test Instagram API with usersettings data
    if (userSettings && userSettings.instagramToken) {
      console.log('\n🔗 [TEST] Testing Instagram API with usersettings token...');
      const fetch = require('node-fetch');
      const instagramUrl = `https://graph.facebook.com/v19.0/${userSettings.instagramAccountId || '17841454131323777'}/media?fields=id,thumbnail_url,timestamp&limit=5&access_token=${userSettings.instagramToken}`;
      
      const response = await fetch(instagramUrl);
      const data = await response.json();
      
      if (response.ok) {
        console.log(`✅ [TEST] Instagram API works! Found ${data.data?.length} posts`);
      } else {
        console.log(`❌ [TEST] Instagram API failed: ${data.error?.message}`);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

checkCollectionsData();