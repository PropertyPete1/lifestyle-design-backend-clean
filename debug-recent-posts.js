require('dotenv').config();
const mongoose = require('mongoose');

// MongoDB connection
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb+srv://peterallen:RDSTonopah1992@cluster0.7vqin.mongodb.net/lifestyle-design-social?retryWrites=true&w=majority';

// SchedulerQueue Schema (same as in server.js)
const schedulerQueueSchema = new mongoose.Schema({
  platform: { type: String, required: true, enum: ['instagram', 'youtube'] },
  source: { type: String, enum: ['autopilot', 'manual', 'bulk'] },
  originalVideoId: String,
  videoUrl: String,
  caption: String,
  thumbnailUrl: String,
  thumbnailHash: String,
  engagement: Number,
  status: { type: String, enum: ['pending', 'posted', 'failed', 'completed'], default: 'pending' },
  postedAt: Date,
  scheduledTime: Date,
}, { timestamps: true, collection: 'SchedulerQueue' });

const SchedulerQueueModel = mongoose.model('SchedulerQueue', schedulerQueueSchema);

async function debugRecentPosts() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    // Check all collections
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('\n📋 [DEBUG] All collections in database:');
    collections.forEach(col => console.log(`  - ${col.name}`));
    
    // Check total entries in SchedulerQueue
    const totalEntries = await SchedulerQueueModel.countDocuments();
    console.log(`\n📊 [DEBUG] Total entries in SchedulerQueue: ${totalEntries}`);
    
    // Check posted entries
    const postedEntries = await SchedulerQueueModel.find({ status: 'posted' }).sort({ postedAt: -1 }).limit(10);
    console.log(`\n📱 [DEBUG] Recent posted entries (${postedEntries.length}):`);
    postedEntries.forEach(entry => {
      console.log(`  - ID: ${entry.originalVideoId} | Platform: ${entry.platform} | Source: ${entry.source} | Hash: ${entry.thumbnailHash} | Posted: ${entry.postedAt}`);
    });
    
    // Check all statuses
    const statusCounts = await SchedulerQueueModel.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    console.log(`\n📈 [DEBUG] Status breakdown:`);
    statusCounts.forEach(stat => console.log(`  - ${stat._id}: ${stat.count}`));
    
    // Check platform breakdown
    const platformCounts = await SchedulerQueueModel.aggregate([
      { $group: { _id: '$platform', count: { $sum: 1 } } }
    ]);
    console.log(`\n🎯 [DEBUG] Platform breakdown:`);
    platformCounts.forEach(plat => console.log(`  - ${plat._id}: ${plat.count}`));
    
    process.exit(0);
  } catch (error) {
    console.error('❌ [DEBUG] Error:', error);
    process.exit(1);
  }
}

debugRecentPosts();