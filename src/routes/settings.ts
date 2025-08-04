import express from 'express';
import mongoose from 'mongoose';

const router = express.Router();

const SettingsSchema = new mongoose.Schema({
  instagramToken: String,
  igBusinessId: String,
  facebookPageId: String,
  youtubeToken: String,
  youtubeRefreshToken: String,
  youtubeChannelId: String,
  youtubeClientId: String,
  youtubeClientSecret: String,
  dropboxToken: String,
  mongoURI: String,
  runwayApiKey: String,
  openaiApiKey: String,
  s3AccessKey: String,
  s3SecretAccessKey: String,
  s3BucketName: String,
  s3Region: String,
}, { timestamps: true });

const SettingsModel = mongoose.model('Settings', SettingsSchema);

router.get('/settings', async (_req, res) => {
  try {
    const settings = await SettingsModel.findOne();
    if (!settings) return res.status(404).json({ message: 'No settings found' });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load settings', error: err });
  }
});

router.post('/settings', async (req, res) => {
  try {
    const existing = await SettingsModel.findOne();
    if (existing) {
      await SettingsModel.updateOne({}, req.body);
    } else {
      await SettingsModel.create(req.body);
    }
    res.status(200).json({ message: '✅ Settings saved!' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to save settings', error: err });
  }
});

export default router;