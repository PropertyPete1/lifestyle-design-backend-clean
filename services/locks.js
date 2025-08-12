const mongoose = require('mongoose');

let LockModel;
try {
  LockModel = mongoose.model('PostingLocks');
} catch (_) {
  const schema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, index: true },
    holder: { type: String, required: true },
    acquiredAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
  }, { collection: 'PostingLocks' });
  try { schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); } catch {}
  LockModel = mongoose.model('PostingLocks', schema);
}

function getInstanceId() {
  return process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || `proc-${process.pid}`;
}

async function acquireLock(key, ttlSec = 55) {
  const now = new Date();
  const holder = getInstanceId();
  const expiresAt = new Date(now.getTime() + ttlSec * 1000);
  const res = await LockModel.findOneAndUpdate(
    { key, $or: [{ expiresAt: { $lte: now } }, { expiresAt: { $exists: false } }] },
    { $set: { key, holder, acquiredAt: now, expiresAt } },
    { upsert: true, new: true }
  ).lean();
  if (res && res.holder === holder) return { ok: true, holder, expiresAt };
  const cur = await LockModel.findOne({ key }).lean();
  if (cur && cur.holder === holder) return { ok: true, holder: cur.holder, expiresAt: cur.expiresAt };
  return { ok: false, holder: cur?.holder, expiresAt: cur?.expiresAt };
}

async function releaseLock(key) {
  await LockModel.deleteOne({ key });
}

module.exports = { acquireLock, releaseLock, getInstanceId };


