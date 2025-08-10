import fetch from 'node-fetch';

type Input = {
  videoUrl: string;
  caption: string;
  igBusinessId: string;
  accessToken: string;
};

type Output = { externalPostId: string };

export async function publishInstagramOnce(input: Input): Promise<Output> {
  const { videoUrl, caption, igBusinessId, accessToken } = input;
  if (!videoUrl) throw new Error('Missing videoUrl');

  // Create container
  const params = new URLSearchParams({
    media_type: 'REELS',
    video_url: videoUrl,
    caption: caption || 'Posted via AutoPilot',
    access_token: accessToken,
    share_to_feed: 'true'
  });

  const containerResp = await fetch(`https://graph.facebook.com/v18.0/${igBusinessId}/media`, {
    method: 'POST',
    body: params
  });
  const containerData = await containerResp.json();
  if (!containerResp.ok) throw new Error(containerData?.error?.message || 'IG container create failed');
  const creationId = containerData.id as string;

  // Poll for readiness (lightweight)
  const maxAttempts = 12;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 10_000));
    const statusResp = await fetch(`https://graph.facebook.com/v18.0/${creationId}?fields=status_code&access_token=${accessToken}`);
    const status = await statusResp.json();
    const code = (status?.status_code || '').toString().toUpperCase();
    if (code === 'FINISHED') break;
    if (code === 'ERROR') throw new Error('IG media processing error');
  }

  // Publish
  const publishParams = new URLSearchParams({ creation_id: creationId, access_token: accessToken });
  const publishResp = await fetch(`https://graph.facebook.com/v18.0/${igBusinessId}/media_publish`, {
    method: 'POST',
    body: publishParams
  });
  const publishData = await publishResp.json();
  if (!publishResp.ok) throw new Error(publishData?.error?.message || 'IG publish failed');

  return { externalPostId: publishData.id as string };
}

module.exports = { publishInstagramOnce };


