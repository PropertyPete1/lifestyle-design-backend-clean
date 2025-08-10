import fetch from 'node-fetch';

type PollConfig = { attempts: number; intervalMs: number; backoffFactor: number };

type Input = {
  videoUrl: string;
  title: string;
  description: string;
  accessToken: string;
};

type Output = { externalPostId: string };

export async function uploadYouTubeOnce(input: Input): Promise<Output> {
  const { videoUrl, title, description, accessToken } = input;
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

  // Generate and set first-frame PNG thumbnail
  try {
    const { generateThumbnailBuffer } = require('../../utils/videoThumbnail');
    const thumbBuffer: Buffer = await generateThumbnailBuffer(videoUrl, 0.0);

    // Retry thumbnails.set with exponential backoff
    let ok = false;
    let delay = 2000;
    for (let attempt = 0; attempt < 6 && !ok; attempt++) {
      try {
        const boundary = '-------thumb-' + Math.random().toString(36).slice(2);
        const multipartBody = Buffer.concat([
          Buffer.from(`--${boundary}\r\n` +
                      'Content-Disposition: form-data; name="media"; filename="thumb.png"\r\n' +
                      'Content-Type: image/png\r\n\r\n'),
          thumbBuffer,
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
          // Verify thumbnail updated
          const vResp = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const v = await vResp.json();
          const thumbs = v?.items?.[0]?.snippet?.thumbnails;
          if (thumbs && (thumbs.maxres || thumbs.standard || thumbs.high)) {
            ok = true;
            break;
          }
        }
      } catch {}
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  } catch {}

  return { externalPostId: videoId };
}

module.exports = { uploadYouTubeOnce };

