/**
 * Autopilot Service
 * - Reuses Post Now selection logic to find FIRST unique candidate
 * - Keeps queue filled up to settings.maxPosts per platform for the next 24h
 * - 30-day repost delay via ActivityLog, and skip anything already queued (SchedulerQueue)
 */

const mongoose = require('mongoose');
const stringSimilarity = require('string-similarity');

async function getModels() {
  let SettingsModel, SchedulerQueueModel, ActivityLogModel;
  SettingsModel = mongoose.model('SettingsClean');
  try {
    SchedulerQueueModel = mongoose.model('SchedulerQueue');
  } catch (e) {}
  if (!SchedulerQueueModel) {
    const schedulerQueueSchema = new mongoose.Schema({},{strict:false, timestamps:true, collection:'SchedulerQueue'});
    SchedulerQueueModel = mongoose.model('SchedulerQueue', schedulerQueueSchema);
  }
  try {
    ActivityLogModel = mongoose.model('ActivityLog');
  } catch (e) {
    const activityLogSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
    ActivityLogModel = mongoose.model('ActivityLog', activityLogSchema, 'activitylogs');
  }
  return { SettingsModel, SchedulerQueueModel, ActivityLogModel };
}

function isDurationSimilar(a, b) {
  if (a == null || b == null) return false;
  return Math.abs(Math.round(a) - Math.round(b)) <= 1;
}

async function selectUniqueCandidate(settings, blockedIds, last30, last30Hashes, last30Ahashes) {
  const { scrapeInstagramEngagement, generateThumbnailHash } = require('../utils/instagramScraper');
  const { computeAverageHashFromImageUrl, hammingDistance } = require('../utils/visualHash');

  // Scrape candidates (500), filter >= 10k engagement, sort desc
  const raw = await scrapeInstagramEngagement(settings.igBusinessId, settings.instagramToken, 500);
  let candidates = raw
    .map(v => ({
      id: v.id, url: v.url, thumbnailUrl: v.thumbnailUrl, caption: v.caption,
      engagement: v.engagement, audioId: v.audioId, duration: v.duration
    }))
    .filter(v => v.engagement >= 10000)
    .sort((a,b) => b.engagement - a.engagement);

  const last30Captions = last30.map(p => p.caption);
  const last30Durations = last30.map(p => p.duration);
  const last30AudioIds = last30.map(p => p.audioId).filter(Boolean);

  const MIN_BYTES_QUALITY = Number(process.env.MIN_VIDEO_BYTES_QUALITY || 3 * 1024 * 1024);
  const fetch = require('node-fetch');

  for (const video of candidates) {
    if (blockedIds.has(video.id)) continue;
    if (last30Durations.some(d => isDurationSimilar(d, video.duration))) continue;

    try {
      const headResp = await fetch(video.url, { method: 'HEAD' });
      const size = parseInt(headResp.headers.get('content-length') || '0', 10);
      if (Number.isFinite(size) && size > 0 && size < MIN_BYTES_QUALITY) continue;
    } catch (_) {}

    let hash, candidateAhash = null;
    try {
      hash = await generateThumbnailHash(video.thumbnailUrl || video.url || '');
      candidateAhash = await computeAverageHashFromImageUrl(video.thumbnailUrl || video.url || '');
    } catch (e) {
      const crypto = require('crypto');
      const fallback = (video.thumbnailUrl || video.url || '').toLowerCase();
      hash = crypto.createHash('md5').update(fallback).digest('hex').substring(0, 16);
    }

    const isDuplicateVisual = last30Hashes.includes(hash)
      || (candidateAhash && last30Ahashes.some(past => hammingDistance(candidateAhash, past) <= 6));
    const isDuplicateCaption = last30Captions.some((c) => {
      const a = (video.caption || '').toLowerCase();
      const b = (c || '').toLowerCase();
      return stringSimilarity.compareTwoStrings(a, b) > 0.85;
    });
    const isDuplicateAudio = last30AudioIds.includes(video.audioId);

    if (isDuplicateVisual || isDuplicateCaption || isDuplicateAudio) continue;
    return video;
  }
  return null;
}

async function runAutopilotOnce() {
  const { SettingsModel, SchedulerQueueModel, ActivityLogModel } = await getModels();
  const settings = await SettingsModel.findOne({});
  if (!settings || !settings.autopilotEnabled) {
    return { success: true, message: 'Autopilot disabled', processed: 0 };
  }

  // Platforms
  const platforms = (settings.postToInstagram === false && settings.postToYouTube)
    ? ['youtube']
    : (settings.postToYouTube ? ['instagram','youtube'] : ['instagram']);
  const maxPosts = Number(settings.maxPosts || 5);
  const repostDelayDays = Number(settings.repostDelay || 30);

  // Build last30 from IG and hashes
  const { scrapeInstagramEngagement, generateThumbnailHash } = require('../utils/instagramScraper');
  const { computeAverageHashFromImageUrl } = require('../utils/visualHash');
  const myPosts = await scrapeInstagramEngagement(settings.igBusinessId, settings.instagramToken, 30);
  const last30 = myPosts;
  const last30Hashes = [];
  const last30Ahashes = [];
  for (const post of last30) {
    try {
      const h = await generateThumbnailHash(post.thumbnailUrl || post.url || '');
      last30Hashes.push(h);
      try {
        const ah = await computeAverageHashFromImageUrl(post.thumbnailUrl || post.url || '');
        last30Ahashes.push(ah);
      } catch(_){}
    } catch(_){}
  }

  // Blocked IDs: IG last30 + ActivityLog last 30d + SchedulerQueue pending
  const blockedIds = new Set(last30.map(p=>p.id));
  const since = new Date(Date.now() - repostDelayDays*24*60*60*1000);
  const recentPosted = await ActivityLogModel.find({ platform: 'instagram', status: 'success', createdAt: { $gte: since } }).select('originalVideoId').lean();
  for (const x of recentPosted) if (x.originalVideoId) blockedIds.add(x.originalVideoId);
  const pending = await SchedulerQueueModel.find({ status: { $in: ['pending','scheduled'] } }).select('originalVideoId').lean();
  for (const x of pending) if (x.originalVideoId) blockedIds.add(x.originalVideoId);

  // Count current pending per platform for next 24h
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24*60*60*1000);

  let totalEnqueued = 0;
  const { uploadUrlToS3, uploadBufferToS3 } = require('../utils/s3Uploader');
  const { generateThumbnailBuffer } = require('../utils/videoThumbnail');
  const { proofreadCaptionWithKey } = require('./captionAI');

  for (const platform of platforms) {
    const existing = await SchedulerQueueModel.countDocuments({ platform, status: { $in: ['pending','scheduled'] }, scheduledTime: { $gte: now, $lte: tomorrow } });
    const need = Math.max(0, maxPosts - existing);
    for (let i = 0; i < need; i++) {
      const candidate = await selectUniqueCandidate(settings, blockedIds, last30, last30Hashes, last30Ahashes);
      if (!candidate) break;

      // Upload once (video)
      const s3Key = `autopilot/queue/${Date.now()}_${Math.random().toString(36).slice(2,8)}.mp4`;
      const s3Url = await uploadUrlToS3(candidate.url, s3Key, 'video/mp4');

      // Upload thumbnail (image) for UI preview when available
      let s3ThumbUrl = null;
      try {
        // Prefer IG thumbnail if available; otherwise capture from video
        if (candidate.thumbnailUrl) {
          const thumbKey = `autopilot/queue-thumbs/${Date.now()}_${Math.random().toString(36).slice(2,8)}.jpg`;
          s3ThumbUrl = await uploadUrlToS3(candidate.thumbnailUrl, thumbKey, 'image/jpeg');
        } else {
          const thumbBuf = await generateThumbnailBuffer(candidate.url);
          const thumbKey = `autopilot/queue-thumbs/${Date.now()}_${Math.random().toString(36).slice(2,8)}.jpg`;
          s3ThumbUrl = await uploadBufferToS3(thumbBuf, thumbKey, 'image/jpeg');
        }
      } catch (_) {}

      // Caption: proofread + top CTA arrows
      const ctaLine = '⬆️ Fill out the link in bio for info ⬆️';
      const proof = await proofreadCaptionWithKey(candidate.caption || '', settings.openaiApiKey || null);
      const finalCaption = `${ctaLine}\n\n${proof || ''}`.trim();

      // Schedule time: spread within next 24h roughly evenly after now
      const scheduledTime = new Date(now.getTime() + (existing + i) * (Math.floor(24/maxPosts) || 1) * 60*60*1000);

      for (const pf of platforms) {
        await SchedulerQueueModel.create({
          platform: pf,
          caption: finalCaption,
          scheduledTime,
          status: 'scheduled',
          source: 'autopilot',
          videoUrl: s3Url,
          s3Url,
          thumbnailUrl: s3ThumbUrl || candidate.thumbnailUrl || undefined,
          engagement: candidate.engagement,
          originalVideoId: candidate.id
        });
      }

      // Block this id for subsequent selections in this run
      blockedIds.add(candidate.id);
      totalEnqueued += platforms.length;
    }
  }

  return { success: true, message: 'Autopilot queue updated', processed: totalEnqueued };
}

module.exports = { runAutopilotOnce };

