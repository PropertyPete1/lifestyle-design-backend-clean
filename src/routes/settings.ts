import { Router } from 'express';
import { ZillowSettingsModel } from '../models/settingsModel';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const s = await ZillowSettingsModel.findOne();
    if (!s) return res.json({});
    res.json(s);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

router.post('/', async (req, res) => {
  try {
    const incoming = req.body || {};
    let s = await ZillowSettingsModel.findOne();
    if (s) Object.assign(s, incoming);
    else s = new ZillowSettingsModel(incoming);
    await s.save();
    res.json({ message: 'Settings saved', settings: s });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

export default router;


