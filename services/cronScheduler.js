/**
 * Cron Scheduler Service - Checks queue every minute and executes due posts
 * This is the missing piece that actually runs posts at their scheduled times
 */

const cron = require('node-cron');
const { executeScheduledPost } = require('./postExecutor');
const fetch = require('node-fetch');

/**
 * Smart Autopilot Refill System - Maintains queue at target level
 * @param {Object} SchedulerQueueModel - Mongoose model for queue
 * @param {Object} SettingsModel - Mongoose model for settings
 */
async function triggerAutopilotRefill(SchedulerQueueModel, SettingsModel) {
  try {
    console.log('🤖 [REFILL] Checking if autopilot refill is needed...');
    
    // Get current settings
    const settings = await SettingsModel.findOne({});
    if (!settings || !settings.autopilotEnabled) {
      console.log('⚠️ [REFILL] Autopilot disabled, skipping refill');
      return;
    }
    
    // Check current queue count
    const currentQueueCount = await SchedulerQueueModel.countDocuments({ 
      status: 'scheduled' 
    });
    
    const targetCount = settings.maxPosts || 5;
    const refillThreshold = Math.max(1, Math.floor(targetCount * 0.6)); // Refill when 60% empty
    
    console.log(`📊 [REFILL] Queue: ${currentQueueCount}/${targetCount} (threshold: ${refillThreshold})`);
    
    if (currentQueueCount <= refillThreshold) {
      console.log(`🚀 [REFILL] Queue low (${currentQueueCount} <= ${refillThreshold}), triggering autopilot...`);
      
      // Call the autopilot endpoint internally
      try {
        // Use environment variable or fallback to localhost
        const baseUrl = process.env.NODE_ENV === 'production' 
          ? 'https://lifestyle-design-backend-v2-clean.onrender.com'
          : 'http://localhost:3001';
          
        const response = await fetch(`${baseUrl}/api/autopilot/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'auto-refill' })
        });
        
        const result = await response.json();
        
        if (result.success) {
          console.log(`✅ [REFILL] Autopilot refill completed: ${result.videosProcessed} videos added`);
        } else {
          console.error(`❌ [REFILL] Autopilot refill failed: ${result.error}`);
        }
        
      } catch (refillError) {
        console.error('❌ [REFILL] Error calling autopilot endpoint:', refillError);
      }
      
    } else {
      console.log(`✅ [REFILL] Queue sufficient (${currentQueueCount} > ${refillThreshold}), no refill needed`);
    }
    
  } catch (error) {
    console.error('❌ [REFILL] Error in autopilot refill:', error);
  }
}

/**
 * Main cron scheduler function - checks and executes due posts
 * @param {Object} SchedulerQueueModel - Mongoose model for queue
 * @param {Object} SettingsModel - Mongoose model for settings
 */
async function checkAndExecuteDuePosts(SchedulerQueueModel, SettingsModel) {
  try {
    console.log('⏰ [CRON] Checking for due posts...');
    
    // Get current time
    const now = new Date();
    
    // Find posts that are due (scheduled time <= now) and not yet posted
    const duePosts = await SchedulerQueueModel.find({
      scheduledTime: { $lte: now },
      status: 'scheduled'
    }).sort({ scheduledTime: 1 }); // Oldest first
    
    if (duePosts.length === 0) {
      console.log('⏰ [CRON] No posts due at this time');
      return;
    }
    
    console.log(`⏰ [CRON] Found ${duePosts.length} posts due for execution`);
    
    // Get user settings for API credentials
    const settings = await SettingsModel.findOne({});
    if (!settings) {
      console.error('❌ [CRON] No settings found, cannot execute posts');
      return;
    }
    
    // Execute each due post
    for (const post of duePosts) {
      try {
        console.log(`🚀 [CRON] Executing post ${post._id} (${post.platform}) - was due at ${post.scheduledTime}`);
        
        // Mark as processing to prevent duplicate execution
        await SchedulerQueueModel.updateOne(
          { _id: post._id },
          { status: 'processing' }
        );
        
        // Execute the post
        const result = await executeScheduledPost(post, settings);
        
        if (result.success) {
          // Mark as completed and log success
          await SchedulerQueueModel.updateOne(
            { _id: post._id },
            { 
              status: 'completed',
              postedAt: new Date(),
              postId: result.postId,
              postUrl: result.url
            }
          );
          
          console.log(`✅ [CRON] Successfully posted to ${result.platform}: ${result.url}`);
          
          // 🤖 Smart Autopilot Refill: Check if queue needs more videos
          await triggerAutopilotRefill(SchedulerQueueModel, SettingsModel);
          
        } else {
          // Mark as failed
          await SchedulerQueueModel.updateOne(
            { _id: post._id },
            { 
              status: 'failed',
              error: result.error,
              failedAt: new Date()
            }
          );
          
          console.error(`❌ [CRON] Failed to post ${post._id}: ${result.error}`);
        }
        
      } catch (postError) {
        console.error(`❌ [CRON] Error executing post ${post._id}:`, postError);
        
        // Mark as failed
        await SchedulerQueueModel.updateOne(
          { _id: post._id },
          { 
            status: 'failed',
            error: postError.message,
            failedAt: new Date()
          }
        );
      }
      
      // Small delay between posts to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
  } catch (error) {
    console.error('❌ [CRON] Error in checkAndExecuteDuePosts:', error);
  }
}

/**
 * Start the cron scheduler - runs every minute
 * @param {Object} SchedulerQueueModel - Mongoose model for queue
 * @param {Object} SettingsModel - Mongoose model for settings
 */
function startCronScheduler(SchedulerQueueModel, SettingsModel) {
  console.log('⏰ [CRON] Starting cron scheduler - checking every minute');
  
  // Run every minute: '* * * * *'
  // For testing, you can use '*/10 * * * * *' (every 10 seconds)
  const cronJob = cron.schedule('* * * * *', () => {
    checkAndExecuteDuePosts(SchedulerQueueModel, SettingsModel);
  }, {
    timezone: 'America/Chicago' // Adjust to your timezone
  });
  
  // Run immediately on start to catch any overdue posts
  checkAndExecuteDuePosts(SchedulerQueueModel, SettingsModel);
  
  return cronJob;
}

/**
 * Stop the cron scheduler
 * @param {Object} cronJob - The cron job instance
 */
function stopCronScheduler(cronJob) {
  if (cronJob) {
    cronJob.stop();
    console.log('⏰ [CRON] Cron scheduler stopped');
  }
}

/**
 * Get queue statistics for monitoring
 * @param {Object} SchedulerQueueModel - Mongoose model for queue
 * @returns {Promise<Object>} Queue stats
 */
async function getQueueStats(SchedulerQueueModel) {
  try {
    const now = new Date();
    
    const stats = await SchedulerQueueModel.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const overduePosts = await SchedulerQueueModel.countDocuments({
      scheduledTime: { $lt: now },
      status: 'scheduled'
    });
    
    const result = {
      overdue: overduePosts,
      scheduled: 0,
      processing: 0,
      completed: 0,
      failed: 0
    };
    
    stats.forEach(stat => {
      result[stat._id] = stat.count;
    });
    
    return result;
    
  } catch (error) {
    console.error('❌ [CRON] Error getting queue stats:', error);
    return { error: error.message };
  }
}

module.exports = {
  startCronScheduler,
  stopCronScheduler,
  checkAndExecuteDuePosts,
  getQueueStats,
  triggerAutopilotRefill
};