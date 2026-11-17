import { ref as storageRef, uploadBytes } from 'firebase/storage';
import { firebaseConfig, storage, withTimeout } from '../firebase/config.js';

export function formatStorageError(err) {
  const code = err?.code || '';
  if (code === 'storage/retry-limit-exceeded') {
    return 'Firebase Storage বাকেট (iron-ivy-jvc14.firebasestorage.app) পাওয়া যায়নি বা চালু নেই। Firebase Console → Build → Storage → Get Started চালু করুন।';
  }
  if (code === 'storage/unauthorized') {
    return 'Firebase Storage rules অনুমতি দেয়নি (storage/unauthorized)। অনুগ্রহ করে Firebase Console-এ storage.rules ডিপ্লয় করুন।';
  }
  return err?.message || 'Storage upload failed';
}

/**
 * Fast probe to check whether the configured Firebase Storage bucket exists.
 * Avoids waiting 12+ seconds for SDK retries when Storage has not been initialized (HTTP 404).
 */
export async function checkStorageBucketReady() {
  if (!firebaseConfig.storageBucket) {
    return {
      ready: false,
      reason: 'Firebase Storage bucket কনফিগার করা নেই।'
    };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(
      `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(firebaseConfig.storageBucket)}/o?maxResults=1`,
      { method: 'GET', signal: controller.signal }
    );
    clearTimeout(timer);
    if (res.status === 404) {
      return {
        ready: false,
        reason: `Firebase Storage বাকেট (${firebaseConfig.storageBucket}) এখনো Firebase Console-এ চালু করা হয়নি (HTTP 404)। Firebase Console → Storage → Get Started চালু করুন।`
      };
    }
    return { ready: true, reason: '' };
  } catch {
    return { ready: true, reason: '' };
  }
}

export async function uploadImageSafe(path, fileOrBlob, contentType = 'image/jpeg') {
  const probe = await checkStorageBucketReady();
  if (!probe.ready) {
    return { ok: false, path: '', skipped: true, reason: probe.reason };
  }

  try {
    await withTimeout(
      uploadBytes(storageRef(storage, path), fileOrBlob, {
        contentType: contentType || 'image/jpeg'
      }),
      15000,
      'Firebase Storage upload timed out'
    );
    return { ok: true, path, skipped: false, reason: 'Photo uploaded to Storage' };
  } catch (err) {
    console.warn('Storage upload skipped/failed:', err?.code || err?.message);
    return {
      ok: false,
      path: '',
      skipped: true,
      reason: formatStorageError(err)
    };
  }
}
