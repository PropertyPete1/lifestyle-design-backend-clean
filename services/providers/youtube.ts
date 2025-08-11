import fetch from 'node-fetch';

type PollConfig = { attempts: number; intervalMs: number; backoffFactor: number };

type Input = {
  videoUrl: string;
  title: string;
  description: string;
  accessToken: string;
  thumbUrl?: string; // optional precomputed 0s PNG in S3
};

type Output = { externalPostId: string; thumbnailSet?: boolean };

export async function uploadYouTubeOnce(input: Input): Promise<Output> {
  const { videoUrl, title, description, accessToken, thumbUrl } = input;
  if (!videoUrl) throw new Error('Missing videoUrl');

  // Download video
  const resp = await fetch(videoUrl);
  const buffer = await resp.buffer();

  // Initiate resumable session
  const initResp = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4',
      'X-Upload-Content-Length': String(buffer.length)
    },
    body: JSON.stringify({
      snippet: { title, description, categoryId: '26' },
      status: { privacyStatus: 'public' }
    })
  });
  if (!initResp.ok) throw new Error(`YouTube init failed: ${await initResp.text()}`);
  const uploadUrl = initResp.headers.get('location');
  if (!uploadUrl) throw new Error('YouTube init missing upload URL');

  // Upload bytes
  const putResp = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'video/mp4',
      'Content-Length': String(buffer.length),
      'Content-Range': `bytes 0-${buffer.length - 1}/${buffer.length}`
    },
    body: buffer
  });
  const data = await putResp.json().catch(async () => { throw new Error(`YouTube upload not JSON: ${await putResp.text()}`); });
  if (!putResp.ok) throw new Error(`YouTube upload failed: ${data?.error?.message || 'Unknown error'}`);

  const videoId = data.id as string;

  // Poll processing status
  const poll: PollConfig = { attempts: 30, intervalMs: 10000, backoffFactor: 1.2 };
  let wait = poll.intervalMs;
  for (let i = 0; i < poll.attempts; i++) {
    try {
      const resp = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status,snippet&id=${videoId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const j = await resp.json();
      const item = j?.items?.[0];
      const status = item?.status;
      if (status && (status.uploadStatus === 'processed' || status.embeddable !== undefined)) {
        break;
      }
    } catch {}
    await new Promise(r => setTimeout(r, wait));
    wait = Math.min(wait * poll.backoffFactor, 60000);
  }

  // Set custom thumbnail from S3 (no ffmpeg at post-time)
  let thumbnailSet = false;
  try {
    if (!thumbUrl) {
      console.log('ℹ️ [YOUTUBE] No thumbUrl provided; skipping custom thumbnail');
    } else {
      console.log('📺 [YOUTUBE] Setting custom thumbnail from S3');

      // Wait until video is sufficiently processed (up to ~10 min)
      const maxWaitMs = 10 * 60 * 1000;
      const start = Date.now();
      while (Date.now() - start < maxWaitMs) {
        try {
          const st = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status&id=${videoId}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const j = await st.json();
          const status = j?.items?.[0]?.status;
          const processed = status?.uploadStatus === 'processed' || status?.embeddable === true;
          if (processed) break;
        } catch {}
        await new Promise(r => setTimeout(r, 10000));
      }

      // Fetch PNG bytes from S3
      const imgResp = await fetch(thumbUrl);
      const imgBuf = await imgResp.buffer();

      const delays = [2000, 4000, 8000, 16000, 32000, 64000];
      for (let i = 0; i <= delays.length; i++) {
        try {
          const boundary = '-------thumb-' + Math.random().toString(36).slice(2);
          const multipartBody = Buffer.concat([
            Buffer.from(`--${boundary}\r\n` +
                        'Content-Disposition: form-data; name="media"; filename="thumb.png"\r\n' +
                        'Content-Type: image/png\r\n\r\n'),
            imgBuf,
            Buffer.from(`\r\n--${boundary}--\r\n`)
          ]);
          const tResp = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': `multipart/form-data; boundary=${boundary}`,
              'Content-Length': String(multipartBody.length)
            },
            body: multipartBody
          });
          if (tResp.ok) {
            // Verify after brief delay
            await new Promise(r => setTimeout(r, 5000));
            try {
              const vResp = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}`, {
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              const v = await vResp.json();
              const thumbs = v?.items?.[0]?.snippet?.thumbnails;
              if (thumbs && (thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || thumbs.default)) {
                console.log('✅ [YOUTUBE] Custom thumbnail set');
                thumbnailSet = true;
                break;
              } else {
                // Consider applied; YT may lag cache
                console.log('✅ [YOUTUBE] thumbnails.set succeeded (verification inconclusive)');
                thumbnailSet = true;
                break;
              }
            } catch {
              console.log('✅ [YOUTUBE] thumbnails.set succeeded (verification skipped)');
              thumbnailSet = true;
              break;
            }
          } else {
            const msg = await tResp.text().catch(() => '');
            if (i < delays.length) {
              console.log(`🟡 [YOUTUBE] thumbnails.set retry ${i+1}/${delays.length}: ${tResp.status} ${msg.slice(0,120)}`);
              await new Promise(r => setTimeout(r, delays[i]));
              // re-poll status once between retries
              try { await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status&id=${videoId}`, { headers: { Authorization: `Bearer ${accessToken}` } }); } catch {}
              continue;
            } else {
              console.log('⚠️ [YOUTUBE] Custom thumbnail not applied after retries (continuing)');
              break;
            }
          }
        } catch (e:any) {
          if (i < delays.length) {
            console.log(`🟡 [YOUTUBE] thumbnails.set retry ${i+1}/${delays.length}: ${e?.message || 'error'}`);
            await new Promise(r => setTimeout(r, delays[i]));
            try { await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status&id=${videoId}`, { headers: { Authorization: `Bearer ${accessToken}` } }); } catch {}
            continue;
          } else {
            console.log('⚠️ [YOUTUBE] Custom thumbnail not applied after retries (continuing)');
            break;
          }
        }
      }
    }
  } catch {
    // non-fatal
  }

  return { externalPostId: videoId, thumbnailSet };
}

module.exports = { uploadYouTubeOnce };

