import { Router } from 'express';
import { scrapeZillowDuckDuckGo } from '../services/zillowScraper';
import { ZillowSettingsModel } from '../models/settingsModel';
import { ZillowListingModel } from '../models/zillowListing';

const router = Router();

router.post('/run', async (req, res) => {
  try {
    const { propertyType, zipCodes } = req.body || {};
    const s = await ZillowSettingsModel.findOne();
    const input = {
      propertyType: propertyType || s?.propertyType || 'both',
      zipCodes: Array.isArray(zipCodes) && zipCodes.length ? zipCodes : s?.zipCodes || [],
      redFlagDetection: s?.redFlagDetection !== false,
    } as const;
    const listings = await scrapeZillowDuckDuckGo(input);
    res.json({ count: listings.length, listings });
  } catch (err: any) {
    res.status(500).json({ error: 'Scraper failed', message: err?.message || 'unknown' });
  }
});

export default router;

// List recent scraped listings
router.get('/listings', async (req, res) => {
  try {
    const { propertyType } = req.query as { propertyType?: string };
    const match: any = {};
    if (propertyType && propertyType !== 'both') match.type = propertyType;
    const listings = await ZillowListingModel.find(match).sort({ createdAt: -1 }).limit(100);
    res.json({ count: listings.length, listings });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list scraped listings', message: err?.message || 'unknown' });
  }
});


