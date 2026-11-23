import { DEVICE_INSIGHTS_ENABLED } from '../config/deviceInsights.js';

export const DEVICE_FIELD_LIMITS = Object.freeze({
  deviceId: 128,
  name: 120,
  model: 120,
  manufacturer: 120,
  platform: 40,
  osVersion: 60,
  appVersion: 40,
  engine: 60,
  screen: 40,
  timezone: 80,
  language: 40,
  ip: 64
});

export function clampDeviceString(value, maxLen, fallback = 'Unknown') {
  if (value === null || value === undefined) return fallback;
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, maxLen);
}

export function deriveDeviceStatus(userBoundDeviceId, deviceId, storedStatus) {
  if (userBoundDeviceId && deviceId && userBoundDeviceId === deviceId) {
    return 'bound';
  }
  if (storedStatus === 'blocked') {
    return 'blocked';
  }
  return 'released';
}

export function getDeviceStatusLabel(derivedStatus) {
  if (derivedStatus === 'bound') return 'Bound';
  if (derivedStatus === 'blocked') return 'Blocked attempt';
  return 'Released';
}

export function toDeviceEpochMs(val) {
  if (!val) return 0;
  try {
    if (typeof val.toMillis === 'function') return val.toMillis();
    if (typeof val.toDate === 'function') return val.toDate().getTime();
    if (typeof val.seconds === 'number') return val.seconds * 1000;
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    const parsed = Date.parse(String(val));
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

export function formatDeviceTimestamp(val) {
  const ms = toDeviceEpochMs(val);
  if (!ms) return 'No details yet';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(ms));
  } catch {
    try {
      return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
    } catch {
      return 'No details yet';
    }
  }
}

function inferManufacturer(modelStr, platformStr) {
  const m = String(modelStr || '').toLowerCase();
  const p = String(platformStr || '').toLowerCase();
  if (p === 'ios' || m.includes('iphone') || m.includes('ipad') || m.includes('mac')) return 'Apple';
  if (m.startsWith('sm-') || m.includes('samsung') || m.includes('galaxy')) return 'Samsung';
  if (m.includes('pixel')) return 'Google';
  if (m.includes('redmi') || m.includes('poco') || m.includes('xiaomi') || m.startsWith('23') || m.startsWith('24')) {
    return 'Xiaomi';
  }
  if (m.includes('oneplus') || m.startsWith('cph')) return 'OnePlus / OPPO';
  if (m.includes('realme') || m.startsWith('rmx')) return 'realme';
  if (m.includes('vivo') || m.startsWith('v2')) return 'vivo';
  if (m.includes('motorola') || m.includes('moto')) return 'Motorola';
  return 'Unknown';
}

function parseUserAgentConcise(uaRaw, uaDataHints = {}) {
  const ua = String(uaRaw || '');
  const platformHint = String(uaDataHints.platform || '').trim();
  const platformVerHint = String(uaDataHints.platformVersion || '').trim();
  const modelHint = String(uaDataHints.model || '').trim();

  let platform = platformHint || 'web';
  let osVersion = '';
  let model = modelHint || '';

  if (/android/i.test(ua)) {
    platform = 'Android';
    const verMatch = ua.match(/Android\s+([0-9.]+)/i);
    osVersion = verMatch ? `Android ${verMatch[1]}` : platformVerHint ? `Android ${platformVerHint}` : 'Android';
    if (!model) {
      const modelMatch = ua.match(/Android\s+[^;)]+;\s*([^;)]+?)(?:\s+Build\/|;|\))/i);
      if (modelMatch && modelMatch[1]) {
        const candidate = modelMatch[1].trim();
        if (candidate && candidate.toLowerCase() !== 'k' && !/^wv$/i.test(candidate)) {
          model = candidate;
        }
      }
      if (!model) model = 'Android Device';
    }
  } else if (/iphone/i.test(ua)) {
    platform = 'iOS';
    const verMatch = ua.match(/OS\s+([0-9_]+)/i);
    osVersion = verMatch ? `iOS ${verMatch[1].replace(/_/g, '.')}` : 'iOS';
    if (!model) model = 'iPhone';
  } else if (/ipad/i.test(ua)) {
    platform = 'iPadOS';
    const verMatch = ua.match(/OS\s+([0-9_]+)/i);
    osVersion = verMatch ? `iPadOS ${verMatch[1].replace(/_/g, '.')}` : 'iPadOS';
    if (!model) model = 'iPad';
  } else if (/windows nt/i.test(ua) || /windows/i.test(platformHint)) {
    platform = 'Windows';
    const winMatch = ua.match(/Windows NT\s+([0-9.]+)/i);
    if (winMatch && winMatch[1] === '10.0') {
      const majorVer = parseInt(platformVerHint.split('.')[0] || '0', 10);
      osVersion = majorVer >= 13 ? 'Windows 11' : 'Windows 10/11';
    } else if (winMatch) {
      osVersion = `Windows ${winMatch[1]}`;
    } else {
      osVersion = 'Windows';
    }
    if (!model) model = 'Windows PC';
  } else if (/macintosh|mac os x/i.test(ua) || /macos/i.test(platformHint)) {
    platform = 'macOS';
    const macMatch = ua.match(/Mac OS X\s+([0-9_.]+)/i);
    osVersion = macMatch
      ? `macOS ${macMatch[1].replace(/_/g, '.')}`
      : platformVerHint
      ? `macOS ${platformVerHint}`
      : 'macOS';
    if (!model) model = 'Mac';
  } else if (/cros/i.test(ua) || /chrome os/i.test(platformHint)) {
    platform = 'ChromeOS';
    osVersion = 'ChromeOS';
    if (!model) model = 'Chromebook';
  } else if (/linux/i.test(ua) || /linux/i.test(platformHint)) {
    platform = 'Linux';
    osVersion = 'Linux';
    if (!model) model = 'Linux PC';
  }

  let engine = 'Unknown';
  let browserShort = '';
  const edg = ua.match(/Edg(?:A|iOS)?\/([0-9]+)/);
  const opr = ua.match(/(?:OPR|Opera)\/([0-9]+)/);
  const ff = ua.match(/Firefox\/([0-9]+)/);
  const chr = ua.match(/(?:Chrome|CriOS)\/([0-9]+)/);
  const saf = ua.match(/Version\/([0-9]+(?:\.[0-9]+)?).*Safari/);

  if (edg) {
    browserShort = 'Edge';
    engine = `Blink (Edge ${edg[1]})`;
  } else if (opr) {
    browserShort = 'Opera';
    engine = `Blink (Opera ${opr[1]})`;
  } else if (ff) {
    browserShort = 'Firefox';
    engine = `Gecko (Firefox ${ff[1]})`;
  } else if (/; wv\)/i.test(ua)) {
    browserShort = 'Android WebView';
    engine = chr ? `Android WebView (${chr[1]})` : 'Android WebView';
  } else if (chr) {
    browserShort = 'Chrome';
    engine = `Blink (Chrome ${chr[1]})`;
  } else if (saf) {
    browserShort = 'Safari';
    engine = `WebKit (Safari ${saf[1]})`;
  }

  const friendlyName =
    model && model !== 'Android Device' && !model.endsWith('PC') && model !== 'Mac'
      ? `${model}${browserShort ? ` · ${browserShort}` : ''}`
      : `${browserShort || 'Browser'} on ${platform}`;

  return {
    name: friendlyName,
    model: model || 'Unknown',
    manufacturer: inferManufacturer(model, platform),
    platform,
    osVersion: osVersion || platform || 'Unknown',
    engine
  };
}

export async function collectDeviceInfo() {
  if (!DEVICE_INSIGHTS_ENABLED) return null;

  try {
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    const scr = typeof window !== 'undefined' && window.screen ? window.screen : null;

    let capDevice = null;
    let capApp = null;
    try {
      const capPlugins = typeof window !== 'undefined' ? window.Capacitor?.Plugins : null;
      if (typeof capPlugins?.Device?.getInfo === 'function') {
        capDevice = await capPlugins.Device.getInfo();
      }
      if (typeof capPlugins?.App?.getInfo === 'function') {
        capApp = await capPlugins.App.getInfo();
      }
    } catch {
      capDevice = null;
      capApp = null;
    }

    let uaDataHints = {};
    try {
      if (nav.userAgentData) {
        uaDataHints = {
          platform: nav.userAgentData.platform || ''
        };
        if (typeof nav.userAgentData.getHighEntropyValues === 'function') {
          const high = await nav.userAgentData.getHighEntropyValues(['model', 'platform', 'platformVersion']);
          uaDataHints = { ...uaDataHints, ...high };
        }
      }
    } catch {
      // ignore UA-CH failure
    }

    const parsed = parseUserAgentConcise(nav.userAgent || '', uaDataHints);

    const screenRes =
      scr && typeof scr.width === 'number' && typeof scr.height === 'number'
        ? `${scr.width}x${scr.height}`
        : 'Unknown';

    let timezone = 'Unknown';
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';
    } catch {
      timezone = 'Unknown';
    }

    const language = nav.language || 'Unknown';

    let envAppVersion = '';
    try {
      envAppVersion = import.meta?.env?.VITE_APP_VERSION || '';
    } catch {
      envAppVersion = '';
    }

    const platformVal = capDevice?.platform || parsed.platform;
    const modelVal = capDevice?.model || parsed.model;
    const manufacturerVal =
      capDevice?.manufacturer || inferManufacturer(modelVal, platformVal) || parsed.manufacturer;
    const osVersionVal =
      capDevice?.osVersion
        ? `${capDevice.platform || platformVal} ${capDevice.osVersion}`.trim()
        : parsed.osVersion;
    const nameVal = capDevice?.name || parsed.name;
    const appVersionVal = capApp?.version || envAppVersion || 'web';
    const engineVal = capDevice ? `Capacitor (${parsed.engine})` : parsed.engine;

    return {
      name: clampDeviceString(nameVal, DEVICE_FIELD_LIMITS.name, 'Unknown'),
      model: clampDeviceString(modelVal, DEVICE_FIELD_LIMITS.model, 'Unknown'),
      manufacturer: clampDeviceString(manufacturerVal, DEVICE_FIELD_LIMITS.manufacturer, 'Unknown'),
      platform: clampDeviceString(platformVal, DEVICE_FIELD_LIMITS.platform, 'web'),
      osVersion: clampDeviceString(osVersionVal, DEVICE_FIELD_LIMITS.osVersion, 'Unknown'),
      appVersion: clampDeviceString(appVersionVal, DEVICE_FIELD_LIMITS.appVersion, 'web'),
      engine: clampDeviceString(engineVal, DEVICE_FIELD_LIMITS.engine, 'Unknown'),
      screen: clampDeviceString(screenRes, DEVICE_FIELD_LIMITS.screen, 'Unknown'),
      timezone: clampDeviceString(timezone, DEVICE_FIELD_LIMITS.timezone, 'Unknown'),
      language: clampDeviceString(language, DEVICE_FIELD_LIMITS.language, 'Unknown')
    };
  } catch (err) {
    console.warn('collectDeviceInfo failed:', err?.message || err);
    return {
      name: 'Unknown',
      model: 'Unknown',
      manufacturer: 'Unknown',
      platform: 'web',
      osVersion: 'Unknown',
      appVersion: 'web',
      engine: 'Unknown',
      screen: 'Unknown',
      timezone: 'Unknown',
      language: 'Unknown'
    };
  }
}

export async function fetchPublicIp() {
  if (!DEVICE_INSIGHTS_ENABLED) return null;
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch('https://api.ipify.org?format=json', {
      signal: controller.signal,
      cache: 'no-store'
    });
    if (!res.ok) return null;
    const json = await res.json();
    const candidate = typeof json?.ip === 'string' ? json.ip.trim() : '';
    if (!candidate || candidate.length > DEVICE_FIELD_LIMITS.ip) return null;
    if (!/^[0-9a-fA-F:.]{3,64}$/.test(candidate)) return null;
    return candidate;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
