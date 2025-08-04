const express = require('express');
const Settings = require('../models/settings.js');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    console.log('⚙️ [SETTINGS ROUTER] GET / request received');
    const settings = await Settings.findOne();
    console.log('⚙️ [SETTINGS ROUTER] Retrieved:', settings);
    res.json(settings || {});
  } catch (err) {
    console.error('❌ [SETTINGS ROUTER] GET error:', err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

router.post('/', async (req, res) => {
  try {
    console.log('⚙️ [SETTINGS ROUTER] POST / request received');
    console.log('⚙️ [SETTINGS ROUTER] Request body:', JSON.stringify(req.body, null, 2));
    
    const updated = await Settings.findOneAndUpdate({}, req.body, {
      upsert: true,
      new: true,
    });
    console.log('⚙️ [SETTINGS ROUTER] Settings saved successfully:', updated);
    res.json(updated);
  } catch (err) {
    console.error('❌ [SETTINGS ROUTER] POST error:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

module.exports = router;