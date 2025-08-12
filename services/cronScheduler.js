// Minimal safe stub for Render: prevents boot failure; does NOT schedule anything
// Note: Below we export real implementations with locking and caps

/**
 * Cron Scheduler Service - Checks queue every minute and executes due posts
 * This is the missing piece that actually runs posts at their scheduled times
 */

const cron = require('node-cron');
const { executeScheduledPost } = require('./postExecutor');
const fetch = require('node-fetch');
const { acquireLock, releaseLock } = require('./locks');
const mongoose = require('mongoose');
let SchedulerQueueModel;
try { SchedulerQueueModel = mongoose.model('SchedulerQueue'); } catch (_) {
  try {
    const schema = new mongoose.Schema({}, { strict: false, timestamps: true, collection: 'SchedulerQueue' });
    SchedulerQueueModel = mongoose.model('SchedulerQueue', schema);
  } catch {}
}

// ✅ Timezone-safe post due checker
function isPostDueNow(scheduledTime) {
  const now = new Date();
  const scheduled = new Date(scheduledTime);
  
  // Buffer of ±3 minutes to allow for cron job timing imprecision
  const bufferMs = 3 * 60 * 1000; // 3 minutes in milliseconds
  const timeDiff = Math.abs(now.getTime() - scheduled.getTime());
  
  return timeDiff <= bufferMs || scheduled <= now;
}

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
    // Kill switch
    try {
      const s = await SettingsModel.findOne({});
      if (s && s.autopilotEnabled === false) {
        console.log('⏸️ [CRON] Autopilot paused, skip tick');
        return;
      }
    } catch {}

    // Distributed single-run lock
    _lastRunStartedAt = Date.now();
    let held;
    try {
      held = await acquireLock('scheduler:tick', 55);
    } catch (e) {
      if (e && e.code === 11000) {
        _lastLockHeld = true;
        console.log('🔒 [CRON] Lock already held, skip tick');
        return;
      }
      throw e;
    }
    if (!held.ok) { _lastLockHeld = true; console.log('🔒 [CRON] Another instance is running:', held.holder); return; }
    _lastLockHeld = false;
    console.log('⏰ [CRON] Checking for due posts...');
    
    // Get current time
    const now = new Date();
    
    // Find posts that are scheduled and filter by timezone-safe due check
    const allScheduledPosts = await SchedulerQueueModel.find({
      status: 'scheduled'
    }).sort({ scheduledTime: 1 }); // Oldest first
    
    // ✅ Filter using timezone-safe due checker
    const duePosts = allScheduledPosts.filter(post => isPostDueNow(post.scheduledTime));
    
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
    
    // Enforce per-hour caps per platform (defaults)
    let perHourCap = Number(process.env.AUTOPILOT_MAX_PER_HOUR || settings?.hourlyLimit || 6);
    let dailyLimit = Number(settings?.dailyLimit || settings?.maxPosts || 5);

    // Burst Mode window check using America/Chicago wall time
    function hhmmInTz(d, tz) {
      const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false });
      const parts = fmt.formatToParts(d).reduce((a,p)=>(a[p.type]=p.value,a),{});
      return `${parts.hour}:${parts.minute}`;
    }
    function isInWindow(now, start, end, tz) {
      const cur = hhmmInTz(now, tz);
      return (start <= end)
        ? (cur >= start && cur < end)
        : (cur >= start || cur < end); // overnight window
    }
    const tz = settings?.timeZone || 'America/Chicago';
    const burstEnabled = !!settings?.burstModeEnabled;
    const cfg = settings?.burstModeConfig || {};
    const inBurst = burstEnabled && cfg.startTime && cfg.endTime && isInWindow(now, String(cfg.startTime), String(cfg.endTime), tz);
    if (inBurst) {
      if (typeof cfg.postsPerHour === 'number') perHourCap = Number(cfg.postsPerHour);
      if (typeof cfg.maxTotal === 'number') dailyLimit = Math.max(dailyLimit, Number(cfg.maxTotal));
    }
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const counts = { instagram: 0, youtube: 0 };
    try {
      counts.instagram = await SchedulerQueueModel.countDocuments({ platform: 'instagram', status: { $in: ['posted','completed'] }, postedAt: { $gte: hourAgo } });
      counts.youtube   = await SchedulerQueueModel.countDocuments({ platform: 'youtube',   status: { $in: ['posted','completed'] }, postedAt: { $gte: hourAgo } });
    } catch {}

    // Execute each due post with caps and atomic claim
    for (const post of duePosts) {
      if (inBurst && Array.isArray(cfg.platforms) && cfg.platforms.length > 0) {
        if (!cfg.platforms.includes(post.platform)) continue;
      }
      if (post.platform === 'instagram' && counts.instagram >= perHourCap) break;
      if (post.platform === 'youtube'   && counts.youtube   >= perHourCap) break;
      try {
        console.log(`🚀 [CRON] Executing post ${post._id} (${post.platform}) - was due at ${post.scheduledTime}`);
        // Atomically claim the item
        const now = new Date();
        const claimed = await SchedulerQueueModel.findOneAndUpdate(
          { _id: post._id, status: { $in: ['scheduled','pending'] }, postedAt: { $exists: false } },
          { $set: { status: 'processing', lockedAt: now } },
          { new: true }
        );
        if (!claimed) {
          console.log('⚠️ [CRON] Skip, not claimed', String(post._id));
          continue;
        }
        
        // Execute the post
        const result = await executeScheduledPost(claimed, settings);
        
        if (result.success) {
          // Mark as completed and log success
          await SchedulerQueueModel.updateOne(
            { _id: post._id, status: 'processing' },
            { $set: { status: 'posted', postedAt: new Date(), postId: result.postId, postUrl: result.url } }
          );
          if (post.platform === 'instagram') counts.instagram += 1;
          else if (post.platform === 'youtube') counts.youtube += 1;

          console.log(`✅ [CRON] Successfully posted to ${result.platform}: ${result.url}`);
          
        } else {
          const currentRetryCount = (post.retryCount || 0) + 1;
          
          // ✅ FIX 2: Automatically remove posts from queue if they fail too many times
          if (currentRetryCount >= 3) {
            await SchedulerQueueModel.updateOne(
              { _id: post._id },
              { status: 'failed', failedAt: new Date(), retryCount: currentRetryCount }
            );
            console.log(`⚠️ [ROTATION] Post ${post._id} failed 3 times — marked as failed and will be rotated out.`);
          } else {
            // ✅ Keep failed posts in queue for retry (don't mark as failed)
            await SchedulerQueueModel.updateOne(
              { _id: post._id },
              { 
                status: 'scheduled', // Reset to scheduled for retry
                lastAttempt: new Date(),
                retryCount: currentRetryCount
              }
            );
            
            console.warn(`⚠️ [SKIPPED] Instagram post failed. Leaving post in queue for retry. Attempt ${currentRetryCount}`);
          }
        }
        
      } catch (postError) {
        console.error(`❌ [CRON] Error executing post ${post._id}:`, postError);
        
        const currentRetryCount = (post.retryCount || 0) + 1;
        
        // ✅ FIX 2: Automatically remove posts from queue if they fail too many times
        if (currentRetryCount >= 3) {
          await SchedulerQueueModel.updateOne(
            { _id: post._id },
            { status: 'failed', failedAt: new Date(), retryCount: currentRetryCount, lastError: postError.message }
          );
          console.log(`⚠️ [ROTATION] Post ${post._id} failed 3 times — marked as failed and will be rotated out.`);
        } else {
          // ✅ Keep failed posts in queue for retry
          await SchedulerQueueModel.updateOne(
            { _id: post._id },
            { 
              status: 'scheduled', // Reset to scheduled for retry
              lastAttempt: new Date(),
              retryCount: currentRetryCount,
              lastError: postError.message
            }
          );
          
          console.warn(`⚠️ [SKIPPED] Post execution failed. Leaving post in queue for retry. Attempt ${currentRetryCount}`);
        }
      }
      
      // Small delay between posts to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
  } catch (error) {
    console.error('❌ [CRON] Error in checkAndExecuteDuePosts:', error);
  } finally {
    try { await releaseLock('scheduler:tick'); } catch {}
    _lastRunDurationMs = typeof _lastRunStartedAt === 'number' ? (Date.now() - _lastRunStartedAt) : null;
  }
}

/**
 * Start the cron scheduler - runs every minute
 * @param {Object} SchedulerQueueModel - Mongoose model for queue
 * @param {Object} SettingsModel - Mongoose model for settings
 */
function startCronScheduler(SchedulerQueueModel, SettingsModel, onTick) {
  console.log('⏰ [CRON] Starting cron scheduler - checking every minute');
  
  // Run every minute: '* * * * *'
  // For testing, you can use '*/10 * * * * *' (every 10 seconds)
  const cronJob = cron.schedule('* * * * *', async () => {
    try { if (typeof onTick === 'function') onTick(); } catch(_) {}
    // Pre-window refill check and auto-off handling
    try {
      const s = await SettingsModel.findOne({}).lean();
      const tz = s?.timeZone || 'America/Chicago';
      const cfg = s?.burstModeConfig || {};
      const enabled = !!s?.burstModeEnabled;
      const now = new Date();
      const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
      const parts = fmt.formatToParts(now).reduce((a,p)=>(a[p.type]=p.value,a),{});
      const cur = `${parts.hour}:${parts.minute}`;
      const start = String(cfg.startTime || '18:00');
      const end = String(cfg.endTime || '19:00');
      const preloadMin = Number(cfg.preloadMinutes || 10);

      function toMinutes(hhmm){ const [h,m]=String(hhmm).split(':').map(Number); return h*60+(m||0); }
      const curM = toMinutes(cur);
      const startM = toMinutes(start);
      const endM = toMinutes(end);
      const preloadStartM = (startM - preloadMin + 24*60) % (24*60);

      // Pre-window: trigger single refill when current minute hits preload boundary
      if (enabled && preloadMin > 0) {
        const nearPreload = curM === preloadStartM; // every minute tick, exact match
        if (nearPreload) {
          try {
            const baseUrl = process.env.NODE_ENV === 'production' ? 'https://lifestyle-design-backend-v2-clean.onrender.com' : 'http://localhost:3001';
            await fetch(`${baseUrl}/api/autopilot/refill`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scrapeLimit: Number(cfg.scrapeLimit || 50) }) });
          } catch(_) {}
        }
      }

      // Auto-off after window
      if (enabled && cfg.autoOffAfterWindow === true) {
        const inWindow = (startM <= endM) ? (curM >= startM && curM < endM) : (curM >= startM || curM < endM);
        const justEnded = !inWindow && curM === endM; // at the exact end minute
        if (justEnded) {
          try { await SettingsModel.updateOne({}, { $set: { burstModeEnabled: false } }); } catch(_) {}
        }
      }
    } catch(_) {}

    checkAndExecuteDuePosts(SchedulerQueueModel, SettingsModel);
  }, {
    timezone: 'America/Chicago' // Force Austin timezone execution
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