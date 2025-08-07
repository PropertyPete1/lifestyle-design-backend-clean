require('dotenv').config();
const mongoose = require('mongoose');

// MongoDB connection
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb+srv://peterallen:RDSTonopah1992@cluster0.7vqin.mongodb.net/lifestyle-design-social?retryWrites=true&w=majority';

async function debugAllSettings() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // Check ALL collections that might contain settings
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    
    console.log('\n📋 [DEBUG] All collections in database:');
    collections.forEach(col => {
      console.log(`  - ${col.name}`);
    });

    // Check SettingsClean collection specifically
    console.log('\n🔍 [DEBUG] Checking SettingsClean collection:');
    const settingsCleanDocs = await db.collection('SettingsClean').find({}).toArray();
    console.log(`  - Documents found: ${settingsCleanDocs.length}`);
    
    if (settingsCleanDocs.length > 0) {
      settingsCleanDocs.forEach((doc, index) => {
        console.log(`\n📄 [DEBUG] Document ${index + 1}:`);
        console.log(`  - _id: ${doc._id}`);
        console.log(`  - Keys: [${Object.keys(doc).join(', ')}]`);
        console.log(`  - Has instagramToken: ${!!doc.instagramToken}`);
        console.log(`  - Has youtubeAccessToken: ${!!doc.youtubeAccessToken}`);
        
        // Show first 50 chars of tokens if they exist
        if (doc.instagramToken) {
          console.log(`  - instagramToken: ${doc.instagramToken.substring(0, 50)}...`);
        }
        if (doc.youtubeAccessToken) {
          console.log(`  - youtubeAccessToken: ${doc.youtubeAccessToken.substring(0, 50)}...`);
        }
      });
    }

    // Also check for any other settings collections
    console.log('\n🔍 [DEBUG] Checking for other settings collections:');
    const settingsCollections = collections.filter(col => 
      col.name.toLowerCase().includes('setting') || 
      col.name.toLowerCase().includes('config')
    );
    
    for (const col of settingsCollections) {
      console.log(`\n📂 [DEBUG] Collection: ${col.name}`);
      const docs = await db.collection(col.name).find({}).toArray();
      console.log(`  - Documents: ${docs.length}`);
      
      if (docs.length > 0) {
        docs.forEach((doc, index) => {
          console.log(`  - Doc ${index + 1} keys: [${Object.keys(doc).join(', ')}]`);
        });
      }
    }

  } catch (error) {
    console.error('❌ [DEBUG] Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

debugAllSettings();