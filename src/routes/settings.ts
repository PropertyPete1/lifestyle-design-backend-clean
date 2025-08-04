import express from 'express';
import Settings from '../models/settings';
const router = express.Router();

router.get('/api/settings', async (req, res) => {
  const data = await Settings.findOne().sort({ updatedAt: -1 }).lean();
  res.json(data || {});
});

router.post('/api/settings', async (req, res) => {
  await Settings.deleteMany(); // clear existing to avoid confusion
  const newSettings = new Settings(req.body);
  await newSettings.save();
  res.json({ success: true });
});

export default router;