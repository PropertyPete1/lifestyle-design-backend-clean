import { Router } from 'express';
import { ZillowSettingsModel } from '../models/settingsModel';
import { sendMessageToListing } from '../services/zillowMessenger';
import { MessageLogModel } from '../models/messageLog';
import { appendLogsToSheet } from '../services/googleSheets';
import { ZillowListingModel } from '../models/zillowListing';

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
    const { propertyType, maxMessages = 10, listings = [] } = req.body || {};
    const s = await ZillowSettingsModel.findOne();

    const windowStart = (s?.messageWindow?.[0] || '10:00');
    const windowEnd = (s?.messageWindow?.[1] || '18:00');
    const withinWindow = () => {
      const now = new Date();
      const [sh, sm] = windowStart.split(':').map(Number);
      const [eh, em] = windowEnd.split(':').map(Number);
      const start = new Date(now); start.setHours(sh, sm || 0, 0, 0);
      const end = new Date(now); end.setHours(eh, em || 0, 0, 0);
      return now >= start && now <= end;
    };

    // Enforce window and daily limit (count logs today)
    if (!withinWindow()) {
      return res.status(429).json({ error: 'Outside message window', window: s?.messageWindow || ['10:00','18:00'] });
    }
    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
    const sentToday = await MessageLogModel.countDocuments({ status: 'sent', createdAt: { $gte: startOfDay } });
    const remaining = Math.max(0, (s?.dailyMessageLimit ?? 10) - sentToday);
    if (remaining <= 0) {
      return res.status(429).json({ error: 'Daily message limit reached' });
    }

    let toSend: any[] = listings as any[];
    if (!toSend || toSend.length === 0) {
      const match: any = { flagged: { $ne: true } };
      if (propertyType && propertyType !== 'both') match.type = propertyType;
      const recent = await ZillowListingModel.find(match).sort({ createdAt: -1 }).limit(maxMessages);
      toSend = recent.map(r => ({ address: r.address, link: r.link, ownerName: r.ownerName, type: r.type }));
    }

    toSend = toSend
      .filter(l => (propertyType === 'both' || !propertyType) ? true : l.type === propertyType)
      .slice(0, Math.min(remaining, maxMessages));

    const results: any[] = [];
    for (const l of toSend) {
      const r = await sendMessageToListing(l, { testMode: s?.testMode, zillowLogin: s?.zillowLogin });
      const status = r.success ? 'sent' : 'failed';
      const log = await MessageLogModel.create({ address: l.address, link: l.link, ownerName: l.ownerName, type: l.type, status, reason: r.reason, sentAt: r.success ? new Date() : undefined });
      results.push({ address: l.address, status, type: l.type, reason: r.reason });
      // brief delay between sends to reduce flags
      await new Promise(res => setTimeout(res, 800));
    }

    // Append to Google Sheets if configured
    try {
      if (s?.googleSheetUrl) {
        const rows = results.map(r => ({ Address: r.address, Owner: '', Price: '', Bedrooms: '', Type: r.type, Status: r.status, Timestamp: new Date().toISOString(), Reason: r.reason }));
        await appendLogsToSheet(s.googleSheetUrl, rows);
      }
    } catch {}

    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: 'Batch failed', message: err?.message || 'unknown' });
  }
});

export default router;


