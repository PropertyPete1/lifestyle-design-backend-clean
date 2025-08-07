const sharp = require('sharp');
const fetch = require('node-fetch');

/**
 * Compute a simple 8x8 average hash (aHash) for an image URL
 * Returns a 64-bit binary string (e.g., '0101...')
 */
async function computeAverageHashFromImageUrl(imageUrl) {
  if (!imageUrl) throw new Error('Missing image URL');
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const buf = await response.buffer();

  const image = await sharp(buf)
    .resize(8, 8, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer();

  // Compute average brightness
  let sum = 0;
  for (let i = 0; i < image.length; i++) sum += image[i];
  const avg = sum / image.length;

  // Convert to 64-bit hash based on average
  let bits = '';
  for (let i = 0; i < image.length; i++) {
    bits += image[i] >= avg ? '1' : '0';
  }
  return bits; // 64 bits
}

/**
 * Compute Hamming distance between two equal-length binary strings
 */
function hammingDistance(hashA, hashB) {
  if (!hashA || !hashB || hashA.length !== hashB.length) return Infinity;
  let dist = 0;
  for (let i = 0; i < hashA.length; i++) {
    if (hashA[i] !== hashB[i]) dist++;
  }
  return dist;
}

module.exports = {
  computeAverageHashFromImageUrl,
  hammingDistance,
};

