import mongoose from 'mongoose';
import dayjs from 'dayjs';
import { checkS3Object } from './s3';
import { DailyCounterModel } from '../models/DailyCounter';
import { PostModel } from '../models/Post';

async function getAutopilotQueue(): Promise<any[]> {
  let SchedulerQueueModel: any;
  try { SchedulerQueueModel = mongoose.model('SchedulerQueue'); } catch (_) {}
  if (!SchedulerQueueModel) {
    const schema = new (mongoose as any).Schema({}, { strict: false, timestamps: true, collection: 'SchedulerQueue' });
    SchedulerQueueModel = mongoose.model('SchedulerQueue', schema);
  }
  const items = await SchedulerQueueModel.find({ status: { $in: ['scheduled', 'pending', 'processing'] } })
    .sort({ scheduledTime: 1 })
    .lean();
  return items.map((x: any) => ({
    _id: x._id,
    platform: x.platform,
    scheduledTime: x.scheduledTime,
    videoUrl: x.videoUrl || x.s3Url,
    thumbUrl: x.thumbnailUrl || x.thumbUrl,
    caption: x.caption
  }));
}

async function getSchedulerStatus(): Promise<{ enabled: boolean; dailyLimit: number; postsToday: number }>{
  const SettingsModel = mongoose.model('SettingsClean');
  const settings: any = await SettingsModel.findOne({}).lean();
  const enabled = !!settings?.autopilotEnabled;
  const dailyLimit = Number(settings?.maxPosts || 5);
  const today = dayjs().format('YYYYMMDD');
  const ig = await DailyCounterModel.findOne({ platform: 'instagram', dateKey: today }).lean();
  const yt = await DailyCounterModel.findOne({ platform: 'youtube', dateKey: today }).lean();
  const postsToday = (ig?.count || 0) + (yt?.count || 0);
  return { enabled, dailyLimit, postsToday };
}

async function listPostsToday(): Promise<any[]> {
  const start = dayjs().startOf('day').toDate();
  const end = dayjs().endOf('day').toDate();
  const rows = await PostModel.find({ postedAt: { $gte: start, $lte: end }, status: 'posted' })
    .sort({ createdAt: -1 })
    .lean();
  return rows.map(r => ({ platform: r.platform, externalPostId: r.externalPostId, at: r.postedAt || r.createdAt }));
}

export async function runAutopilotDiagnostics() {
  const today = dayjs().startOf('day');
  const postsToday = await listPostsToday();
  const scheduler = await getSchedulerStatus();
  const queue = await getAutopilotQueue();

  const reasons: any[] = [];

  if (!scheduler.enabled) {
    reasons.push({ reason: 'SCHEDULER_DISABLED' });
  }

  if (scheduler.postsToday >= scheduler.dailyLimit) {
    reasons.push({ reason: 'DAILY_LIMIT_REACHED', limit: scheduler.dailyLimit, used: scheduler.postsToday });
  }

  if (!queue || queue.length === 0) {
    reasons.push({ reason: 'QUEUE_EMPTY' });
  }

  for (const item of queue) {
    if (!item.videoUrl || !item.thumbUrl) {
      reasons.push({ reason: 'MISSING_ASSET', itemId: String(item._id || '') });
      continue;
    }
    const videoOk = await checkS3Object(item.videoUrl);
    const thumbOk = await checkS3Object(item.thumbUrl);
    if (!videoOk) reasons.push({ reason: 'S3_VIDEO_MISSING', url: item.videoUrl });
    if (!thumbOk) reasons.push({ reason: 'S3_THUMB_MISSING', url: item.thumbUrl });
  }

  if (postsToday.length === 0) {
    reasons.push({ reason: 'NO_POSTS_TODAY' });
  }

  return {
    date: today.format('YYYY-MM-DD'),
    postsToday: postsToday.length,
    scheduler,
    queueLength: queue.length,
    reasons,
  };
}

module.exports = { runAutopilotDiagnostics };

