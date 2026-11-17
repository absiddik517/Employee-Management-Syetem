export function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export function getHighAccuracyPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('আপনার ডিভাইসে লোকেশন (GPS) সুবিধা সমর্থিত নয়।'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
          accuracy: Math.round(pos.coords.accuracy)
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(new Error('লোকেশন অনুমতি দেওয়া হয়নি। অনুগ্রহ করে GPS অনুমতি চালু করুন।'));
        } else if (err.code === err.TIMEOUT) {
          reject(new Error('GPS লোকেশন পেতে সময় বেশি লেগেছে। খোলা জায়গায় আবার চেষ্টা করুন।'));
        } else {
          reject(new Error('লোকেশন নির্ণয় করা যায়নি। ডিভাইসের GPS চালু আছে কি না দেখুন।'));
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      }
    );
  });
}
