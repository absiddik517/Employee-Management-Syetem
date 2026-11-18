export const OFFICE_LEVEL_LABELS = {
  head: 'Head office (Director General)',
  district: 'District office (Assistant Director)',
  upazila: 'Upazila office (UNFEO)'
};

export const OFFICE_LEVEL_SHORT = {
  head: 'Head',
  district: 'District',
  upazila: 'Upazila'
};

export const OFFICE_PRESETS = [
  { name: 'Dhaka (BNFE Head Office Area)', lat: 23.7745, lng: 90.3654 },
  { name: 'Gazipur District Office', lat: 23.9999, lng: 90.4203 },
  { name: 'Chattogram District Office', lat: 22.3569, lng: 91.7832 },
  { name: 'Rajshahi District Office', lat: 24.3745, lng: 88.6042 },
  { name: 'Khulna District Office', lat: 22.8456, lng: 89.5403 },
  { name: 'Sylhet District Office', lat: 24.8949, lng: 91.8687 },
  { name: 'Rangpur District Office', lat: 25.7439, lng: 89.2752 },
  { name: 'Barishal District Office', lat: 22.7010, lng: 90.3535 },
  { name: 'Mymensingh District Office', lat: 24.7471, lng: 90.4203 }
];

export const INITIAL_OFFICE_FORM = {
  name: '',
  address: '',
  level: 'upazila',
  parentOfficeId: '',
  lat: 23.8103,
  lng: 90.4125,
  geofenceRadiusMeters: 100,
  startTime: '09:00',
  graceMinutes: 15,
  endTime: '17:00'
};

export function formatRadius(meters) {
  const num = Number(meters);
  if (Number.isNaN(num)) return '—';
  if (num > 1000) {
    const km = num / 1000;
    return `${Number.isInteger(km) ? km : Number(km.toFixed(2))} km`;
  }
  return `${Math.round(num)} m`;
}

export function formatTime12h(hhmm) {
  if (!hhmm || !String(hhmm).includes(':')) return '—';
  const [hRaw, mRaw] = String(hhmm).split(':');
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

export function getLevelLabel(level) {
  return OFFICE_LEVEL_LABELS[level] || level || 'Office';
}

export function getLevelShortLabel(level) {
  return OFFICE_LEVEL_SHORT[level] || level || 'Office';
}

export function getEligibleParentOffices(offices, targetLevel, excludeId = null) {
  if (targetLevel === 'head') return [];
  // Keep existing AdminOfficesPage rule: exclude self and upazila offices
  return (offices || []).filter((o) => o.id !== excludeId && o.level !== 'upazila');
}

export function getSubOffices(offices, officeId) {
  if (!officeId) return [];
  return (offices || []).filter((o) => o.parentOfficeId === officeId);
}
