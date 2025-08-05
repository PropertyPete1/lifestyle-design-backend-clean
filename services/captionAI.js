// ✅ AI Caption Generator Service - Phase 9 AutoPilot System
const fetch = require('node-fetch');

/**
 * Generates smart caption using OpenAI GPT-4
 * @param {string} originalCaption - Original Instagram caption
 * @param {Object} Settings - Mongoose Settings model
 * @returns {string} Rewritten caption
 */
async function generateSmartCaption(originalCaption, Settings) {
  try {
    console.log('✍️ [AI CAPTION] Generating smart caption...');
    
    const settings = await Settings.findOne();
    if (!settings || !settings.openaiApiKey) {
      console.log('⚠️ [AI CAPTION] No OpenAI key found, using modified original caption');
      return modifyOriginalCaption(originalCaption);
    }

    const prompt = `Rewrite this Instagram caption to be engaging and fresh while keeping the same meaning. Make it sound natural and authentic. Remove any dashes or bullet points. Keep it under 150 characters:

Original: "${originalCaption}"

Rewritten:`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are a social media expert who rewrites captions to be engaging and authentic.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 100,
        temperature: 0.7
      })
    });

    const data = await response.json();
    
    if (data.error) {
      console.log('⚠️ [AI CAPTION] OpenAI error, using fallback');
      return modifyOriginalCaption(originalCaption);
    }

    const rewrittenCaption = data.choices[0]?.message?.content?.trim() || originalCaption;
    console.log(`✅ [AI CAPTION] Generated: "${rewrittenCaption.substring(0, 50)}..."`);
    
    return rewrittenCaption;

  } catch (error) {
    console.error('❌ [AI CAPTION ERROR]', error);
    return modifyOriginalCaption(originalCaption);
  }
}

/**
 * Fallback caption modification when AI is unavailable
 * @param {string} originalCaption - Original caption
 * @returns {string} Modified caption
 */
function modifyOriginalCaption(originalCaption) {
  if (!originalCaption) return "Check out this amazing content! 🔥";
  
  // Simple modifications to make it different
  let modified = originalCaption
    .replace(/\-/g, '') // Remove dashes
    .replace(/\•/g, '') // Remove bullet points
    .replace(/^\s+|\s+$/g, '') // Trim whitespace
    .replace(/\s+/g, ' '); // Normalize spaces

  // Add some variety
  const prefixes = ['', 'Amazing! ', 'Check this out: ', 'Love this: '];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  
  modified = prefix + modified;
  
  // Limit length
  if (modified.length > 150) {
    modified = modified.substring(0, 147) + '...';
  }
  
  return modified;
}

/**
 * Gets optimal posting time based on engagement patterns
 * @param {string} platform - Platform (instagram/youtube)
 * @returns {Date} Optimal posting time
 */
async function getBestTimeToPost(platform = 'instagram') {
  try {
    console.log(`🕒 [SMART TIMING] Calculating best time for ${platform}...`);
    
    // Smart scheduling based on platform
    const now = new Date();
    let optimalTime = new Date(now);
    
    if (platform === 'instagram') {
      // Instagram peak hours: 6-9 AM, 12-2 PM, 5-7 PM
      const currentHour = now.getHours();
      
      if (currentHour < 6) {
        optimalTime.setHours(6, 0, 0, 0); // 6 AM today
      } else if (currentHour < 12) {
        optimalTime.setHours(12, 0, 0, 0); // 12 PM today
      } else if (currentHour < 17) {
        optimalTime.setHours(17, 0, 0, 0); // 5 PM today
      } else {
        // Schedule for tomorrow 6 AM
        optimalTime.setDate(optimalTime.getDate() + 1);
        optimalTime.setHours(6, 0, 0, 0);
      }
    } else if (platform === 'youtube') {
      // YouTube peak hours: 2-4 PM, 8-11 PM
      const currentHour = now.getHours();
      
      if (currentHour < 14) {
        optimalTime.setHours(14, 0, 0, 0); // 2 PM today
      } else if (currentHour < 20) {
        optimalTime.setHours(20, 0, 0, 0); // 8 PM today
      } else {
        // Schedule for tomorrow 2 PM
        optimalTime.setDate(optimalTime.getDate() + 1);
        optimalTime.setHours(14, 0, 0, 0);
      }
    }
    
    console.log(`✅ [SMART TIMING] Optimal time: ${optimalTime.toLocaleString()}`);
    return optimalTime;
    
  } catch (error) {
    console.error('❌ [SMART TIMING ERROR]', error);
    // Fallback: 2 hours from now
    const fallbackTime = new Date();
    fallbackTime.setHours(fallbackTime.getHours() + 2);
    return fallbackTime;
  }
}

module.exports = {
  generateSmartCaption,
  getBestTimeToPost,
  modifyOriginalCaption
};