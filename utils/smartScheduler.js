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
    const today = new Date(now);
    
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
    
    // Set the optimal time for TODAY
    today.setHours(optimalHour, optimalMinute, 0, 0);
    
    // If the time has already passed today, schedule for tomorrow
    if (today.getTime() <= now.getTime()) {
      today.setDate(today.getDate() + 1);
    }
    
    console.log(`✅ [SMART SCHEDULER] Optimal time: ${today.toLocaleString()}`);
    return today;
    
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
  const scheduledTime = new Date(now);
  
  // Random hour between 5 PM (17) and 10 PM (22)
  const hour = Math.floor(Math.random() * (22 - 17 + 1)) + 17;
  const minute = Math.floor(Math.random() * 60);
  
  scheduledTime.setHours(hour, minute, 0, 0);
  
  // If the time has already passed today, schedule for tomorrow
  if (scheduledTime.getTime() <= now.getTime()) {
    scheduledTime.setDate(scheduledTime.getDate() + 1);
  }
  
  console.log(`⏰ [FALLBACK SCHEDULER] Random time: ${scheduledTime.toLocaleString()}`);
  return scheduledTime;
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
  getNextAvailableSlot,
  getNextFixedLocalSlots,
  getNextRandomEveningSlots
};

/**
 * Get the next N slots at exact local times in a given timezone (e.g., 9:00, 13:00, 18:00 America/Chicago)
 * Returns absolute Date objects by adding the CT minute delta to current UTC time.
 * @param {number} count - Number of slots to return
 * @param {string} timeZone - IANA TZ name (default America/Chicago)
 * @param {number[]} hours - Hours in 24h local time (default [9,13,18])
 * @returns {Date[]} Array of Date objects in UTC that correspond to those local times
 */
function getNextFixedLocalSlots(count, timeZone = 'America/Chicago', hours = [9, 13, 18]) {
  const now = new Date();
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(dtf.formatToParts(now).map(p => [p.type, p.value]));
  const nowHour = parseInt(parts.hour, 10);
  const nowMinute = parseInt(parts.minute, 10);
  const minutesNow = nowHour * 60 + nowMinute;

  const result = [];
  let dayOffset = 0;
  while (result.length < count && dayOffset < 7) {
    for (const h of hours) {
      const minutesTarget = h * 60; // on the hour
      let deltaMinutes = minutesTarget - minutesNow + dayOffset * 24 * 60;
      if (dayOffset === 0 && deltaMinutes <= 0) continue; // today but already passed
      const when = new Date(now.getTime() + deltaMinutes * 60 * 1000);
      result.push(when);
      if (result.length >= count) break;
    }
    dayOffset += 1;
  }
  return result;
}

/**
 * Get next N evening slots (6pm-10pm local) at non-rounded, odd-minute times (e.g., 6:33pm) in a timezone
 * Ensures future-only times and returns Date objects in UTC corresponding to those local times
 * @param {number} count
 * @param {string} timeZone
 * @param {number[]} hours - Evening hours (default 18..21)
 */
function getNextRandomEveningSlots(count, timeZone = 'America/Chicago', hours = [18, 19, 20, 21]) {
  const now = new Date();
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(dtf.formatToParts(now).map(p => [p.type, p.value]));
  const nowHour = parseInt(parts.hour, 10);
  const nowMinute = parseInt(parts.minute, 10);
  const minutesNow = nowHour * 60 + nowMinute;

  // Build allowed minutes: odd minutes, not multiples of 5
  const allowedMinutes = [];
  for (let m = 1; m < 60; m += 2) {
    if (m % 5 !== 0) allowedMinutes.push(m);
  }

  const result = [];
  let dayOffset = 0;
  while (result.length < count && dayOffset < 7) {
    for (const h of hours) {
      // Pick a random allowed minute for this slot
      const minute = allowedMinutes[Math.floor(Math.random() * allowedMinutes.length)];
      const minutesTarget = h * 60 + minute;
      let deltaMinutes = minutesTarget - minutesNow + dayOffset * 24 * 60;
      if (dayOffset === 0 && deltaMinutes <= 0) continue; // skip past times today
      const when = new Date(now.getTime() + deltaMinutes * 60 * 1000);
      result.push(when);
      if (result.length >= count) break;
    }
    dayOffset += 1;
  }
  return result;
}