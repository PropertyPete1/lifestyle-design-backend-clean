/**
 * AutoPilot Controller - PHASE 9 Implementation
 * Handles automated Instagram repost system with engagement-based selection
 */

import { Request, Response } from 'express';
import { MongoClient } from 'mongodb';
import { postVideoWithCleanup } from '../services/videoPosting';
import { smartScheduler } from '../utils/aiTools';
import ActivityLog from '../models/activityLog';
import Settings from '../models/Settings';

// Import Phase 9 services
const { scrapeLatestInstagramVideos, getLast30AutopilotPosts, generateContentFingerprint, downloadInstagramMedia } = require('../../services/instagramScraper');
const { uploadToS3, generateAutopilotFilename } = require('../../services/s3Uploader');
const { generateSmartCaption, getBestTimeToPost } = require('../../services/captionAI');

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

/**
 * PHASE 9: Complete Instagram AutoPilot Repost System
 * Scrapes Instagram, selects top engagement video, uploads to S3, schedules posting
 */
export const runPhase9System = async (req: Request, res: Response) => {
  try {
    console.log('🚀 [PHASE 9] Starting Instagram AutoPilot Repost System...');
    
    const settings = await Settings.findOne();
    if (!settings) {
      return res.status(400).json({
        success: false,
        message: 'Settings not found. Please configure your credentials first.',
        error: 'NO_SETTINGS'
      });
    }

    if (!settings.autopilotEnabled) {
      return res.status(400).json({
        success: false,
        message: 'AutoPilot is disabled. Enable it in settings first.',
        error: 'AUTOPILOT_DISABLED'
      });
    }

    // Step 1: Scrape latest Instagram videos
    console.log('📱 [PHASE 9] Step 1: Scraping latest Instagram videos...');
    const videos = await scrapeLatestInstagramVideos(Settings, 500);
    
    if (!videos.length) {
      return res.status(404).json({
        success: false,
        message: 'No videos found in Instagram feed',
        error: 'NO_VIDEOS'
      });
    }

    // Step 2: Get recent posts to avoid duplicates
    console.log('🔍 [PHASE 9] Step 2: Checking for duplicates...');
    const recentPosts = await getLast30AutopilotPosts('instagram');
    const recentFingerprints = recentPosts.map((v: any) => generateContentFingerprint(v));

    // Step 3: Filter eligible videos - PHASE 9 uses VIEW COUNTS (primary) with ENGAGEMENT fallback
    console.log('⚡ [PHASE 9] Step 3: Filtering eligible videos by VIEW COUNT (engagement fallback)...');
    const minThreshold = settings.minViews || 10000;
    
    const eligible = videos
      .filter((v: any) => {
        // Primary: Use view count if available (visual scraper)
        if (v.viewCount && v.viewCount > 0) {
          return v.viewCount >= minThreshold;
        }
        // Fallback: Use engagement if no view count (Graph API only)
        return v.engagement >= minThreshold;
      })
      .filter((v: any) => !recentFingerprints.includes(generateContentFingerprint(v)))
      .sort((a: any, b: any) => {
        // Primary sort by view count, fallback to engagement
        const aScore = a.viewCount > 0 ? a.viewCount : a.engagement;
        const bScore = b.viewCount > 0 ? b.viewCount : b.engagement;
        return bScore - aScore;
      });

    if (!eligible.length) {
      const eligibleByViews = videos.filter((v: any) => v.viewCount >= minThreshold).length;
      const eligibleByEngagement = videos.filter((v: any) => v.engagement >= minThreshold).length;
      
      return res.status(404).json({
        success: false,
        message: `No eligible videos found (need ≥${minThreshold.toLocaleString()} views/engagement, not recently posted)`,
        videosScraped: videos.length,
        eligibleByViews,
        eligibleByEngagement,
        error: 'NO_ELIGIBLE_VIDEOS'
      });
    }

    const selectedVideo = eligible[0];
    const primaryMetric = selectedVideo.viewCount > 0 ? 'views' : 'engagement';
    const primaryValue = selectedVideo.viewCount > 0 ? selectedVideo.viewCount : selectedVideo.engagement;
    
    console.log(`🎯 [PHASE 9] Selected video with ${primaryValue?.toLocaleString()} ${primaryMetric} (views: ${selectedVideo.viewCount || 'N/A'}, engagement: ${selectedVideo.engagement || 'N/A'})`);

    // Step 4: Generate smart caption
    console.log('✍️ [PHASE 9] Step 4: Generating smart caption...');
    const newCaption = await generateSmartCaption(selectedVideo.caption, Settings);

    // Step 5: Download video from Instagram
    console.log('⬇️ [PHASE 9] Step 5: Downloading video...');
    const videoBuffer = await downloadInstagramMedia(selectedVideo.downloadUrl);

    // Step 6: Upload to S3
    console.log('☁️ [PHASE 9] Step 6: Uploading to S3...');
    const filename = generateAutopilotFilename('instagram');
    const s3Result = await uploadToS3({ file: videoBuffer, filename }, Settings);

    // Step 7: Schedule posts for enabled platforms
    const scheduledPosts = [];
    const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/lifestyle-design';
    const client = new MongoClient(mongoUrl);

    try {
      await client.connect();
      const db = client.db();
      const queue = db.collection('autopilot_queue');

      // Instagram scheduling
      if (settings.instagramEnabled) {
        const instagramTime = await getBestTimeToPost('instagram');
        const instagramPost = {
          platform: 'instagram',
          videoId: selectedVideo.id,
          originalEngagement: selectedVideo.engagement,
          filename,
          caption: newCaption,
          s3Url: s3Result.Location,
          scheduledAt: instagramTime,
          status: 'scheduled',
          createdAt: new Date(),
          autopilotGenerated: true
        };
        
        await queue.insertOne(instagramPost);
        scheduledPosts.push({
          platform: 'instagram',
          scheduledAt: instagramTime.toISOString(),
          s3Url: s3Result.Location
        });
        console.log(`📅 [PHASE 9] Instagram scheduled for: ${instagramTime.toLocaleString()}`);
      }

      // YouTube scheduling
      if (settings.youtubeEnabled) {
        const youtubeTime = await getBestTimeToPost('youtube');
        const youtubePost = {
          platform: 'youtube',
          videoId: selectedVideo.id,
          originalEngagement: selectedVideo.engagement,
          filename,
          caption: newCaption,
          s3Url: s3Result.Location,
          scheduledAt: youtubeTime,
          status: 'scheduled',
          createdAt: new Date(),
          autopilotGenerated: true
        };
        
        await queue.insertOne(youtubePost);
        scheduledPosts.push({
          platform: 'youtube',
          scheduledAt: youtubeTime.toISOString(),
          s3Url: s3Result.Location
        });
        console.log(`📅 [PHASE 9] YouTube scheduled for: ${youtubeTime.toLocaleString()}`);
      }

      // Update last run time
      await Settings.updateOne({}, { lastAutopilotRun: new Date() });

    } finally {
      await client.close();
    }

    console.log('✅ [PHASE 9] AutoPilot system completed successfully!');

    res.status(200).json({
      success: true,
      message: 'Phase 9 AutoPilot completed successfully',
      data: {
        videosScraped: videos.length,
        eligibleVideos: eligible.length,
        selectedVideo: {
          id: selectedVideo.id,
          viewCount: selectedVideo.viewCount,
          engagement: selectedVideo.engagement,
          caption: selectedVideo.caption?.substring(0, 100) + '...'
        },
        generatedCaption: newCaption,
        s3Upload: {
          url: s3Result.Location,
          filename
        },
        scheduledPosts,
        platforms: {
          instagram: settings.instagramEnabled,
          youtube: settings.youtubeEnabled
        }
      }
    });

  } catch (error) {
    console.error('❌ [PHASE 9 ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'Phase 9 AutoPilot system failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Get AutoPilot status for frontend dashboard
 */
export const getAutoPilotStatus = async (req: Request, res: Response) => {
  try {
    const settings = await Settings.findOne();
    const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/lifestyle-design';
    const client = new MongoClient(mongoUrl);

    try {
      await client.connect();
      const db = client.db();
      const queue = db.collection('autopilot_queue');
      
      const now = new Date();
      const stats = await queue.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]).toArray();

      const statusCounts = stats.reduce((acc: any, stat: any) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {});

      const nextScheduled = await queue.findOne(
        { status: 'scheduled', scheduledAt: { $gte: now } },
        { sort: { scheduledAt: 1 } }
      );

      res.json({
        success: true,
        autopilotEnabled: settings?.autopilotEnabled || false,
        lastRun: settings?.lastAutopilotRun || null,
        platforms: {
          instagram: settings?.instagramEnabled || false,
          youtube: settings?.youtubeEnabled || false
        },
        queue: {
          scheduled: statusCounts.scheduled || 0,
          processing: statusCounts.processing || 0,
          completed: statusCounts.completed || 0,
          failed: statusCounts.failed || 0
        },
        nextPost: nextScheduled ? {
          platform: nextScheduled.platform,
          scheduledAt: nextScheduled.scheduledAt,
          caption: nextScheduled.caption?.substring(0, 50) + '...'
        } : null
      });

    } finally {
      await client.close();
    }

  } catch (error) {
    console.error('❌ [AUTOPILOT STATUS ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get autopilot status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Get queued videos for dashboard display
 */
export const getAutoPilotQueue = async (req: Request, res: Response) => {
  try {
    const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/lifestyle-design';
    const client = new MongoClient(mongoUrl);

    try {
      await client.connect();
      const db = client.db();
      const queue = db.collection('autopilot_queue');
      
      const queuedVideos = await queue.find({
        status: { $in: ['scheduled', 'processing'] }
      })
      .sort({ scheduledAt: 1 })
      .limit(20)
      .toArray();

      const formattedQueue = queuedVideos.map((video: any) => ({
        id: video._id,
        platform: video.platform,
        caption: video.caption?.substring(0, 100) + '...',
        scheduledAt: video.scheduledAt,
        status: video.status,
        s3Url: video.s3Url,
        engagement: video.originalEngagement,
        createdAt: video.createdAt
      }));

      res.json({
        success: true,
        queue: formattedQueue,
        total: queuedVideos.length
      });

    } finally {
      await client.close();
    }

  } catch (error) {
    console.error('❌ [AUTOPILOT QUEUE ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get autopilot queue',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};