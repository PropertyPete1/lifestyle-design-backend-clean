import express from 'express';
import autopostRouter from './api/autopost';
import schedulerRouter from './api/scheduler';
import autopilotRouter from './api/autopilot';

const router = express.Router();

// Health check endpoint
router.get('/health', (req: express.Request, res: express.Response) => {
  res.json({
    status: 'ok',
    service: 'backend-v2',
    timestamp: new Date().toISOString()
  });
});

// PHASE 1 CRITICAL ROUTES
router.use('/autopost', autopostRouter);  // /api/autopost/run-now
router.use('/scheduler', schedulerRouter); // /api/scheduler/status

// STEP 3: AUTOPILOT ROUTES WITH CLEANUP
router.use('/autopilot', autopilotRouter); // /api/autopilot/run, /api/autopilot/run-batch

export default router;