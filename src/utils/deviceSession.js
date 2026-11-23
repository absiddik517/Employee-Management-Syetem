import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { DEVICE_INSIGHTS_ENABLED } from '../config/deviceInsights.js';
import {
  DEVICE_FIELD_LIMITS,
  clampDeviceString,
  collectDeviceInfo,
  fetchPublicIp
} from './deviceInfo.js';

const DEVICE_SESSION_THROTTLE_MS = 10 * 60 * 1000;
const VALID_DEVICE_ID_REGEX = /^[a-zA-Z0-9_-]{4,128}$/;
const inFlightKeys = new Set();

function getThrottleStorageKey(uid, deviceId) {
  return `ems_device_session_${uid}_${deviceId}`;
}

function readThrottleEntry(uid, deviceId) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(getThrottleStorageKey(uid, deviceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.ts === 'number') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function writeThrottleEntry(uid, deviceId, status) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
      getThrottleStorageKey(uid, deviceId),
      JSON.stringify({ ts: Date.now(), status })
    );
  } catch {
    // ignore storage failures (private browsing / quota)
  }
}

export async function recordDeviceSession(db, uid, deviceId, { blocked = false } = {}) {
  if (!DEVICE_INSIGHTS_ENABLED || !db || !uid || !deviceId) return false;

  const safeUid = String(uid).trim();
  const safeDeviceId = String(deviceId).trim();
  if (!safeUid || !VALID_DEVICE_ID_REGEX.test(safeDeviceId)) return false;

  const targetStatus = blocked ? 'blocked' : 'seen';
  const flightKey = `${safeUid}:${safeDeviceId}`;

  if (inFlightKeys.has(flightKey)) return false;

  const prevThrottle = readThrottleEntry(safeUid, safeDeviceId);
  if (
    prevThrottle &&
    prevThrottle.status === targetStatus &&
    Date.now() - prevThrottle.ts < DEVICE_SESSION_THROTTLE_MS
  ) {
    return false;
  }

  inFlightKeys.add(flightKey);
  try {
    const [info, ip] = await Promise.all([collectDeviceInfo(), fetchPublicIp()]);
    if (!info) return false;

    const sanitizedInfo = {
      name: clampDeviceString(info.name, DEVICE_FIELD_LIMITS.name, 'Unknown'),
      model: clampDeviceString(info.model, DEVICE_FIELD_LIMITS.model, 'Unknown'),
      manufacturer: clampDeviceString(info.manufacturer, DEVICE_FIELD_LIMITS.manufacturer, 'Unknown'),
      platform: clampDeviceString(info.platform, DEVICE_FIELD_LIMITS.platform, 'web'),
      osVersion: clampDeviceString(info.osVersion, DEVICE_FIELD_LIMITS.osVersion, 'Unknown'),
      appVersion: clampDeviceString(info.appVersion, DEVICE_FIELD_LIMITS.appVersion, 'web'),
      engine: clampDeviceString(info.engine, DEVICE_FIELD_LIMITS.engine, 'Unknown'),
      screen: clampDeviceString(info.screen, DEVICE_FIELD_LIMITS.screen, 'Unknown'),
      timezone: clampDeviceString(info.timezone, DEVICE_FIELD_LIMITS.timezone, 'Unknown'),
      language: clampDeviceString(info.language, DEVICE_FIELD_LIMITS.language, 'Unknown')
    };

    const safeIp =
      typeof ip === 'string' && ip.trim()
        ? clampDeviceString(ip, DEVICE_FIELD_LIMITS.ip, '')
        : '';

    const deviceRef = doc(db, 'users', safeUid, 'devices', safeDeviceId);
    const existingSnap = await getDoc(deviceRef);

    if (!existingSnap.exists()) {
      const createPayload = {
        deviceId: safeDeviceId,
        ...sanitizedInfo,
        ...(safeIp ? { ip: safeIp } : {}),
        firstSeenAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
        loginCount: 1,
        status: targetStatus
      };
      await setDoc(deviceRef, createPayload);
    } else {
      const existingData = existingSnap.data() || {};
      const prevCount =
        Number.isInteger(existingData.loginCount) && existingData.loginCount >= 0
          ? existingData.loginCount
          : 0;
      const updatePayload = {
        ...sanitizedInfo,
        ...(safeIp ? { ip: safeIp } : {}),
        lastSeenAt: serverTimestamp(),
        loginCount: prevCount + 1,
        status: targetStatus
      };
      await updateDoc(deviceRef, updatePayload);
    }

    writeThrottleEntry(safeUid, safeDeviceId, targetStatus);
    return true;
  } catch (err) {
    console.warn('recordDeviceSession failed:', err?.code || err?.message || err);
    return false;
  } finally {
    inFlightKeys.delete(flightKey);
  }
}
