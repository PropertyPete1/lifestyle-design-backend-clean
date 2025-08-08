import { Router } from 'express';
import { MessageLogModel } from '../models/messageLog';
import { appendLogsToSheet } from '../services/googleSheets';
import { ZillowSettingsModel } from '../models/settingsModel';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 1000);
    const logs = await MessageLogModel.find({}).sort({ createdAt: -1 }).limit(limit);
    res.json({ count: logs.length, logs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load logs' });
  }
});

router.post('/export-to-sheets', async (_req, res) => {
  try {
    const s = await ZillowSettingsModel.findOne();
    if (!s?.googleSheetUrl) return res.status(400).json({ error: 'Google Sheet URL not configured' });
    const logs = await MessageLogModel.find({}).sort({ createdAt: -1 }).limit(200);
    const rows = logs.map(l => ({
      Address: l.address,
      Owner: l.ownerName,
      Price: '',
      Bedrooms: '',
      Type: l.type,
      Status: l.status,
      Timestamp: (l.sentAt || l.createdAt).toISOString(),
      Reason: l.reason,
    }));
    const result = await appendLogsToSheet(s.googleSheetUrl, rows);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export logs' });
  }
});

export default router;


