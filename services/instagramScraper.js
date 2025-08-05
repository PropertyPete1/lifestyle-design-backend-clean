// ✅ Instagram Visual Scraper Service - Phase 9 AutoPilot System
let fetch;
try {
  // Try node-fetch first
  fetch = require('node-fetch');
} catch (err) {
  try {
    // Try built-in fetch (Node 18+)
    fetch = globalThis.fetch;
    if (!fetch) throw new Error('No fetch available');
  } catch (err2) {
    // Final fallback: create a simple HTTP client
    const https = require('https');
    const http = require('http');
    const { URL } = require('url');
    
    fetch = async (url, options = {}) => {
      return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const client = parsedUrl.protocol === 'https:' ? https : http;
        
        const req = client.request(url, {
          method: options.method || 'GET',
          headers: options.headers || {}
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              json: () => Promise.resolve(JSON.parse(data)),
              text: () => Promise.resolve(data)
            });
          });
        });
        
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
      });
    };
  }
}

// Puppeteer with fallback for Render deployment
let puppeteer = null;
try {
  puppeteer = require('puppeteer');
  console.log('✅ Puppeteer loaded successfully');
} catch (err) {
  console.warn('⚠️ Puppeteer not available, visual scraping disabled:', err.message);
  // Create a mock puppeteer object for fallback
  puppeteer = {
    launch: () => {
      throw new Error('Puppeteer not installed - visual scraping unavailable');
    }
  };
}

/**
 * Graph API Fallback - When visual scraping is not available
 * Uses Instagram Graph API to get videos (without view counts)
 * @param {Object} settings - Settings from MongoDB
 * @param {number} limit - Number of videos to fetch
 * @returns {Array} Array of video objects with engagement data
 */
async function getLatestInstagramVideosGraphAPI(settings, limit = 500) {
  try {
    console.log('📊 [GRAPH API FALLBACK] Fetching Instagram videos via Graph API...');
    
    const mediaUrl = `https://graph.facebook.com/v19.0/${settings.igBusinessId}/media?fields=id,caption,media_url,permalink,timestamp,media_type,like_count,comments_count&limit=${Math.min(limit, 100)}&access_token=${settings.instagramToken}`;
    
    const response = await fetch(mediaUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Graph API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.data || !Array.isArray(data.data)) {
      console.warn('⚠️ [GRAPH API] No media data returned');
      return [];
    }

    // Filter for videos only and calculate engagement
    const videos = data.data
      .filter(item => item.media_type === 'VIDEO')
      .map(video => ({
        id: video.id,
        caption: video.caption || '',
        downloadUrl: video.media_url,
        permalink: video.permalink,
        timestamp: video.timestamp,
        viewCount: 0, // Graph API doesn't provide view counts
        engagement: (video.like_count || 0) + (video.comments_count || 0),
        likes: video.like_count || 0,
        comments: video.comments_count || 0,
        source: 'graph_api_fallback'
      }));

    console.log(`✅ [GRAPH API FALLBACK] Found ${videos.length} videos`);
    return videos;

  } catch (error) {
    console.error('❌ [GRAPH API FALLBACK] Error:', error.message);
    return [];
  }
}

/**
 * PHASE 9: Visual Instagram Scraper - Gets ACTUAL view counts
 * Scrapes Instagram profile visually to get real view data (not just engagement)
 * @param {Object} Settings - Mongoose Settings model
 * @param {number} limit - Number of videos to fetch (default: 500)
 * @returns {Array} Array of video objects with REAL view counts
 */
async function scrapeLatestInstagramVideos(Settings, limit = 500) {
  let browser = null;
  
  try {
    console.log('🔄 [VISUAL SCRAPER] Starting visual Instagram scraping for view counts...');
    
    const settings = await Settings.findOne();
    if (!settings || !settings.instagramToken || !settings.igBusinessId) {
      throw new Error('Instagram credentials not found in settings');
    }

    // Check if puppeteer is available
    if (!puppeteer || typeof puppeteer.launch !== 'function') {
      console.warn('⚠️ [VISUAL SCRAPER] Puppeteer not available, falling back to Graph API only');
      return await getLatestInstagramVideosGraphAPI(settings, limit);
    }

    // Launch headless browser for visual scraping
    const launchOptions = {
      headless: 'new', // Use new headless mode
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-features=VizDisplayCompositor',
        '--disable-extensions',
        '--disable-plugins',
        '--disable-images',
        '--disable-javascript',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-networking',
        '--memory-pressure-off',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process'
      ],
      // Render.com specific settings
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      timeout: 30000,
      protocolTimeout: 30000
    };

    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    
    // Set realistic user agent and viewport
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });

    // Get Instagram username from business account ID
    const instagramUsername = await getInstagramUsername(settings.instagramToken, settings.igBusinessId);
    if (!instagramUsername) {
      throw new Error('Could not get Instagram username from business account');
    }

    console.log(`📱 [VISUAL SCRAPER] Scraping profile: @${instagramUsername}`);
    
    // Navigate to Instagram profile
    await page.goto(`https://www.instagram.com/${instagramUsername}/`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for posts to load
    await page.waitForSelector('article div div div div a', { timeout: 15000 });

    // Scroll and collect video posts with view counts
    const videos = [];
    let scrollCount = 0;
    const maxScrolls = Math.ceil(limit / 12); // ~12 posts per screen

    while (videos.length < limit && scrollCount < maxScrolls) {
      // Get all video posts currently visible
      const newVideos = await page.evaluate(() => {
        const posts = Array.from(document.querySelectorAll('article div div div div a'));
        const videoData = [];

        posts.forEach(post => {
          try {
            // Check if it's a video (has play icon or video indicator)
            const hasVideoIcon = post.querySelector('svg[aria-label="Clip"]') || 
                                post.querySelector('svg[aria-label="Video"]') ||
                                post.querySelector('[aria-label*="video"]') ||
                                post.querySelector('[aria-label*="reel"]');
            
            if (hasVideoIcon) {
              const href = post.href;
              const img = post.querySelector('img');
              const thumbnail = img ? img.src : null;
              
              // Try to find view count in various possible locations
              let viewCount = 0;
              const viewElements = [
                post.querySelector('[aria-label*="views"]'),
                post.querySelector('[aria-label*="view"]'),
                post.nextElementSibling?.querySelector('[aria-label*="views"]'),
                post.parentElement?.querySelector('[aria-label*="views"]')
              ];

              for (const element of viewElements) {
                if (element && element.textContent) {
                  const viewText = element.textContent.toLowerCase();
                  const viewMatch = viewText.match(/(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:k|m|views?)/i);
                  if (viewMatch) {
                    let views = parseFloat(viewMatch[1].replace(/,/g, ''));
                    if (viewText.includes('k')) views *= 1000;
                    if (viewText.includes('m')) views *= 1000000;
                    viewCount = Math.floor(views);
                    break;
                  }
                }
              }

              if (href && !videoData.find(v => v.permalink === href)) {
                videoData.push({
                  id: href.split('/p/')[1]?.split('/')[0] || Date.now().toString(),
                  permalink: href,
                  thumbnailUrl: thumbnail,
                  viewCount: viewCount,
                  timestamp: new Date().toISOString() // Will be updated with actual data
                });
              }
            }
          } catch (error) {
            console.log('Error processing post:', error);
          }
        });

        return videoData;
      });

      // Add new videos that we haven't seen before
      newVideos.forEach(video => {
        if (!videos.find(v => v.permalink === video.permalink)) {
          videos.push(video);
        }
      });

      console.log(`📊 [VISUAL SCRAPER] Found ${videos.length} videos so far...`);

      // Scroll down to load more posts
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });

      // Wait for new content to load
      await page.waitForTimeout(2000);
      scrollCount++;
    }

    // Now get additional details for each video using Graph API
    console.log('📡 [VISUAL SCRAPER] Enhancing with Graph API data...');
    const enhancedVideos = await enhanceWithGraphAPI(videos.slice(0, limit), settings);

    // Return all videos with both view counts AND engagement data
    // Phase 9 controller will handle filtering and fallback logic
    const processedVideos = enhancedVideos.map(video => ({
      ...video,
      // Ensure we have both metrics for proper filtering
      viewCount: video.viewCount || 0,
      engagement: video.engagement || 0,
      // Add metadata about data source
      dataSource: video.viewCount > 0 ? 'visual_scraper' : 'graph_api_only'
    }));

    const withViews = processedVideos.filter(v => v.viewCount > 0).length;
    const withEngagement = processedVideos.filter(v => v.engagement > 0).length;

    console.log(`✅ [VISUAL SCRAPER] Processed ${processedVideos.length} videos:`);
    console.log(`   📊 ${withViews} with view counts (visual scraping)`);
    console.log(`   💖 ${withEngagement} with engagement data (Graph API)`);
    
    if (processedVideos.length > 0) {
      const topVideo = processedVideos[0];
      console.log(`🎯 [VISUAL SCRAPER] Top video: ${topVideo.viewCount?.toLocaleString() || 'N/A'} views, ${topVideo.engagement || 'N/A'} engagement`);
    }

    return processedVideos;

  } catch (error) {
    console.error('❌ [VISUAL SCRAPER ERROR]', error);
    console.log('🔄 [FALLBACK] Attempting Graph API fallback...');
    
    try {
      const settings = await Settings.findOne();
      if (settings) {
        return await getLatestInstagramVideosGraphAPI(settings, limit);
      }
    } catch (fallbackError) {
      console.error('❌ [FALLBACK ERROR]', fallbackError);
    }
    
    // If all else fails, return empty array instead of throwing
    console.warn('⚠️ [FINAL FALLBACK] Returning empty array');
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Get Instagram username from business account ID
 */
async function getInstagramUsername(accessToken, businessAccountId) {
  try {
    const response = await fetch(`https://graph.facebook.com/v19.0/${businessAccountId}?fields=username&access_token=${accessToken}`);
    const data = await response.json();
    return data.username;
  } catch (error) {
    console.error('Error getting Instagram username:', error);
    return null;
  }
}

/**
 * Enhance scraped videos with Graph API data (caption, media_url, etc.)
 */
async function enhanceWithGraphAPI(videos, settings) {
  try {
    const accessToken = settings.instagramToken;
    const businessAccountId = settings.igBusinessId;

    // Get all media from Graph API
    const mediaUrl = `https://graph.facebook.com/v19.0/${businessAccountId}/media?fields=id,media_type,media_url,thumbnail_url,caption,timestamp,like_count,comments_count,permalink&access_token=${accessToken}&limit=500`;
    
    const response = await fetch(mediaUrl);
    const data = await response.json();

    if (data.error) {
      console.warn('Graph API error:', data.error.message);
      return videos; // Return videos without enhancement
    }

    const apiVideos = data.data.filter(item => item.media_type === 'VIDEO');

    // Match visual scraper data with API data
    return videos.map(video => {
      const apiMatch = apiVideos.find(api => 
        api.permalink === video.permalink || 
        api.id === video.id
      );

      if (apiMatch) {
        return {
          ...video,
          id: apiMatch.id,
          caption: apiMatch.caption || '',
          mediaUrl: apiMatch.media_url,
          downloadUrl: apiMatch.media_url,
          timestamp: apiMatch.timestamp,
          likeCount: apiMatch.like_count || 0,
          commentsCount: apiMatch.comments_count || 0,
          engagement: (apiMatch.like_count || 0) + (apiMatch.comments_count || 0) * 5
        };
      }

      return video;
    });

  } catch (error) {
    console.error('Error enhancing with Graph API:', error);
    return videos;
  }
}

/**
 * Gets last 30 autopilot posts to avoid duplicates
 * @param {string} platform - Platform to check (instagram/youtube)
 * @returns {Array} Array of recent post fingerprints
 */
async function getLast30AutopilotPosts(platform = 'instagram') {
  try {
    const { MongoClient } = require('mongodb');
    const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/lifestyle-design';
    const client = new MongoClient(mongoUrl);

    console.log(`🔍 [DUPLICATE CHECK] Checking last 30 ${platform} posts...`);
    
    try {
      await client.connect();
      const db = client.db();
      const queue = db.collection('autopilot_queue');
      
      // Get last 30 posts for this platform
      const recentPosts = await queue.find({
        platform: platform,
        autopilotGenerated: true,
        status: { $in: ['completed', 'scheduled', 'processing'] }
      })
      .sort({ createdAt: -1 })
      .limit(30)
      .toArray();

      console.log(`✅ [DUPLICATE CHECK] Found ${recentPosts.length} recent ${platform} posts`);
      return recentPosts;

    } finally {
      await client.close();
    }
  } catch (error) {
    console.error('❌ [DUPLICATE CHECK ERROR]', error);
    return [];
  }
}

/**
 * Generates content fingerprint to detect similar content
 * @param {Object} video - Video object
 * @returns {string} Unique fingerprint
 */
function generateContentFingerprint(video) {
  const caption = (video.caption || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const duration = video.duration || 0;
  return `${caption.substring(0, 50)}_${duration}`;
}

/**
 * Downloads Instagram media from direct URL
 * @param {string} mediaUrl - Direct media URL from Instagram
 * @returns {Buffer} File buffer
 */
async function downloadInstagramMedia(mediaUrl) {
  try {
    console.log('⬇️ [DOWNLOAD] Downloading Instagram video...');
    const response = await fetch(mediaUrl);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }
    const buffer = await response.buffer();
    console.log(`✅ [DOWNLOAD] Video downloaded (${buffer.length} bytes)`);
    return buffer;
  } catch (error) {
    console.error('❌ [DOWNLOAD ERROR]', error);
    throw error;
  }
}

module.exports = {
  scrapeLatestInstagramVideos,
  getLast30AutopilotPosts,
  generateContentFingerprint,
  downloadInstagramMedia
};