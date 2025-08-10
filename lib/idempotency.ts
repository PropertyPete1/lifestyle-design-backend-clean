import crypto from 'crypto';

export function formatMinuteKey(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}${mi}`;
}

export function sha1Short(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 8);
}

export function buildIdempotencyKey(platform: 'instagram' | 'youtube', videoHash: string, scheduledAt: Date): string {
  const minuteKey = formatMinuteKey(scheduledAt);
  const v = sha1Short(videoHash);
  return `${platform}:${minuteKey}:${v}`;
}

module.exports = { buildIdempotencyKey, formatMinuteKey, sha1Short };


