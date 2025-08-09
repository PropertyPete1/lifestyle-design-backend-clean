import mongoose, { Schema, Document, Model } from 'mongoose';

export interface DailyCounterDoc extends Document {
  platform: 'instagram' | 'youtube';
  dateKey: string; // YYYYMMDD
  count: number;
  createdAt: Date;
  updatedAt: Date;
}

const DailyCounterSchema = new Schema<DailyCounterDoc>({
  platform: { type: String, required: true, enum: ['instagram', 'youtube'], index: true },
  dateKey: { type: String, required: true, index: true },
  count: { type: Number, required: true, default: 0 }
}, { timestamps: true, collection: 'DailyCounters' });

DailyCounterSchema.index({ platform: 1, dateKey: 1 }, { unique: true });

export const DailyCounterModel: Model<DailyCounterDoc> = (mongoose.models.DailyCounters as Model<DailyCounterDoc>) || mongoose.model<DailyCounterDoc>('DailyCounters', DailyCounterSchema);

module.exports = { DailyCounterModel };

