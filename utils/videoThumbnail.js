const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const sharp = require('sharp');

ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Generate a JPEG thumbnail from a remote video URL and return a Buffer
 * - Captures at 0.5s to avoid black frames
 */
async function generateThumbnailBuffer(videoUrl) {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'thumb-'));
  const output = path.join(tmpDir, 'thumb.jpg');
  await new Promise((resolve, reject) => {
    ffmpeg(videoUrl)
      .on('end', resolve)
      .on('error', reject)
      .screenshots({ count: 1, timemarks: ['0.5'], filename: 'thumb.jpg', folder: tmpDir, size: '720x?' });
  });
  const buf = await sharp(output).jpeg({ quality: 85 }).toBuffer();
  try { await fs.promises.unlink(output); } catch (_) {}
  try { await fs.promises.rmdir(tmpDir, { recursive: true }); } catch (_) {}
  return buf;
}

module.exports = { generateThumbnailBuffer };

