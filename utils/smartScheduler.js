/**
 * Smart Scheduler - Optimal posting times with fallbacks
 * Schedules posts at peak engagement times
 */

/**
 * Get optimal posting time for platform
 * @param {string} platform - Platform name (instagram/youtube)
 * @param {Object} settings - User settings
 * @returns {Promise<Date>} Optimal posting time
 */
async function getSmartSchedulerTime(platform, settings) {
  try {
    console.log(`📅 [SMART SCHEDULER] Getting optimal time for ${platform}`);
    
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    let optimalHour, optimalMinute;
    
    // Platform-specific optimal times based on engagement data
    if (platform === 'instagram') {
      // Instagram peak times: 11 AM - 1 PM, 7 PM - 9 PM
      const peakTimes = [
        { hour: 11, minute: 30 }, // 11:30 AM
        { hour: 12, minute: 0 },  // 12:00 PM
        { hour: 19, minute: 0 },  // 7:00 PM
        { hour: 20, minute: 30 }  // 8:30 PM
      ];
      const randomPeak = peakTimes[Math.floor(Math.random() * peakTimes.length)];
      optimalHour = randomPeak.hour;
      optimalMinute = randomPeak.minute;
    } else if (platform === 'youtube') {
      // YouTube peak times: 2 PM - 4 PM, 8 PM - 10 PM
      const peakTimes = [
        { hour: 14, minute: 0 },  // 2:00 PM
        { hour: 15, minute: 30 }, // 3:30 PM
        { hour: 20, minute: 0 },  // 8:00 PM
        { hour: 21, minute: 30 }  // 9:30 PM
      ];
      const randomPeak = peakTimes[Math.floor(Math.random() * peakTimes.length)];
      optimalHour = randomPeak.hour;
      optimalMinute = randomPeak.minute;
    } else {
      // Default fallback
      return getRandomFallbackTime();
    }
    
    // Set the optimal time for tomorrow
    tomorrow.setHours(optimalHour, optimalMinute, 0, 0);
    
    console.log(`✅ [SMART SCHEDULER] Optimal time: ${tomorrow.toLocaleString()}`);
    return tomorrow;
    
  } catch (error) {
    console.error('❌ [SMART SCHEDULER ERROR]', error);
    return getRandomFallbackTime();
  }
}

/**
 * Get random fallback time (5 PM - 10 PM)
 * @returns {Date} Random time in peak window
 */
function getRandomFallbackTime() {
  console.log('⏰ [FALLBACK SCHEDULER] Using random time window');
  
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  // Random hour between 5 PM (17) and 10 PM (22)
  const hour = Math.floor(Math.random() * (22 - 17 + 1)) + 17;
  const minute = Math.floor(Math.random() * 60);
  
  tomorrow.setHours(hour, minute, 0, 0);
  
  console.log(`⏰ [FALLBACK SCHEDULER] Random time: ${tomorrow.toLocaleString()}`);
  return tomorrow;
}

/**
 * Calculate next available slot (avoid posting conflicts)
 * @param {string} platform - Platform name
 * @param {Array} existingPosts - Already scheduled posts
 * @returns {Promise<Date>} Next available time slot
 */
async function getNextAvailableSlot(platform, existingPosts = []) {
  let baseTime = await getSmartSchedulerTime(platform);
  
  // Check for conflicts with existing posts (within 30 minutes)
  const conflictWindow = 30 * 60 * 1000; // 30 minutes in milliseconds
  
  let hasConflict = true;
  let attempts = 0;
  
  while (hasConflict && attempts < 10) {
    hasConflict = existingPosts.some(post => {
      const timeDiff = Math.abs(new Date(post.scheduledTime) - baseTime);
      return timeDiff < conflictWindow;
    });
    
    if (hasConflict) {
      // Add 1 hour and try again
      baseTime.setHours(baseTime.getHours() + 1);
      attempts++;
    }
  }
  
  console.log(`📅 [SLOT FINDER] Next available slot: ${baseTime.toLocaleString()}`);
  return baseTime;
}

module.exports = {
  getSmartSchedulerTime,
  getRandomFallbackTime,
  getNextAvailableSlot
};