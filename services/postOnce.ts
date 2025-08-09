import mongoose from 'mongoose';
import { buildIdempotencyKey } from '../lib/idempotency';
import { acquireLock, releaseLock } from '../lib/lock';
import { PostModel } from '../models/Post';
import { incrementDailyCounter } from './limits';

type Platform = 'instagram' | 'youtube';

type PostOnceResult = { success?: boolean; deduped?: boolean; externalPostId?: string; note?: string };

export async function postOnce(
  platform: Platform,
  videoHash: string,
  scheduledAt: Date,
  payload: { caption?: string; videoUrl: string; title?: string; description?: string; settings: any }
): Promise<PostOnceResult> {
  const idempotencyKey = buildIdempotencyKey(platform, videoHash, scheduledAt);
  const lockKey = `post:${idempotencyKey}`;

  // 1) Lock
  const gotLock = await acquireLock(lockKey);
  if (!gotLock) {
    console.log(`🔒 [POST-ONCE] Locked duplicate: ${idempotencyKey}`);
    return { deduped: true, note: 'locked-already-posting' };
  }

  try {
    // 2) Upsert Post record; if already posted, short-circuit
    const now = new Date();
    const pre = await PostModel.findOne({ idempotencyKey }).lean();
    if (pre?.status === 'posted' && pre?.externalPostId) {
      console.log(`🧠 [POST-ONCE] Existing success found: ${idempotencyKey} → ${pre.externalPostId}`);
      return { deduped: true, externalPostId: pre.externalPostId };
    }

    await PostModel.updateOne(
      { idempotencyKey },
      {
        $setOnInsert: {
          platform,
          videoHash,
          scheduledAt,
        },
        $set: {
          status: 'posting',
          payloadSummary: {
            videoUrl: payload.videoUrl,
            captionPreview: (payload.caption || payload.description || '').slice(0, 160)
          }
        }
      },
      { upsert: true }
    );

    // If someone else inserted posted state just now, re-read
    const current = await PostModel.findOne({ idempotencyKey });
    if (!current) throw new Error('Post record not found after upsert');
    if (current.status === 'posted' && current.externalPostId) {
      console.log(`🧠 [POST-ONCE] Race: another worker posted: ${current.externalPostId}`);
      return { deduped: true, externalPostId: current.externalPostId };
    }

    // 3) Provider call (no internal retries)
    let externalPostId: string | undefined;
    if (platform === 'instagram') {
      const { publishInstagramOnce } = require('./providers/instagram');
      const settings = payload.settings;
      const out = await publishInstagramOnce({
        videoUrl: payload.videoUrl,
        caption: payload.caption || '',
        igBusinessId: settings.igBusinessId,
        accessToken: settings.instagramToken
      });
      externalPostId = out.externalPostId;
    } else if (platform === 'youtube') {
      const { uploadYouTubeOnce } = require('./providers/youtube');
      const settings = payload.settings;
      // Ensure we have a valid token (assumes caller refreshed token)
      const accessToken = settings.youtubeAccessToken;
      const out = await uploadYouTubeOnce({
        videoUrl: payload.videoUrl,
        title: payload.title || 'New Homes',
        description: payload.description || (payload.caption || ''),
        accessToken
      });
      externalPostId = out.externalPostId;
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    if (!externalPostId) throw new Error('Provider returned empty externalPostId');

    // 4) Finalize
    await PostModel.updateOne(
      { idempotencyKey },
      { $set: { status: 'posted', externalPostId, scheduledAt } }
    );

    // 5) Daily counter
    await incrementDailyCounter(platform);

    console.log(`✅ [POST-ONCE] Posted ${platform}: ${externalPostId}`);
    return { success: true, externalPostId };
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error('❌ [POST-ONCE] Error:', msg);
    await PostModel.updateOne({ idempotencyKey }, { $set: { status: 'failed', error: msg } });
    return { success: false, note: msg };
  } finally {
    // 6) Release lock
    await releaseLock(lockKey);
  }
}

module.exports = { postOnce };

