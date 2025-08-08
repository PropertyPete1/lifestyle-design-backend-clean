import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ZillowSettings extends Document {
  propertyType: 'rent' | 'sale' | 'both';
  zipCodes: string[];
  minBedrooms?: number;
  maxPrice?: number;
  redFlagDetection: boolean;
  dailyMessageLimit: number;
  messageWindow: [string, string];
  testMode: boolean;
  googleSheetUrl?: string;
  zillowLogin?: { email?: string; password?: string };
}

const SettingsSchema: Schema<ZillowSettings> = new Schema(
  {
    propertyType: { type: String, enum: ['rent', 'sale', 'both'], default: 'both' },
    zipCodes: { type: [String], default: [] },
    minBedrooms: { type: Number, default: 0 },
    maxPrice: { type: Number, default: 0 },
    redFlagDetection: { type: Boolean, default: true },
    dailyMessageLimit: { type: Number, default: 10 },
    messageWindow: { type: [String], default: ['10:00', '18:00'] },
    testMode: { type: Boolean, default: true },
    googleSheetUrl: { type: String },
    zillowLogin: {
      email: { type: String },
      password: { type: String },
    },
  },
  { timestamps: true, collection: 'ZillowAssistantSettings' }
);

export const ZillowSettingsModel: Model<ZillowSettings> =
  mongoose.models.ZillowAssistantSettings ||
  mongoose.model<ZillowSettings>('ZillowAssistantSettings', SettingsSchema);


