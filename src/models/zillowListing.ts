import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ZillowListing extends Document {
  address: string;
  link: string;
  ownerName?: string;
  price?: string;
  bedrooms?: number;
  type: 'rent' | 'sale';
  flagged?: boolean;
  flagReason?: string;
}

const ZillowListingSchema: Schema<ZillowListing> = new Schema(
  {
    address: { type: String, required: true },
    link: { type: String, required: true, unique: true, index: true },
    ownerName: { type: String },
    price: { type: String },
    bedrooms: { type: Number },
    type: { type: String, enum: ['rent', 'sale'], required: true },
    flagged: { type: Boolean, default: false },
    flagReason: { type: String },
  },
  { timestamps: true, collection: 'ZillowScrapedListings' }
);

export const ZillowListingModel: Model<ZillowListing> =
  mongoose.models.ZillowScrapedListings ||
  mongoose.model<ZillowListing>('ZillowScrapedListings', ZillowListingSchema);


