/**
 * File Cleanup Service - STEP 3 Implementation
 * Handles deletion of local video files after successful posting
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * STEP 3: Delete video from local disk after successful posting
 */
export const deleteLocalVideo = async (videoPath: string): Promise<boolean> => {
  try {
    console.log('🗑️ [FILE CLEANUP] Attempting to delete local video:', videoPath);
    
    // Check if file exists
    if (!fs.existsSync(videoPath)) {
      console.log('⚠️ [FILE CLEANUP] Video file not found, may already be deleted:', videoPath);
      return true;
    }
    
    // Delete the file
    await fs.promises.unlink(videoPath);
    console.log('✅ [FILE CLEANUP] Successfully deleted local video:', videoPath);
    
    return true;
  } catch (error) {
    console.error('❌ [FILE CLEANUP ERROR] Failed to delete video:', videoPath, error);
    return false;
  }
};

/**
 * STEP 3: Delete thumbnail from local disk after successful posting
 */
export const deleteLocalThumbnail = async (thumbnailPath: string): Promise<boolean> => {
  try {
    console.log('🗑️ [FILE CLEANUP] Attempting to delete local thumbnail:', thumbnailPath);
    
    // Check if file exists
    if (!fs.existsSync(thumbnailPath)) {
      console.log('⚠️ [FILE CLEANUP] Thumbnail file not found, may already be deleted:', thumbnailPath);
      return true;
    }
    
    // Delete the file
    await fs.promises.unlink(thumbnailPath);
    console.log('✅ [FILE CLEANUP] Successfully deleted local thumbnail:', thumbnailPath);
    
    return true;
  } catch (error) {
    console.error('❌ [FILE CLEANUP ERROR] Failed to delete thumbnail:', thumbnailPath, error);
    return false;
  }
};

/**
 * STEP 3: Clean up entire temp directory after processing
 */
export const cleanupTempDirectory = async (tempDir: string): Promise<boolean> => {
  try {
    console.log('🗑️ [FILE CLEANUP] Cleaning up temp directory:', tempDir);
    
    if (!fs.existsSync(tempDir)) {
      console.log('⚠️ [FILE CLEANUP] Temp directory not found:', tempDir);
      return true;
    }
    
    // Read directory contents
    const files = await fs.promises.readdir(tempDir);
    
    // Delete all files in the directory
    for (const file of files) {
      const filePath = path.join(tempDir, file);
      const stats = await fs.promises.stat(filePath);
      
      if (stats.isFile()) {
        await fs.promises.unlink(filePath);
        console.log('🗑️ [FILE CLEANUP] Deleted temp file:', filePath);
      }
    }
    
    console.log('✅ [FILE CLEANUP] Successfully cleaned temp directory:', tempDir);
    return true;
  } catch (error) {
    console.error('❌ [FILE CLEANUP ERROR] Failed to clean temp directory:', tempDir, error);
    return false;
  }
};

/**
 * STEP 3: Delete processed files after successful posting (video + thumbnail)
 */
export const deleteProcessedFiles = async (
  videoPath: string, 
  thumbnailPath?: string
): Promise<boolean> => {
  try {
    console.log('🗑️ [FILE CLEANUP] Starting cleanup of processed files...');
    
    let success = true;
    
    // Delete video file
    const videoDeleted = await deleteLocalVideo(videoPath);
    if (!videoDeleted) success = false;
    
    // Delete thumbnail if provided
    if (thumbnailPath) {
      const thumbnailDeleted = await deleteLocalThumbnail(thumbnailPath);
      if (!thumbnailDeleted) success = false;
    }
    
    if (success) {
      console.log('✅ [FILE CLEANUP] All processed files deleted successfully');
    } else {
      console.error('❌ [FILE CLEANUP] Some files could not be deleted');
    }
    
    return success;
  } catch (error) {
    console.error('❌ [FILE CLEANUP ERROR] Failed to cleanup processed files:', error);
    return false;
  }
};

/**
 * Get file size for logging purposes
 */
export const getFileSize = (filePath: string): number => {
  try {
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      return stats.size;
    }
    return 0;
  } catch (error) {
    console.error('❌ [FILE SIZE ERROR]', error);
    return 0;
  }
};