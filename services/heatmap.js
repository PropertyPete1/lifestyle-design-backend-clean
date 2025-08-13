/* services/heatmap.js */
function computeWeeklyHeatmap() {
  const matrix = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const meta = { tz: 'America/Chicago', scale: '0-100', updatedAt: new Date().toISOString() };
  const topSlots = [
    { dow: 1, hour: 17, score: 60 },
    { dow: 3, hour: 19, score: 65 },
    { dow: 5, hour: 20, score: 70 },
  ];
  return { matrix, meta, topSlots };
}

function computeOptimalTimes(limitPerPlatform = 5) {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17, 0, 0);
  const make = (n) => new Date(base.getTime() + n * 60 * 60 * 1000).toISOString();
  const slotsCT = [0,1,2,3,4].map(make);
  return {
    slotsCT,
    byPlatform: {
      instagram: slotsCT.slice(0, limitPerPlatform),
      youtube:   slotsCT.slice(0, limitPerPlatform),
    },
    meta: { tz: 'America/Chicago', fallback: true, updatedAt: new Date().toISOString() }
  };
}

module.exports = { computeWeeklyHeatmap, computeOptimalTimes };



