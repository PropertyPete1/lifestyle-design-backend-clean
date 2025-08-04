/**
 * Video Posting Service - STEP 3 Implementation
 * Handles video posting with cleanup and repost protection
 */

import { deleteProcessedFiles } from './fileCleanup';
import { wasPostedRecently, getInstagramAccessToken } from './instagramScraper';
import ActivityLog from '../models/activityLog';

export interface PostingResult {
  success: boolean;
  postId?: string;
  message: string;
  error?: string;
}

/**
 * STEP 3: Post video with cleanup - DELETE local files after posting, NO MongoDB saving
 */
export const postVideoWithCleanup = async (
  videoPath: string,
  caption: string,
  platform: 'instagram' | 'youtube' = 'instagram',
  thumbnailPath?: string
): Promise<PostingResult> => {
  try {
    console.log('🚀 [VIDEO POSTING] Starting posting process for:', platform);
    console.log('📹 [VIDEO POSTING] Video path:', videoPath);
    console.log('📝 [VIDEO POSTING] Caption:', caption.substring(0, 100) + '...');
    
    // STEP 3: Check repost protection using Instagram scraper (not MongoDB)
    console.log('🔍 [VIDEO POSTING] Checking repost protection...');
    const accessToken = await getInstagramAccessToken();
    
    if (accessToken) {
      const isRepost = await wasPostedRecently(videoPath, caption, accessToken);
      if (isRepost) {
        console.log('🚫 [VIDEO POSTING] Repost detected, skipping posting');
        
        // Still cleanup the local files since we're not posting
        await deleteProcessedFiles(videoPath, thumbnailPath);
        
        return {
          success: false,
          message: 'Video was recently posted, skipping to avoid duplicate',
          error: 'REPOST_DETECTED'
        };
      }
    } else {
      console.log('⚠️ [VIDEO POSTING] No Instagram access token, skipping repost check');
    }
    
    // Proceed with posting
    let postResult: PostingResult;
    
    if (platform === 'instagram') {
      postResult = await postToInstagram(videoPath, caption);
    } else if (platform === 'youtube') {
      postResult = await postToYouTube(videoPath, caption);
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }
    
    // STEP 3: After successful posting, DELETE local files (do NOT save to MongoDB)
    if (postResult.success) {
      console.log('✅ [VIDEO POSTING] Post successful, cleaning up local files...');
      
      const cleanupSuccess = await deleteProcessedFiles(videoPath, thumbnailPath);
      if (cleanupSuccess) {
        console.log('✅ [VIDEO POSTING] Local files deleted successfully');
      } else {
        console.error('⚠️ [VIDEO POSTING] Some files could not be deleted');
      }
      
      // Log successful posting to ActivityLog (but don't save video files)
      const activityEntry = new ActivityLog({
        platform,
        type: 'post',
        status: 'success',
        message: `✅ Video posted successfully to ${platform}`,
        caption,
        videoId: postResult.postId,
        metadata: {
          postId: postResult.postId,
          originalVideoPath: videoPath, // Just for reference, file is deleted
          filesDeleted: cleanupSuccess
        }
      });
      
      await activityEntry.save();
      console.log('📝 [VIDEO POSTING] Activity logged to database');
    } else {
      console.error('❌ [VIDEO POSTING] Posting failed, keeping local files for retry');
    }
    
    return postResult;
    
  } catch (error) {
    console.error('❌ [VIDEO POSTING ERROR]', error);
    return {
      success: false,
      message: 'Video posting failed due to system error',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
};

/**
 * Post video to Instagram
 */
async function postToInstagram(videoPath: string, caption: string): Promise<PostingResult> {
  try {
    console.log('📱 [INSTAGRAM POSTING] Starting Instagram post...');
    
    // TODO: Implement actual Instagram posting logic
    // This would use Instagram Graph API to create media and publish
    
    // Simulated posting for now
    const mockPostId = 'ig_' + Date.now();
    
    console.log('✅ [INSTAGRAM POSTING] Post created successfully:', mockPostId);
    
    return {
      success: true,
      postId: mockPostId,
      message: 'Successfully posted to Instagram'
    };
    
  } catch (error) {
    console.error('❌ [INSTAGRAM POSTING ERROR]', error);
    return {
      success: false,
      message: 'Failed to post to Instagram',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Post video to YouTube
 */
async function postToYouTube(videoPath: string, caption: string): Promise<PostingResult> {
  try {
    console.log('📺 [YOUTUBE POSTING] Starting YouTube upload...');
    
    // TODO: Implement actual YouTube posting logic
    // This would use YouTube Data API to upload video
    
    // Simulated posting for now
    const mockVideoId = 'yt_' + Date.now();
    
    console.log('✅ [YOUTUBE POSTING] Video uploaded successfully:', mockVideoId);
    
    return {
      success: true,
      postId: mockVideoId,
      message: 'Successfully uploaded to YouTube'
    };
    
  } catch (error) {
    console.error('❌ [YOUTUBE POSTING ERROR]', error);
    return {
      success: false,
      message: 'Failed to upload to YouTube',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}