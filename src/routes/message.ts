import { Router } from 'express';
import { ZillowSettingsModel } from '../models/settingsModel';
import { sendMessageToListing } from '../services/zillowMessenger';

const router = Router();

router.post('/send', async (req, res) => {
  try {
    const { listing } = req.body || {};
    if (!listing?.link || !listing?.address || !listing?.type) {
      return res.status(400).json({ error: 'Invalid listing payload' });
    }
    const s = await ZillowSettingsModel.findOne();
    const result = await sendMessageToListing(listing, {
      testMode: s?.testMode,
      zillowLogin: s?.zillowLogin,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: 'Send failed', message: err?.message || 'unknown' });
  }
});

router.post('/send-batch', async (req, res) => {
  try {
    const { propertyType, maxMessages = 10 } = req.body || {};
    const s = await ZillowSettingsModel.findOne();
    // For MVP: rely on frontend-provided listings soon; here we just echo contract
    // Real implementation would pull recent scraped listings from cache/DB
    const results: any[] = [];
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: 'Batch failed', message: err?.message || 'unknown' });
  }
});

export default router;


