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
  }
}, { timestamps: true, collection: 'Posts' });

PostSchema.index({ idempotencyKey: 1 }, { unique: true });
PostSchema.index({ platform: 1, scheduledAt: 1 });

export const PostModel: Model<PostDoc> = (mongoose.models.Posts as Model<PostDoc>) || mongoose.model<PostDoc>('Posts', PostSchema);

module.exports = { PostModel };

