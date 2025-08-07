require('dotenv').config();
const mongoose = require('mongoose');

// MongoDB connection
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb+srv://peterallen:RDSTonopah1992@cluster0.7vqin.mongodb.net/lifestyle-design-social?retryWrites=true&w=majority';

async function findPostedVideos() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    const collections = ['autopilotqueues', 'repostqueues', 'uploadqueues', 'instagramarchives', 'videostatuses', 'activitylogs', 'autopilotlogs'];
    
    for (const collectionName of collections) {
      try {
        const collection = mongoose.connection.db.collection(collectionName);
        const count = await collection.countDocuments();
        console.log(`\n📊 [${collectionName}] Total documents: ${count}`);
        
        if (count > 0) {
          // Get a sample document to see the structure
          const sample = await collection.findOne();
          console.log(`📋 [${collectionName}] Sample document keys:`, Object.keys(sample || {}));
          
          // Try to find any documents with video-related fields
          const videoCount = await collection.countDocuments({
            $or: [
              { videoUrl: { $exists: true } },
              { originalVideoId: { $exists: true } },
              { status: 'posted' },
              { platform: 'instagram' }
            ]
          });
          
          if (videoCount > 0) {
            console.log(`🎯 [${collectionName}] Documents with video data: ${videoCount}`);
            
            // Get recent video entries
            const recentVideos = await collection.find({
              $or: [
                { videoUrl: { $exists: true } },
                { originalVideoId: { $exists: true } },
                { status: 'posted' },
                { platform: 'instagram' }
              ]
            }).limit(5).toArray();
            
            recentVideos.forEach((video, i) => {
              console.log(`  ${i+1}. ID: ${video._id} | videoUrl: ${video.videoUrl ? 'YES' : 'NO'} | originalVideoId: ${video.originalVideoId} | status: ${video.status} | platform: ${video.platform}`);
            });
          }
        }
      } catch (err) {
        console.log(`❌ [${collectionName}] Error:`, err.message);
      }
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ [DEBUG] Error:', error);
    process.exit(1);
  }
}

findPostedVideos();