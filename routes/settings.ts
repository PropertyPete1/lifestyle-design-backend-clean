// ✅ SETTINGS ROUTE - SAVE & LOAD FULL SETTINGS FROM MONGODB

import express from 'express';
import Settings from '../models/Settings';

const router = express.Router();

// GET settings
router.get('/', async (req, res) => {
  try {
    const settings = await Settings.findOne({});
    res.json(settings || {});
  } catch (err) {
    console.error('❌ Error loading settings:', err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// POST settings
router.post('/', async (req, res) => {
  try {
    const data = req.body;
    let settings = await Settings.findOne({});
    if (settings) {
      Object.assign(settings, data);
    } else {
      settings = new Settings(data);
    }
    await settings.save();
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error saving settings:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

export default router;