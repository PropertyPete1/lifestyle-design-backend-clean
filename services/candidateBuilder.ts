import mongoose from 'mongoose';
import fetch from 'node-fetch';

type Platform = 'instagram' | 'youtube';

function normalizeCaption(input: string = ''): string {
  const lower = input.toLowerCase();
  // remove urls, hashtags, punctuation except spaces
  const noUrls = lower.replace(/https?:\/\/\S+/g, '');
  const noTags = noUrls.replace(/#[\w_]+/g, '');
  const noPunct = noTags.replace(/[\.,/!$%^&*;:{}=\-_`~()\[\]"]/g, ' ');
  return noPunct.replace(/\s+/g, ' ').trim();
}

async function computeVisualHashFromUrl(imageOrVideoUrl: string): Promise<string> {
  const { computeAverageHashFromImageUrl } = require('../utils/visualHash');
  // Prefer image thumbnail URL for stability
  return await computeAverageHashFromImageUrl(imageOrVideoUrl);
}

async function getSettingsModel() {
  try {
    return mongoose.model('SettingsClean');
  } catch {
    return require('../src/models/settings');
  }
}

async function upsertPostSignals(platform: Platform, externalPostId: string, postedAt: Date | string | undefined, signals: { visualHash?: string; audioKey?: string; captionNorm?: string; durationSec?: number; thumbUrl?: string }) {
  try {
    const { PostModel } = require('../models/Post');
    const postedAtDate = postedAt ? new Date(postedAt) : new Date();
    await PostModel.updateOne(
      { platform, externalPostId },
      { $set: { platform, externalPostId, postedAt: postedAtDate, ...signals } },
      { upsert: true }
    );
  } catch {}
}

async function fetchLast30Instagram(settings: any) {
  const { scrapeInstagramEngagement, generateThumbnailHash } = require('../utils/instagramScraper');
  const list = await scrapeInstagramEngagement(settings.igBusinessId, settings.instagramToken, 30);
  const out: Array<{ visualHash?: string; audioKey?: string; captionNorm?: string; durationSec?: number; postedAt?: Date; thumbUrl?: string } & { externalPostId: string; url: string; thumbnailUrl?: string; caption?: string; duration?: number } > = [];
  for (const v of list) {
    let vh: string | undefined;
    try { vh = await generateThumbnailHash(v.thumbnailUrl || v.url); } catch {}
    const audioKey = v.audioId || v.musicMetadata?.music_product_id || v.musicMetadata?.song_name || v.musicMetadata?.artist_name || undefined;
    const captionNorm = normalizeCaption(v.caption || '');
    const durationSec = typeof v.duration === 'number' ? Math.round(v.duration) : undefined;
    out.push({ externalPostId: v.id, url: v.url, thumbnailUrl: v.thumbnailUrl, caption: v.caption, visualHash: vh, audioKey, captionNorm, durationSec, postedAt: v.timestamp ? new Date(v.timestamp) : undefined });
    await upsertPostSignals('instagram', v.id, v.timestamp, { visualHash: vh, audioKey, captionNorm, durationSec });
  }
  return out;
}

async function fetchLast30YouTube(settings: any) {
  const results: any[] = [];
  if (!settings?.youtubeAccessToken && !(settings?.youtubeClientId && settings?.youtubeClientSecret && settings?.youtubeRefreshToken)) return results;
  let accessToken = settings.youtubeAccessToken;
  if (!accessToken) {
    // Try refresh
    try {
      const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: settings.youtubeClientId,
          client_secret: settings.youtubeClientSecret,
          refresh_token: settings.youtubeRefreshToken,
          grant_type: 'refresh_token'
        }) as any
      });
      const j = await resp.json();
      if (resp.ok && j.access_token) accessToken = j.access_token;
    } catch {}
  }
  if (!accessToken) return results;
  // Get channel id
  let channelId = settings.youtubeChannelId;
  if (!channelId) {
    const ch = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true', { headers: { Authorization: `Bearer ${accessToken}` } });
    const j = await ch.json();
    channelId = j?.items?.[0]?.id;
  }
  if (!channelId) return results;
  // search last 30
  const sr = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&maxResults=30&order=date&type=video`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const sj = await sr.json();
  const ids = (sj?.items || []).map((it: any) => it.id?.videoId).filter(Boolean);
  if (!ids.length) return results;
  // details for duration
  const vr = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${ids.join(',')}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const vj = await vr.json();
  for (const it of vj?.items || []) {
    const id = it.id;
    const snippet = it.snippet || {};
    const thumb = snippet?.thumbnails?.high?.url || snippet?.thumbnails?.standard?.url || snippet?.thumbnails?.default?.url;
    const caption = `${snippet?.title || ''}\n\n${snippet?.description || ''}`.trim();
    const durationISO = it?.contentDetails?.duration || 'PT0S';
    // parse ISO8601 duration
    const durSec = ((): number => {
      const m = durationISO.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (!m) return 0;
      const h = parseInt(m[1] || '0', 10), mm = parseInt(m[2] || '0', 10), s = parseInt(m[3] || '0', 10);
      return h * 3600 + mm * 60 + s;
    })();
    let vh: string | undefined;
    try { vh = await computeVisualHashFromUrl(thumb); } catch {}
    const captionNorm = normalizeCaption(caption);
    await upsertPostSignals('youtube', id, snippet?.publishedAt, { visualHash: vh, captionNorm, durationSec: durSec, thumbUrl: thumb });
    results.push({ externalPostId: id, thumbnailUrl: thumb, caption, durationSec: durSec, visualHash: vh, captionNorm, postedAt: snippet?.publishedAt });
  }
  return results;
}

function captionSimilarity(a: string, b: string): number {
  const { compareTwoStrings } = require('string-similarity');
  return compareTwoStrings(a || '', b || '');
}

function hamming(a?: string, b?: string): number {
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

export async function buildAndPostOnce(platform: Platform): Promise<any> {
  const Settings = await getSettingsModel();
  const settings = await Settings.findOne({});
  if (!settings) throw new Error('Missing settings');

  // Load last-30 from platform
  const last30 = platform === 'instagram' ? await fetchLast30Instagram(settings) : await fetchLast30YouTube(settings);
  const lastVisuals = last30.map(x => x.visualHash).filter(Boolean) as string[];
  const lastCaptions = last30.map(x => x.captionNorm || '');
  const lastDurations = last30.map(x => x.durationSec).filter((n: any) => typeof n === 'number') as number[];

  // Build candidates
  let candidates: any[] = [];
  if (platform === 'instagram') {
    const { scrapeInstagramEngagement } = require('../utils/instagramScraper');
    candidates = await scrapeInstagramEngagement(settings.igBusinessId, settings.instagramToken, 500);
    candidates = candidates.filter((v: any) => v.engagement >= 10000);
  } else {
    // no YouTube scrape; expect external candidates in future
    throw new Error('YouTube post-now candidates not implemented');
  }

  const { uploadUrlToS3 } = require('../utils/s3Uploader');
  const { postOnce } = require('./postOnce');

  // thresholds
  const VISUAL_MAX = Number(process.env.VISUAL_HASH_MAX_DISTANCE || 6);
  const CAPTION_MIN = 0.85;

  for (const v of candidates.sort((a, b) => b.engagement - a.engagement)) {
    // Compute candidate signals
    const thumb = v.thumbnailUrl || v.url;
    let vh: string | undefined;
    try { vh = await computeVisualHashFromUrl(thumb); } catch {}
    const audioKey = v.audioId || v.musicMetadata?.music_product_id || v.musicMetadata?.song_name || v.musicMetadata?.artist_name || undefined;
    const captionNorm = normalizeCaption(v.caption || '');
    const durationSec = typeof v.duration === 'number' ? Math.round(v.duration) : undefined;

    // Decision rule
    const visualClash = vh ? lastVisuals.some(p => hamming(vh, p) <= VISUAL_MAX) : false;
    const captionClash = lastCaptions.some(c => captionSimilarity(captionNorm, c) >= CAPTION_MIN);
    const durationNear = typeof durationSec === 'number' ? lastDurations.some(d => Math.abs(d - durationSec) <= 1) : false;
    const audioClash = !!audioKey && last30.some(x => x.audioKey && x.audioKey === audioKey);

    const block = visualClash || ((audioClash || captionClash) && durationNear);
    if (block) {
      continue;
    }

    // Upload to S3
    const key = `autopilot/manual/${Date.now()}_${Math.random().toString(36).slice(2,8)}.mp4`;
    const s3Url = await uploadUrlToS3(v.url, key, 'video/mp4');

    // Exactly-once posting using visual hash as videoHash component
    const scheduledAt = new Date();
    const result = await postOnce(platform, vh || key, scheduledAt, { videoUrl: s3Url, caption: v.caption || '', settings });
    return { success: true, result, s3Url, visualHash: vh };
  }

  return { success: false, error: 'No unique candidates found (last-30 rule)' };
}

module.exports = { buildAndPostOnce, normalizeCaption };


