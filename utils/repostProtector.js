// 🛡️ utils/repostProtector.js
const mongoose = require('mongoose');

// RecentPosts Model for Post Now duplicate prevention
const recentPostsSchema = new mongoose.Schema({
  thumbnailHash: String,
  postedAt: { type: Date, default: Date.now }
}, { timestamps: true, collection: 'RecentPosts' });

const RecentPostsModel = mongoose.model('RecentPosts', recentPostsSchema);

// ✅ Gets the 30 most recent posts by date
async function getLast30ThumbnailHashes() {
  const recent = await RecentPostsModel.find({})
    .sort({ postedAt: -1 }) // 👈 sort by most recent
    .limit(30)
    .select("thumbnailHash");

  return recent.map((post) => post.thumbnailHash);
}

async function logPostedHash(hash) {
  await RecentPostsModel.create({
    thumbnailHash: hash,
    postedAt: new Date()
  });
}

module.exports = {
  getLast30ThumbnailHashes,
  logPostedHash
};