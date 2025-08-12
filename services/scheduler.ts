import mongoose from 'mongoose';
import { postOnce } from './postOnce';
import { getRemainingSlots } from './limits';

export async function executeQueueItemOnce(queueItem: any, settings: any): Promise<{ success: boolean; deduped?: boolean; externalPostId?: string; note?: string }>{
  const platform = (queueItem.platform || 'instagram') as 'instagram' | 'youtube';
  const scheduledAt: Date = queueItem.scheduledTime ? new Date(queueItem.scheduledTime) : new Date();
  const videoHash: string = queueItem.thumbnailHash || queueItem.originalVideoId || queueItem._id?.toString();
  const videoUrl: string = queueItem.videoUrl || queueItem.s3Url;

  if (!videoUrl) throw new Error('Missing videoUrl');

  // Extra safety: if this platform+videoHash was already posted, short-circuit to avoid duplicates
  try {
    const { PostModel } = require('../models/Post');
    const existing = await PostModel.findOne({ platform, videoHash, status: 'posted' }).lean();
    if (existing && existing.externalPostId) {
      return { success: true, deduped: true, externalPostId: existing.externalPostId, note: 'already-posted' };
    }
  } catch (_) {}

  const dailyLimit = Number(settings.maxPosts || 5);
  const remaining = await getRemainingSlots(platform, dailyLimit);
  if (remaining <= 0) {
    return { success: false, note: 'daily-limit-reached' };
  }

  if (platform === 'instagram') {
    return await postOnce(platform, videoHash, scheduledAt, {
      videoUrl,
      caption: queueItem.caption || '',
      settings
    }) as any;
  }

  // youtube
  const caption = queueItem.caption || '';
  const title = caption.slice(0, 95) || 'New Homes Available';
  const description = caption.slice(0, 4900);
  return await postOnce(platform, videoHash, scheduledAt, {
    videoUrl,
    title,
    description,
    settings
  }) as any;
}

module.exports = { executeQueueItemOnce };


