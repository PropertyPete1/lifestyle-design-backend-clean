/**
 * Update YouTube Channel Handle Script
 * Sets the correct YouTube channel handle for scraping fallback
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Define the Settings schema directly for this script
const settingsSchema = new mongoose.Schema({
  youtubeChannelHandle: String,
}, { 
  timestamps: true,
  collection: 'SettingsClean',
  strict: false // Allow other fields to exist
});

const Settings = mongoose.model('Settings', settingsSchema);

async function updateYouTubeHandle() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/lifestyle-design';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Update the settings with the correct YouTube channel handle
    const result = await Settings.updateOne(
      {}, // Update the first/only settings document
      { 
        youtubeChannelHandle: '@LifestyleDesignRealtyTexas',
        $setOnInsert: { 
          // Only set these if creating a new document
          createdAt: new Date(),
        }
      },
      { upsert: true } // Create if doesn't exist
    );

    if (result.modifiedCount > 0) {
      console.log('✅ YouTube channel handle updated to: @LifestyleDesignRealtyTexas');
    } else if (result.upsertedCount > 0) {
      console.log('✅ Settings document created with YouTube channel handle: @LifestyleDesignRealtyTexas');
    } else {
      console.log('✅ YouTube channel handle was already set to: @LifestyleDesignRealtyTexas');
    }

    // Verify the update
    const settings = await Settings.findOne();
    console.log(`📺 Current YouTube channel handle: ${settings.youtubeChannelHandle || 'Not set'}`);

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');

  } catch (error) {
    console.error('❌ Error updating YouTube channel handle:', error);
    process.exit(1);
  }
}

// Run the update
updateYouTubeHandle();