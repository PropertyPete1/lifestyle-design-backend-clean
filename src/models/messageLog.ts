import mongoose, { Schema, Document, Model } from 'mongoose';

export interface MessageLog extends Document {
  address: string;
  link: string;
  ownerName?: string;
  type: 'rent' | 'sale';
  status: 'sent' | 'failed' | 'skipped';
  reason?: string;
  sentAt?: Date;
}

const MessageLogSchema: Schema<MessageLog> = new Schema(
  {
    address: { type: String, required: true },
    link: { type: String, required: true, index: true },
    ownerName: { type: String },
    type: { type: String, enum: ['rent', 'sale'], required: true },
    status: { type: String, enum: ['sent', 'failed', 'skipped'], required: true },
    reason: { type: String },
    sentAt: { type: Date },
  },
  { timestamps: true, collection: 'ZillowMessageLogs' }
);

export const MessageLogModel: Model<MessageLog> =
  mongoose.models.ZillowMessageLogs ||
  mongoose.model<MessageLog>('ZillowMessageLogs', MessageLogSchema);


