/* services/candidateBuilder.js */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Build candidates from scraped videos, applying "last 30 most recent posts"
 * dedupe by visualHash. We consider the most recent 30 posts already made and
 * skip any new video whose visualHash matches one of those.
 *
 * @param {Object[]} scrapedVideos - array from IG scraper (ideally includes .thumbnailUrl/.thumbUrl and .engagement)
 * @param {Object[]} recentPosts   - last 30 most recent posts already made (should include .visualHash)
 * @param {Object}   options       - { maxCount?: number }
 * @returns {Object[]} candidates  - candidate list sorted by engagement desc
 */
function buildCandidates(scrapedVideos = [], recentPosts = [], options = {}) {
  const maxCount = options.maxCount || 20;

  // Recent visual hashes set (from the most recent N posts)
  const recentHashes = new Set(
    (recentPosts || [])
      .map(p => (p && (p.visualHash || p.thumbnailHash || p.thumbHash)) || null)
      .filter(Boolean)
  );

  // Attach visualHash if upstream provided it; otherwise pass through and allow posting code to compute/store it.
  const enriched = scrapedVideos
    .map(v => {
      const visualHash = v.visualHash || v.thumbnailHash || v.thumbHash || null;
      return { ...v, visualHash };
    })
    // dedupe: skip if hash matches a recent post hash
    .filter(v => !v.visualHash || !recentHashes.has(v.visualHash))
    // prefer higher engagement
    .sort((a, b) => (b.engagement || 0) - (a.engagement || 0));

  // Cap to requested max
  return enriched.slice(0, maxCount);
}

// Simple caption normalizer used by other services
function normalizeCaption(s) {
  return String(s || '').toLowerCase().trim();
}

module.exports = { buildCandidates, normalizeCaption };



