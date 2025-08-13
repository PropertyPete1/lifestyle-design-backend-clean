const fetch = require('node-fetch');
const sharp = require('sharp');

function hexToBitString(hex) {
  return hex.split('').map((c) => parseInt(c, 16).toString(2).padStart(4, '0')).join('');
}

function bitStringToHex(bits) {
  let out = '';
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = bits.slice(i, i + 4);
    out += parseInt(nibble, 2).toString(16);
  }
  return out;
}

function hammingDistanceHex(a, b) {
  if (!a || !b) return Number.MAX_SAFE_INTEGER;
  const aBits = hexToBitString(String(a));
  const bBits = hexToBitString(String(b));
  const len = Math.min(aBits.length, bBits.length);
  let d = 0;
  for (let i = 0; i < len; i++) if (aBits[i] !== bBits[i]) d++;
  d += Math.abs(aBits.length - bBits.length);
  return d;
}

async function computeAverageHashFromImageUrl(url, size = 8) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image fetch failed: ${res.status}`);
  const buf = await res.buffer();
  const img = await sharp(buf).resize(size, size).grayscale().raw().toBuffer();
  const pixels = Array.from(img);
  const avg = pixels.reduce((a, v) => a + v, 0) / pixels.length;
  const bits = pixels.map((v) => (v >= avg ? '1' : '0')).join('');
  const hex = bitStringToHex(bits);
  return { hash: hex, bits: bits.length, version: `ahash-${size}x${size}-v1` };
}

module.exports = { hammingDistanceHex, computeAverageHashFromImageUrl };
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

