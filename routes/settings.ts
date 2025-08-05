// ✅ SETTINGS ROUTE - SAVE & LOAD FULL SETTINGS FROM MONGODB WITH AUTOPILOT TRIGGER

import express from 'express';
import Settings from '../models/Settings';
import fetch from 'node-fetch';

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

// POST settings - Enhanced with AutoPilot trigger
router.post('/', async (req, res) => {
  try {
    const data = req.body;
    let settings = await Settings.findOne({});
    const wasAutopilotEnabled = settings?.autopilotEnabled || false;
    
    if (settings) {
      Object.assign(settings, data);
    } else {
      settings = new Settings(data);
    }
    
    await settings.save();
    console.log('✅ [SETTINGS] Settings saved successfully');

    // Check if autopilot was just enabled
    const isNowEnabled = data.autopilotEnabled === true;
    const justEnabled = !wasAutopilotEnabled && isNowEnabled;

    if (justEnabled) {
      console.log('🚀 [SETTINGS] AutoPilot enabled - triggering Phase 9 system...');
      
      // Trigger Phase 9 system in background (don't wait for response)
      setTimeout(async () => {
        try {
          const baseUrl = process.env.NODE_ENV === 'production' 
            ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'lifestyle-design-backend-v2.onrender.com'}`
            : `http://localhost:${process.env.PORT || 3002}`;
            
          const response = await fetch(`${baseUrl}/api/autopilot/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          
          const result = await response.json();
          console.log('🎯 [SETTINGS] Phase 9 triggered:', result.success ? 'SUCCESS' : 'FAILED');
          
        } catch (triggerError) {
          console.error('❌ [SETTINGS] Failed to trigger Phase 9:', triggerError);
        }
      }, 1000); // 1 second delay to ensure settings are saved
    }

    res.json({ 
      success: true, 
      autopilotTriggered: justEnabled,
      message: justEnabled ? 'Settings saved and AutoPilot triggered' : 'Settings saved'
    });
    
  } catch (err) {
    console.error('❌ Error saving settings:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

export default router;