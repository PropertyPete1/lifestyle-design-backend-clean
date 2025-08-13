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
  const minLikes = Number(settings.minimumIGLikesToRepost || 0);
  let candidates = raw
    .map(v => ({
      id: v.id,
      url: v.url,
      thumbnailUrl: v.thumbnailUrl,
      caption: v.caption,
      likes: Number(v.likes || v.like_count || 0),
      engagement: Number(v.engagement || 0),
      audioId: v.audioId,
      duration: v.duration
    }))
    .filter(v => (minLikes ? v.likes >= minLikes : true))
    .sort((a,b) => (b.likes || 0) - (a.likes || 0));

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
    // Final strict visual-hash cooldown against posted/completed within window
    try {
      const mongoose = require('mongoose');
      const SchedulerQueueModel = mongoose.model('SchedulerQueue');
      const cooldownDays = Number(settings.repostCooldownDays || settings.dupLookbackDays || settings.repostDelay || 30);
      const since = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000);
      const recent = await SchedulerQueueModel.find({ status: { $in: ['posted','completed'] }, postedAt: { $gte: since }, visualHash: { $exists: true } }).select('visualHash').limit(200).lean();
      if (candidateAhash && recent.some(r => hammingDistance(candidateAhash, r.visualHash) <= 6)) continue;
    } catch (_) {}
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
  const pending = await SchedulerQueueModel.find({ status: { $in: ['pending','scheduled','processing'] } }).select('originalVideoId').lean();
  for (const x of pending) if (x.originalVideoId) blockedIds.add(x.originalVideoId);

  // Optimal slots from heatmap
  let optimal;
  try {
    const { computeOptimalTimes } = require('./heatmap');
    optimal = await computeOptimalTimes(Number(settings.maxPosts || 5));
  } catch (_) { optimal = { platforms, slots: [] }; }

  // Count current pending per platform for next 24h
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24*60*60*1000);

  let totalEnqueued = 0;
  let totalSkipped = 0;
  const skipReasons = [];
  const { uploadUrlToS3, uploadBufferToS3 } = require('../utils/s3Uploader');
  const { generateThumbnailBuffer } = require('../utils/videoThumbnail');
  const { proofreadCaptionWithKey } = require('./captionAI');
  // Defensive candidateBuilder require
  let buildCandidates;
  try {
    ({ buildCandidates } = require('./candidateBuilder'));
  } catch {
    buildCandidates = (scraped, recent, opts) => {
      try { return require('./candidateBuilder').buildCandidates(scraped, recent, opts); }
      catch { return require('./candidateBuilder.js').buildCandidates(scraped, recent, opts); }
    };
  }

  function normalizeOptimalSlots(optimal, platform) {
    if (!optimal || typeof optimal !== 'object') return [];
    if (Array.isArray(optimal.slotsCT) && optimal.slotsCT.length) {
      return optimal.slotsCT.map((iso) => new Date(iso));
    }
    if (Array.isArray(optimal.slotsUTC) && optimal.slotsUTC.length) {
      return optimal.slotsUTC.map((iso) => new Date(iso));
    }
    if (Array.isArray(optimal.slots) && optimal.slots.length) {
      const filtered = optimal.slots.filter((s) => !s?.platform || s.platform === platform);
      return filtered
        .map((s) => s?.ct || s?.utc || s?.iso || s?.date || s)
        .map((v) => (v instanceof Date ? v : new Date(v)))
        .filter((d) => !Number.isNaN(d.getTime()));
    }
    // Fallback: use Austin, TX (America/Chicago) prime-time windows 6–10pm CT
    const hoursCT = [18,19,20,21,22];
    const tz = 'America/Chicago';
    const now = new Date();

    function partsForTz(d) {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(d)
        .reduce((acc, p) => (acc[p.type] = p.value, acc), {});
      return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
    }
    function getOffsetMinutesAt(y, m, d, h) {
      // Build a UTC date near target and ask formatter for the shortOffset in CT
      const probe = new Date(Date.UTC(y, m - 1, d, h, 0, 0));
      const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' });
      const off = fmt.formatToParts(probe).find(p => p.type === 'timeZoneName')?.value || 'GMT-0';
      const m2 = off.match(/GMT([+\-])(\d{1,2})(?::(\d{2}))?/);
      if (!m2) return 0;
      const sign = m2[1] === '-' ? -1 : 1; // e.g., GMT-5 (CT summer) => -1
      const hh = parseInt(m2[2] || '0', 10);
      const mm = parseInt(m2[3] || '0', 10);
      // Local = UTC + offset(sign*hh), so UTC = Local - offset
      return -(sign * (hh * 60 + mm));
    }
    function makeCtDate(y, m, d, h) {
      const offMin = getOffsetMinutesAt(y, m, d, h); // negative for GMT-5 => -300
      const utcMillis = Date.UTC(y, m - 1, d, h, 0, 0) - offMin * 60000;
      return new Date(utcMillis);
    }

    const todayParts = partsForTz(now);
    const tomorrow = new Date(now.getTime() + 24*60*60*1000);
    const tomorrowParts = partsForTz(tomorrow);

    const todaySlots = hoursCT.map(h => makeCtDate(todayParts.year, todayParts.month, todayParts.day, h));
    const tomorrowSlots = hoursCT.map(h => makeCtDate(tomorrowParts.year, tomorrowParts.month, tomorrowParts.day, h));
    // Next 36 hours windows, strictly future (> now + 5m)
    const minFuture = new Date(now.getTime() + 5 * 60 * 1000);
    return [...todaySlots, ...tomorrowSlots].filter(d => d.getTime() > minFuture.getTime());
  }

  const tz = settings.timeZone || 'America/Chicago';
  const isValidDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());
  for (const platform of platforms) {
    const existing = await SchedulerQueueModel.countDocuments({ platform, status: { $in: ['pending','scheduled'] }, scheduledTime: { $gte: now, $lte: tomorrow } });
    const need = Math.max(0, Number(settings.maxPosts || maxPosts) - existing);
    // Prefer optimal slots; if not enough, fall back to Austin prime time 6–10pm CT slots already covered in normalizeOptimalSlots
    const slotList = normalizeOptimalSlots(optimal, platform).slice(0, need);
    for (let i = 0; i < need; i++) {
      let desired = slotList[i] || null;
      if (desired && !(desired instanceof Date)) {
        if (typeof desired === 'string') desired = new Date(desired);
        else if (desired?.iso) desired = new Date(desired.iso);
        else if (desired?.ct || desired?.utc) desired = new Date(desired.ct || desired.utc);
      }
      const candidate = await selectUniqueCandidate(settings, blockedIds, last30, last30Hashes, last30Ahashes);
      if (!candidate) { totalSkipped += 1; skipReasons.push('NO_UNIQUE_CANDIDATE'); break; }

      // Upload once (video)
      const s3Key = `autopilot/queue/${Date.now()}_${Math.random().toString(36).slice(2,8)}.mp4`;
      const s3Url = await uploadUrlToS3(candidate.url, s3Key, 'video/mp4');

      // Upload thumbnail (image) for UI preview when available + persist
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

      // Caption: proofread, then add CTA ONLY if not already present anywhere
      const ctaLine = '⬆️ Fill out the link in bio for info ⬆️';
      const proof = await proofreadCaptionWithKey(candidate.caption || '', settings.openaiApiKey || null);
      const body = (proof || '').trim();
      const hasCta = /\b(link in bio|link in profile)\b/i.test(body) || body.includes('⬆️') || body.includes('⬇️');
      const finalCaption = hasCta ? body : `${ctaLine}\n\n${body}`.trim();

      // Schedule time: use fixed Austin local slots (6–10pm CT) when no optimal slot
      const scheduledTime = isValidDate(desired) ? desired : new Date(now.getTime() + (existing + i + 1) * 60 * 60 * 1000);

      // Create ONE queue item for the current platform only (avoid duplicates)
      // Compute dedupe signals
      let visualHash = null;
      try {
        const { computeAverageHashFromImageUrl } = require('../utils/visualHash');
        const imgForHash = s3ThumbUrl || candidate.thumbnailUrl || candidate.url;
        visualHash = await computeAverageHashFromImageUrl(imgForHash);
      } catch (_) {}
      if (!visualHash) {
        const crypto = require('crypto');
        const basis = (s3ThumbUrl || candidate.thumbnailUrl || candidate.url || String(candidate.id)).toLowerCase();
        visualHash = crypto.createHash('md5').update(basis).digest('hex');
      }
      const { normalizeCaption } = require('./candidateBuilder');
      const captionNorm = normalizeCaption(candidate.caption || '');
      const audioKey = candidate.audioId || candidate.musicMetadata?.music_product_id || candidate.musicMetadata?.song_name || candidate.musicMetadata?.artist_name || undefined;
      const durationSec = typeof candidate.duration === 'number' ? Math.round(candidate.duration) : undefined;

      // Final duplicate guard using last 30 most recent queue items (not time-based)
      const recentQueue = await SchedulerQueueModel.find({ platform })
        .sort({ createdAt: -1 })
        .limit(30)
        .select('originalVideoId visualHash')
        .lean();
      const recentIds = new Set((recentQueue || []).map(r => r.originalVideoId).filter(Boolean));
      const recentHashes = new Set((recentQueue || []).map(r => r.visualHash).filter(Boolean));
      if (recentIds.has(candidate.id) || (visualHash && recentHashes.has(visualHash))) {
        totalSkipped += 1; skipReasons.push('ALREADY_IN_LAST_30'); continue;
      }

      await SchedulerQueueModel.create({
        platform,
        caption: finalCaption,
        scheduledTime,
        status: 'scheduled',
        source: 'autopilot',
        videoUrl: s3Url,
        s3Url,
        thumbnailUrl: s3ThumbUrl || candidate.thumbnailUrl || undefined,
        visualHash: visualHash || undefined,
        captionNorm,
        audioKey,
        durationSec,
        engagement: candidate.engagement,
        originalVideoId: candidate.id
      });

      // Block this id for subsequent selections in this run
      blockedIds.add(candidate.id);
      totalEnqueued += 1;
    }
  }

  return { success: true, message: 'Autopilot queue updated', processed: totalEnqueued, scheduled: totalEnqueued, skipped: totalSkipped, reasons: skipReasons };
}

module.exports = { runAutopilotOnce };

