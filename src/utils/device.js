const DEVICE_STORAGE_KEY = 'ems_bound_device_id';
const VALID_DEVICE_ID_REGEX = /^[a-zA-Z0-9_-]{4,128}$/;

export function getLocalDeviceId() {
  let id = localStorage.getItem(DEVICE_STORAGE_KEY);
  if (!id || !VALID_DEVICE_ID_REGEX.test(id)) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    id = 'dev_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(DEVICE_STORAGE_KEY, id);
  }
  return id;
}
