import mongoose, { Schema, Document, Model } from 'mongoose';

export type SupportedPlatform = 'instagram' | 'youtube';

export interface PostDoc extends Document {
  idempotencyKey: string;
  platform: SupportedPlatform;
  videoHash: string;
  scheduledAt: Date;
  status: 'posting' | 'posted' | 'failed';
  externalPostId?: string;
  error?: string;
  payloadSummary?: {
    videoUrl?: string;
    captionPreview?: string;
  };
  // New dedupe/metadata fields
  postedAt?: Date;
  visualHash?: string;      // aHash/pHash or robust hash
  audioKey?: string;        // stable audio identifier
  captionNorm?: string;     // normalized caption
  durationSec?: number;     // integer seconds
  thumbUrl?: string;        // S3 PNG (0s frame) for YT or IG preview
  createdAt: Date;
  updatedAt: Date;
}

const PostSchema = new Schema<PostDoc>({
  idempotencyKey: { type: String, required: true, index: true, unique: true },
  platform: { type: String, required: true, enum: ['instagram', 'youtube'], index: true },
  videoHash: { type: String, required: true },
  scheduledAt: { type: Date, required: true, index: true },
  status: { type: String, required: true, enum: ['posting', 'posted', 'failed'], index: true },
  externalPostId: { type: String },
  error: { type: String },
  payloadSummary: {
    videoUrl: { type: String },
    captionPreview: { type: String }
  },
  postedAt: { type: Date, index: true },
  visualHash: { type: String },
  audioKey: { type: String },
  captionNorm: { type: String },
  durationSec: { type: Number },
  thumbUrl: { type: String }
}, { timestamps: true, collection: 'Posts' });

PostSchema.index({ idempotencyKey: 1 }, { unique: true });
PostSchema.index({ platform: 1, scheduledAt: 1 });
PostSchema.index({ platform: 1, postedAt: -1 });
PostSchema.index({ platform: 1, visualHash: 1, postedAt: -1 });

export const PostModel: Model<PostDoc> = (mongoose.models.Posts as Model<PostDoc>) || mongoose.model<PostDoc>('Posts', PostSchema);

module.exports = { PostModel };

