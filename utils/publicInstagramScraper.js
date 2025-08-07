/**
 * Public Instagram Scraper - Get view counts from public Instagram handle
 * Then match with Graph API to download videos
 */

const fetch = require('node-fetch');
const { generateThumbnailHash } = require('./postHistory');

/**
 * Scrape public Instagram profile for video view counts
 * @param {string} handle - Instagram handle (e.g., "lifestyledesignrealtytexas")
 * @param {string} businessId - Instagram Business Account ID
 * @param {string} accessToken - Instagram Access Token
 * @param {number} limit - Number of videos to scrape
 * @returns {Promise<Array>} Array of video objects with real view counts
 */
async function scrapePublicInstagramWithViews(handle, businessId, accessToken, limit = 200) {
  try {
    console.log(`🌐 [PUBLIC SCRAPER] Scraping @${handle} for view counts...`);
    
    // Step 1: Get public Instagram data with view counts
    const publicVideos = await getPublicInstagramVideos(handle, limit);
    console.log(`🌐 [PUBLIC SCRAPER] Found ${publicVideos.length} public videos with view counts`);
    
    if (publicVideos.length === 0) {
      return [];
    }
    
    // Step 2: Get your Instagram media via Graph API
    console.log(`📱 [GRAPH API] Fetching your Instagram media via API...`);
    const apiVideos = await getInstagramVideoViaAPI(businessId, accessToken, limit);
    console.log(`📱 [GRAPH API] Found ${apiVideos.length} videos via API`);
    
    // Step 3: Match public videos with API videos and combine data
    const matchedVideos = await matchPublicWithAPI(publicVideos, apiVideos);
    console.log(`✅ [MATCHER] Successfully matched ${matchedVideos.length} videos`);
    
    return matchedVideos;
    
  } catch (error) {
    console.error('❌ [PUBLIC SCRAPER] Error:', error.message);
    return [];
  }
}

/**
 * Get public Instagram videos with view counts
 */
async function getPublicInstagramVideos(handle, limit) {
  try {
    console.log(`🌐 [PUBLIC SCRAPER] Using direct Instagram scraping for @${handle}...`);
    
    // Method 1: Try Instagram mobile endpoint
    let url = `https://i.instagram.com/api/v1/users/web_info/?username=${handle}`;
    let response = await fetch(url, {
      headers: {
        'User-Agent': 'Instagram 76.0.0.15.395 Android (24/7.0; 640dpi; 1440x2560; samsung; SM-G930F; herolte; samsungexynos8890; en_US; 138226743)',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-IG-App-ID': '936619743392459'
      }
    });
    
    if (!response.ok) {
      console.log('⚠️ [PUBLIC SCRAPER] Mobile API failed, trying web scraping...');
      return await getPublicInstagramAlternate(handle, limit);
    }
    
    let data = await response.json();
    let userId = data?.data?.user?.id;
    
    if (!userId) {
      console.log('⚠️ [PUBLIC SCRAPER] Could not get user ID, trying alternate method...');
      return await getPublicInstagramAlternate(handle, limit);
    }
    
    // Method 2: Get user media using the user ID
    url = `https://i.instagram.com/api/v1/feed/user/${userId}/?count=${limit}`;
    response = await fetch(url, {
      headers: {
        'User-Agent': 'Instagram 76.0.0.15.395 Android (24/7.0; 640dpi; 1440x2560; samsung; SM-G930F; herolte; samsungexynos8890; en_US; 138226743)',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-IG-App-ID': '936619743392459'
      }
    });
    
    if (!response.ok) {
      console.log('⚠️ [PUBLIC SCRAPER] Media API failed, trying alternate method...');
      return await getPublicInstagramAlternate(handle, limit);
    }
    
    data = await response.json();
    const items = data?.items || [];
    
    const videos = [];
    for (const item of items.slice(0, limit)) {
      if (item.media_type === 2 && item.video_versions && item.view_count) { // media_type 2 = video
        videos.push({
          shortcode: item.code,
          views: item.view_count,
          likes: item.like_count || 0,
          caption: item.caption?.text || '',
          timestamp: new Date(item.taken_at * 1000).toISOString(),
          thumbnailUrl: item.image_versions2?.candidates?.[0]?.url || '',
          engagement: item.view_count + (item.like_count || 0) + (item.comment_count || 0)
        });
      }
    }
    
    return videos;
    
  } catch (error) {
    console.log('⚠️ [PUBLIC SCRAPER] Error with mobile API, trying alternate method...');
    return await getPublicInstagramAlternate(handle, limit);
  }
}

/**
 * Alternate method to get Instagram data
 */
async function getPublicInstagramAlternate(handle, limit) {
  try {
    // Fallback: scrape Instagram page directly
    const url = `https://www.instagram.com/${handle}/`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1'
      }
    });
    
    const html = await response.text();
    
    // Extract JSON data from Instagram page
    const scriptMatch = html.match(/window\._sharedData\s*=\s*({.+?});/);
    if (!scriptMatch) {
      console.log('⚠️ [PUBLIC SCRAPER] Could not extract data from page');
      return [];
    }
    
    const data = JSON.parse(scriptMatch[1]);
    const media = data?.entry_data?.ProfilePage?.[0]?.graphql?.user?.edge_owner_to_timeline_media?.edges || [];
    
    const videos = [];
    for (const edge of media.slice(0, limit)) {
      const node = edge.node;
      
      if (node.is_video && node.video_view_count) {
        videos.push({
          shortcode: node.shortcode,
          views: node.video_view_count,
          likes: node.edge_media_preview_like.count,
          caption: node.edge_media_to_caption?.edges?.[0]?.node?.text || '',
          timestamp: new Date(node.taken_at_timestamp * 1000).toISOString(),
          thumbnailUrl: node.display_url,
          engagement: node.video_view_count + node.edge_media_preview_like.count
        });
      }
    }
    
    return videos;
    
  } catch (error) {
    console.error('❌ [PUBLIC SCRAPER] Alternate method failed:', error.message);
    return [];
  }
}

/**
 * Get Instagram videos via Graph API
 */
async function getInstagramVideoViaAPI(businessId, accessToken, limit) {
  try {
    const videos = [];
    let nextPageUrl = `https://graph.facebook.com/v19.0/${businessId}/media?fields=id,media_type,media_url,thumbnail_url,caption,like_count,comments_count,timestamp,permalink&limit=50&access_token=${accessToken}`;
    
    while (videos.length < limit && nextPageUrl) {
      const response = await fetch(nextPageUrl);
      const data = await response.json();
      
      if (!response.ok) {
        console.error('❌ [GRAPH API] Error:', data);
        break;
      }
      
      for (const media of data.data || []) {
        if (media.media_type === 'VIDEO') {
          videos.push({
            id: media.id,
            url: media.media_url,
            thumbnailUrl: media.thumbnail_url,
            caption: media.caption || '',
            likes: media.like_count || 0,
            comments: media.comments_count || 0,
            timestamp: media.timestamp,
            permalink: media.permalink,
            shortcode: extractShortcodeFromPermalink(media.permalink)
          });
        }
      }
      
      nextPageUrl = data.paging?.next;
    }
    
    return videos;
    
  } catch (error) {
    console.error('❌ [GRAPH API] Error:', error.message);
    return [];
  }
}

/**
 * Extract shortcode from Instagram permalink
 */
function extractShortcodeFromPermalink(permalink) {
  const match = permalink.match(/\/p\/([A-Za-z0-9_-]+)\//);
  return match ? match[1] : null;
}

/**
 * Match public videos with API videos
 */
async function matchPublicWithAPI(publicVideos, apiVideos) {
  const matchedVideos = [];
  
  for (const publicVideo of publicVideos) {
    // Find matching API video by shortcode
    const apiVideo = apiVideos.find(v => v.shortcode === publicVideo.shortcode);
    
    if (apiVideo) {
      // Combine data: use public view count + API download URL
      const combinedVideo = {
        id: apiVideo.id,
        url: apiVideo.url, // API provides download URL
        thumbnailUrl: apiVideo.thumbnailUrl,
        caption: apiVideo.caption,
        likes: publicVideo.likes,
        comments: apiVideo.comments,
        views: publicVideo.views, // Real view count from public scraping
        engagement: publicVideo.views + publicVideo.likes + apiVideo.comments,
        timestamp: apiVideo.timestamp,
        permalink: apiVideo.permalink,
        thumbnailHash: await generateThumbnailHash(apiVideo.thumbnailUrl),
        fingerprint: await generateThumbnailHash(apiVideo.thumbnailUrl)
      };
      
      matchedVideos.push(combinedVideo);
    }
  }
  
  return matchedVideos;
}

module.exports = {
  scrapePublicInstagramWithViews
};