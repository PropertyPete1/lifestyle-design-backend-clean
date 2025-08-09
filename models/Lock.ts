import mongoose, { Schema, Document, Model } from 'mongoose';

export interface LockDoc extends Document {
  key: string;
  expiresAt: Date;
  createdAt: Date;
}

const LockSchema = new Schema<LockDoc>({
  key: { type: String, required: true, unique: true, index: true },
  expiresAt: { type: Date, required: true, index: true },
  createdAt: { type: Date, default: Date.now }
}, { collection: 'PostingLocks' });

// TTL index: auto-delete when expired
LockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LockModel: Model<LockDoc> = (mongoose.models.PostingLocks as Model<LockDoc>) || mongoose.model<LockDoc>('PostingLocks', LockSchema);

module.exports = { LockModel };

