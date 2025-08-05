import express from 'express';
import { runAutoPilot, runAutoPilotBatch, getAutoPilotStatus, getAutoPilotQueue, runPhase9System } from '../../controllers/autopilot.controller';

const router = express.Router();

// PHASE 9: Main AutoPilot endpoints
router.post('/run', runPhase9System);        // NEW: Phase 9 Instagram repost system
router.get('/status', getAutoPilotStatus);   // NEW: Get autopilot status for frontend
router.get('/queue', getAutoPilotQueue);     // NEW: Get queued videos for dashboard

// LEGACY: Original endpoints (keeping for backward compatibility)
router.post('/run-legacy', runAutoPilot);           // Process single video from queue
router.post('/run-batch', runAutoPilotBatch);       // Process multiple videos from queue

export default router;