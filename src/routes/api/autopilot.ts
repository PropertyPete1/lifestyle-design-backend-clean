import express from 'express';
import { runAutoPilot, runAutoPilotBatch } from '../../controllers/autopilot.controller';

const router = express.Router();

// STEP 3: AutoPilot endpoints with cleanup
router.post('/run', runAutoPilot);           // Process single video from queue
router.post('/run-batch', runAutoPilotBatch); // Process multiple videos from queue

export default router;