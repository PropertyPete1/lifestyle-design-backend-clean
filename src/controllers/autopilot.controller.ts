/**
 * AutoPilot Controller - STEP 3 Implementation
 * Handles automated posting with cleanup and repost protection
 */

import { Request, Response } from 'express';
import { MongoClient } from 'mongodb';
import { postVideoWithCleanup } from '../services/videoPosting';
import { smartScheduler } from '../utils/aiTools';
import ActivityLog from '../models/activityLog';

/**
 * STEP 3: AutoPilot run endpoint - Posts videos with cleanup, no MongoDB file saving
 */
export const runAutoPilot = async (req: Request, res: Response) => {
  try {
    console.log('🤖 [AUTOPILOT] Starting AutoPilot posting process...');
    
    // Get next video from queue
    const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/lifestyle-design';
    const client = new MongoClient(mongoUrl);
    
    try {
      await client.connect();
      const db = client.db();
      const queue = db.collection('autopilot_queue');
      
      // Find next scheduled video that's ready to post
      const now = new Date();
      const nextVideo = await queue.findOne({
        status: 'pending',
        scheduledAt: { $lte: now }
      }, {
        sort: { scheduledAt: 1 }
      });
      
      if (!nextVideo) {
        console.log('📋 [AUTOPILOT] No videos ready for posting');
        return res.status(200).json({
          success: true,
          message: 'No videos scheduled for posting at this time',
          videosProcessed: 0
        });
      }
      
      console.log('📹 [AUTOPILOT] Found video to post:', nextVideo.filename);
      console.log('📅 [AUTOPILOT] Scheduled for:', nextVideo.scheduledAt);
      
      // Mark as processing
      await queue.updateOne(
        { _id: nextVideo._id },
        { 
          $set: { 
            status: 'processing',
            processingStarted: new Date()
          } 
        }
      );
      
      // STEP 3: Post video with cleanup (deletes local files, no MongoDB saving)
      const postResult = await postVideoWithCleanup(
        nextVideo.filename,
        nextVideo.caption,
        nextVideo.platform
      );
      
      if (postResult.success) {
        // Mark as completed in queue
        await queue.updateOne(
          { _id: nextVideo._id },
          { 
            $set: { 
              status: 'completed',
              completedAt: new Date(),
              postId: postResult.postId
            } 
          }
        );
        
        console.log('✅ [AUTOPILOT] Video posted successfully:', postResult.postId);
        
        res.status(200).json({
          success: true,
          message: 'Video posted successfully',
          postId: postResult.postId,
          platform: nextVideo.platform,
          videosProcessed: 1
        });
        
      } else {
        // Mark as failed in queue
        await queue.updateOne(
          { _id: nextVideo._id },
          { 
            $set: { 
              status: 'failed',
              failedAt: new Date(),
              error: postResult.error || postResult.message
            } 
          }
        );
        
        console.error('❌ [AUTOPILOT] Video posting failed:', postResult.message);
        
        res.status(500).json({
          success: false,
          message: postResult.message,
          error: postResult.error,
          videosProcessed: 0
        });
      }
      
    } finally {
      await client.close();
    }
    
  } catch (error) {
    console.error('❌ [AUTOPILOT ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'AutoPilot process failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      videosProcessed: 0
    });
  }
};

/**
 * STEP 3: Process multiple videos from queue
 */
export const runAutoPilotBatch = async (req: Request, res: Response) => {
  try {
    console.log('🤖 [AUTOPILOT BATCH] Starting batch processing...');
    
    const { limit = 5 } = req.body; // Process up to 5 videos
    let videosProcessed = 0;
    const results = [];
    
    // Get videos from queue
    const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/lifestyle-design';
    const client = new MongoClient(mongoUrl);
    
    try {
      await client.connect();
      const db = client.db();
      const queue = db.collection('autopilot_queue');
      
      // Find videos ready to post
      const now = new Date();
      const videosToPost = await queue.find({
        status: 'pending',
        scheduledAt: { $lte: now }
      }).sort({ scheduledAt: 1 }).limit(limit).toArray();
      
      console.log('📋 [AUTOPILOT BATCH] Found', videosToPost.length, 'videos to process');
      
      for (const video of videosToPost) {
        try {
          console.log('📹 [AUTOPILOT BATCH] Processing:', video.filename);
          
          // Mark as processing
          await queue.updateOne(
            { _id: video._id },
            { 
              $set: { 
                status: 'processing',
                processingStarted: new Date()
              } 
            }
          );
          
          // STEP 3: Post with cleanup
          const postResult = await postVideoWithCleanup(
            video.filename,
            video.caption,
            video.platform
          );
          
          if (postResult.success) {
            await queue.updateOne(
              { _id: video._id },
              { 
                $set: { 
                  status: 'completed',
                  completedAt: new Date(),
                  postId: postResult.postId
                } 
              }
            );
            
            videosProcessed++;
            results.push({
              filename: video.filename,
              success: true,
              postId: postResult.postId,
              platform: video.platform
            });
            
          } else {
            await queue.updateOne(
              { _id: video._id },
              { 
                $set: { 
                  status: 'failed',
                  failedAt: new Date(),
                  error: postResult.error || postResult.message
                } 
              }
            );
            
            results.push({
              filename: video.filename,
              success: false,
              error: postResult.message,
              platform: video.platform
            });
          }
          
          // Wait between posts to avoid rate limiting
          if (videosToPost.length > 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
          
        } catch (error) {
          console.error('❌ [AUTOPILOT BATCH] Error processing video:', video.filename, error);
          
          await queue.updateOne(
            { _id: video._id },
            { 
              $set: { 
                status: 'failed',
                failedAt: new Date(),
                error: error instanceof Error ? error.message : 'Unknown error'
              } 
            }
          );
        }
      }
      
    } finally {
      await client.close();
    }
    
    console.log('✅ [AUTOPILOT BATCH] Batch complete. Processed:', videosProcessed, 'videos');
    
    res.status(200).json({
      success: true,
      message: `Processed ${videosProcessed} videos`,
      videosProcessed,
      results
    });
    
  } catch (error) {
    console.error('❌ [AUTOPILOT BATCH ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'Batch processing failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      videosProcessed: 0
    });
  }
};