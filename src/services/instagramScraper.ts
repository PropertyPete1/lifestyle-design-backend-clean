/**
 * Instagram Scraper Service - STEP 3 Implementation
 * Provides repost protection by checking last 30 Instagram posts
 */

export interface InstagramPost {
  id: string;
  media_url: string;
  caption: string;
  permalink: string;
  timestamp: string;
  media_type: string;
}

/**
 * STEP 3: Use Instagram scraper to get last 30 post IDs for repost protection
 * This replaces saving videos to MongoDB
 */
export const getRecentInstagramPosts = async (accessToken: string, limit: number = 30): Promise<InstagramPost[]> => {
  try {
    console.log('📱 [INSTAGRAM SCRAPER] Fetching last', limit, 'Instagram posts...');
    
    const url = `https://graph.instagram.com/me/media?fields=id,media_url,caption,permalink,timestamp,media_type&limit=${limit}&access_token=${accessToken}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Instagram API error: ${response.status} - ${response.statusText}`);
    }
    
    const data: any = await response.json();
    console.log('📱 [INSTAGRAM SCRAPER] Retrieved', data.data?.length || 0, 'posts');
    
    return data.data || [];
  } catch (error) {
    console.error('❌ [INSTAGRAM SCRAPER ERROR]', error);
    return [];
  }
};

/**
 * STEP 3: Check if a video was posted recently (repost protection)
 * Uses Instagram Graph API instead of MongoDB lookup
 */
export const wasPostedRecently = async (
  videoUrl: string, 
  caption: string, 
  accessToken: string
): Promise<boolean> => {
  try {
    console.log('🔍 [REPOST CHECK] Checking if video was posted recently...');
    
    // Get last 30 Instagram posts
    const recentPosts = await getRecentInstagramPosts(accessToken, 30);
    
    if (recentPosts.length === 0) {
      console.log('⚠️ [REPOST CHECK] No recent posts found, allowing posting');
      return false;
    }
    
    // Check for potential duplicates
    for (const post of recentPosts) {
      // Check media URL similarity (for exact matches)
      if (post.media_url === videoUrl) {
        console.log('🚫 [REPOST CHECK] Exact video URL match found:', post.id);
        return true;
      }
      
      // Check caption similarity (80% threshold)
      if (post.caption && caption) {
        const similarity = calculateStringSimilarity(post.caption, caption);
        if (similarity > 0.8) {
          console.log('🚫 [REPOST CHECK] Similar caption found (', Math.round(similarity * 100), '%):', post.id);
          return true;
        }
      }
    }
    
    console.log('✅ [REPOST CHECK] No duplicates found, safe to post');
    return false;
    
  } catch (error) {
    console.error('❌ [REPOST CHECK ERROR]', error);
    // On error, be conservative and allow posting
    return false;
  }
};

/**
 * Helper function to calculate string similarity
 */
function calculateStringSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

/**
 * Get Instagram access token from settings
 */
export const getInstagramAccessToken = async (): Promise<string | null> => {
  try {
    // This would typically fetch from your settings/environment
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
    if (!accessToken) {
      console.error('❌ [INSTAGRAM TOKEN] Access token not found in environment');
      return null;
    }
    return accessToken;
  } catch (error) {
    console.error('❌ [INSTAGRAM TOKEN ERROR]', error);
    return null;
  }
};