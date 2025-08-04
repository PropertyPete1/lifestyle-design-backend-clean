import express from 'express';
import { getSchedulerStatus } from '../../controllers/autopost.dashboard';

const router = express.Router();

// GET /api/scheduler/status - PHASE 1 FIX: Show queued posts correctly
router.get('/status', getSchedulerStatus);

export default router;