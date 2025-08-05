// ✅ SETTINGS ROUTE - SAVE & LOAD FULL SETTINGS FROM MONGODB

import express from 'express';
import Settings from '../models/Settings';

const router = express.Router();

// GET settings
router.get('/', async (req, res) => {
  try {
    const settings = await Settings.findOne({});
    console.log('✅ [SETTINGS] Loaded from MongoDB:', settings ? 'Found' : 'Empty');
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
    console.log('📝 [SETTINGS] Saving to MongoDB:', Object.keys(data));
    
    let settings = await Settings.findOne({});
    if (settings) {
      Object.assign(settings, data);
      console.log('✅ [SETTINGS] Updated existing settings');
    } else {
      settings = new Settings(data);
      console.log('✅ [SETTINGS] Created new settings');
    }
    
    await settings.save();
    console.log('💾 [SETTINGS] Successfully saved to MongoDB');
    res.json({ success: true, settings });
  } catch (err) {
    console.error('❌ Error saving settings:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

export default router;