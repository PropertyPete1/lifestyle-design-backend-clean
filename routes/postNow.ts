import { Router } from 'express';
import mongoose from 'mongoose';
import { postOnce } from '../services/postOnce';
import { buildIdempotencyKey } from '../lib/idempotency';

const router = Router();

router.post('/post-now', async (req, res) => {
  try {
    const SettingsModel = mongoose.model('SettingsClean');
    const settings = await SettingsModel.findOne({});
    const { platform, videoHash, videoUrl, caption } = req.body || {};
    if (!platform || !videoHash || !videoUrl) return res.status(400).json({ error: 'platform, videoHash, videoUrl required' });

    const scheduledAt = new Date();
    const result = await postOnce(platform, videoHash, scheduledAt, { videoUrl, caption, settings });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Post-now failed' });
  }
});

module.exports = router;


