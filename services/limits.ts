import mongoose from 'mongoose';
import { DailyCounterModel } from '../models/DailyCounter';

export async function getRemainingSlots(platform: 'instagram' | 'youtube', dailyLimit: number): Promise<number> {
  const today = new Date();
  const dateKey = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const doc = await DailyCounterModel.findOne({ platform, dateKey }).lean();
  const used = doc?.count || 0;
  return Math.max(0, dailyLimit - used);
}

export async function incrementDailyCounter(platform: 'instagram' | 'youtube'): Promise<void> {
  const today = new Date();
  const dateKey = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  await DailyCounterModel.updateOne(
    { platform, dateKey },
    { $inc: { count: 1 } },
    { upsert: true }
  );
}

module.exports = { getRemainingSlots, incrementDailyCounter };

