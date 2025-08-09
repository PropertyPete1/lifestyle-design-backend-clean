import fetch from 'node-fetch';

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

  return { externalPostId: data.id as string };
}

module.exports = { uploadYouTubeOnce };

