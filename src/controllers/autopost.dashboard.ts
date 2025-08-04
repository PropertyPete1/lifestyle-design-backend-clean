import { Request, Response } from 'express';
import ActivityLog from '../models/activityLog';
import { MongoClient } from 'mongodb';
import { smartScheduler } from '../utils/aiTools';

/**
 * STEP 2: runNowToQueue function - ONLY QUEUE, NEVER POST
 * This function schedules posts using smartScheduler and autopilot_queue collection
 */
export const runNowToQueue = async (req: Request, res: Response) => {
  try {
    console.log('🔄 [RUN NOW TO QUEUE] Starting video queue process...');
    
    const { filename, caption, platform } = req.body;
    
    if (!filename) {
      return res.status(400).json({ error: 'filename is required', success: false });
    }
    
    // STEP 2: Use smartScheduler() to get optimal time
    console.log('📅 [SMART SCHEDULER] Calculating optimal posting time...');
    const scheduledAt = await smartScheduler();
    console.log('📅 [SMART SCHEDULER] Optimal time calculated:', scheduledAt.toLocaleString());

    // STEP 2: Insert into autopilot_queue collection
    const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/lifestyle-design';
    const client = new MongoClient(mongoUrl);
    
    try {
      await client.connect();
      const db = client.db();
      const queue = db.collection('autopilot_queue');
      
      const queueEntry = {
        filename,
        caption: caption || '',
        platform: platform || 'instagram',
        scheduledAt,
        status: 'pending',
        insertedAt: new Date()
      };
      
      const result = await queue.insertOne(queueEntry);
      console.log('📦 [QUEUE INSERT] Entry added to autopilot_queue:', result.insertedId);
      
      // Also log to ActivityLog for tracking
      const activityEntry = new ActivityLog({
        platform: platform || 'instagram',
        type: 'schedule',
        status: 'pending',
        message: '✅ Video successfully queued via runNowToQueue',
        caption: caption || '',
        scheduledAt,
        metadata: {
          queueId: result.insertedId,
          filename,
          scheduledBy: 'runNowToQueue'
        }
      });
      
      await activityEntry.save();
      console.log('✅ [RUN NOW TO QUEUE] Video queued successfully! Scheduled for:', scheduledAt.toLocaleString());

      res.status(200).json({ 
        message: '✅ Video added to Smart Queue', 
        scheduledAt,
        queueId: result.insertedId,
        success: true
      });
      
    } finally {
      await client.close();
    }
    
  } catch (err) {
    console.error('[RunNowToQueue ERROR]', err);
    res.status(500).json({ error: 'Failed to queue video', success: false });
  }
};

/**
 * STEP 4: Scheduler status endpoint - Return exact format specified
 */
export const getSchedulerStatus = async (req: Request, res: Response) => {
  try {
    console.log('📊 [SCHEDULER STATUS] Fetching queue status...');
    
    // Connect to MongoDB to check autopilot_queue
    const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/lifestyle-design';
    const client = new MongoClient(mongoUrl);
    
    try {
      await client.connect();
      const db = client.db();
      const queue = db.collection('autopilot_queue');
      
      // Get all pending posts from autopilot_queue (sorted by scheduledAt)
      const queuedPosts = await queue.find({
        status: 'pending'
      }).sort({ scheduledAt: 1 }).toArray();
      
      // Count total queued videos
      const totalQueued = queuedPosts.length;
      
      // Get next optimal time (earliest scheduled time)
      const nextOptimalTime = queuedPosts.length > 0 ? queuedPosts[0].scheduledAt : null;
      
      // Format queued videos with caption preview (first 50 chars)
      const queuedVideos = queuedPosts.slice(0, 10).map(post => ({
        filename: post.filename || 'unknown.mp4',
        captionPreview: post.caption ? 
          (post.caption.length > 50 ? post.caption.substring(0, 47) + '...' : post.caption) : 
          'No caption...',
        platform: post.platform || 'instagram',
        scheduledFor: post.scheduledAt
      }));
      
      // STEP 4: Return exact format specified
      const responseData = {
        nextOptimalTime,
        totalQueued,
        queuedVideos
      };

      console.log('📊 [SCHEDULER STATUS] Status data formatted:', {
        nextOptimalTime: responseData.nextOptimalTime,
        totalQueued: responseData.totalQueued,
        queuedVideosCount: responseData.queuedVideos.length
      });
      
      res.status(200).json(responseData);
      
    } finally {
      await client.close();
    }
    
  } catch (err) {
    console.error('[SCHEDULER STATUS ERROR]', err);
    res.status(500).json({ 
      error: 'Failed to get scheduler status',
      nextOptimalTime: null,
      totalQueued: 0,
      queuedVideos: []
    });
  }
};