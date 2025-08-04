import express from 'express';
import { runNowToQueue } from '../../controllers/autopost.dashboard';

const router = express.Router();

// POST /api/autopost/run-now - PHASE 1 FIX: Queue instead of post immediately
router.post('/run-now', runNowToQueue);

export default router;