import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema({
  // Core post data
  platform: {
    type: String,
    enum: ['instagram', 'youtube', 'system'],
    required: true
  },
  videoId: {
    type: String,
    required: false  // Made optional for system events
  },
  thumbnailUrl: {
    type: String
  },
  caption: {
    type: String,
    required: false  // Made optional for system events
  },
  timestamp: {
    type: Date,
    default: Date.now,
    required: true
  },
  
  // Activity tracking fields
  type: {
    type: String,
    enum: ['post', 'error', 'protection', 'system', 'emergency_shutdown', 'schedule'],
    required: true
  },
  status: {
    type: String,
    enum: ['success', 'failed', 'pending', 'blocked'],
    required: true
  },
  
  // Content fingerprinting for duplicate detection
  fingerprint: {
    type: String,
    required: false
  },
  
  // Visual duplicate detection (Phase 9)
  contentHash: {
    type: String,
    required: false,
    index: true  // Index for fast visual similarity queries
  },
  
  // System messaging
  message: {
    type: String
  },
  error: {
    type: String
  },
  
  // Additional metadata for repost tracking
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  },

  // Scheduling field for queued posts (CRITICAL PHASE 1 FIX)
  scheduledAt: {
    type: Date,
    required: false
  }
}, {
  timestamps: true
});

const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);

export default ActivityLog;