import { LockModel } from '../models/Lock';

const LOCK_TTL_MINUTES = 5;

export async function acquireLock(key: string): Promise<boolean> {
  const expiresAt = new Date(Date.now() + LOCK_TTL_MINUTES * 60 * 1000);
  try {
    await LockModel.create({ key, expiresAt });
    return true;
  } catch (e: any) {
    // Duplicate key means already locked
    if (e && (e.code === 11000 || String(e.message || '').includes('duplicate'))) {
      return false;
    }
    throw e;
  }
}

export async function releaseLock(key: string): Promise<void> {
  try {
    await LockModel.deleteOne({ key });
  } catch (_) {
    // ignore
  }
}

module.exports = { acquireLock, releaseLock };

