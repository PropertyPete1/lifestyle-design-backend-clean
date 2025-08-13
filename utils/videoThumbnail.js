const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
// Remove sharp dependency; return raw screenshot file buffer

ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Generate a JPEG thumbnail from a remote video URL and return a Buffer
 * @param {string} videoUrl - Remote URL (S3/http)
 * @param {number} timestampSeconds - When to capture (defaults 0.0 for first frame)
 */
async function generateThumbnailBuffer(videoUrl, timestampSeconds = 0.0) {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'thumb-'));
  const output = path.join(tmpDir, 'thumb.jpg');
  await new Promise((resolve, reject) => {
    ffmpeg(videoUrl)
      .on('end', resolve)
      .on('error', reject)
      .screenshots({ count: 1, timemarks: [String(timestampSeconds)], filename: 'thumb.jpg', folder: tmpDir, size: '720x?' });
  });
  const buf = await fs.promises.readFile(output);
  try { await fs.promises.unlink(output); } catch (_) {}
  try { await fs.promises.rmdir(tmpDir, { recursive: true }); } catch (_) {}
  return buf;
}

module.exports = { generateThumbnailBuffer };

