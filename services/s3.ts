import AWS from 'aws-sdk';

function parseS3Url(url: string): { bucket: string; key: string } | null {
  try {
    const u = new URL(url);
    // Virtual-hosted–style: https://bucket.s3.amazonaws.com/key or https://bucket.s3.<region>.amazonaws.com/key
    const host = u.hostname;
    const hostParts = host.split('.');
    const isS3 = hostParts.includes('s3');
    if (isS3 && hostParts.length >= 3) {
      const bucket = hostParts[0];
      const key = decodeURIComponent(u.pathname.replace(/^\//, ''));
      if (bucket && key) return { bucket, key };
    }
    // Path-style: https://s3.amazonaws.com/bucket/key or https://s3.<region>.amazonaws.com/bucket/key
    if (isS3) {
      const [, bucket, ...rest] = u.pathname.split('/');
      const key = decodeURIComponent(rest.join('/'));
      if (bucket && key) return { bucket, key };
    }
  } catch (_) {}
  return null;
}

export async function checkS3Object(url: string): Promise<boolean> {
  try {
    const parsed = parseS3Url(url);
    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
    const s3 = new AWS.S3({ region });
    if (parsed) {
      await s3.headObject({ Bucket: parsed.bucket, Key: parsed.key }).promise();
      return true;
    }
    // Fallback: use environment bucket name
    const bucket = process.env.BUCKET_NAME || process.env.S3_BUCKET || process.env.AWS_S3_BUCKET;
    if (!bucket) return false;
    const key = decodeURIComponent(url.split('.amazonaws.com/')[1] || '');
    if (!key) return false;
    await s3.headObject({ Bucket: bucket, Key: key }).promise();
    return true;
  } catch {
    return false;
  }
}

module.exports = { checkS3Object };

