import React, { useMemo, useState } from 'react';
import { haversineDistanceMeters, getHighAccuracyPosition } from '../utils/geo.js';

const PRESETS = [
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

export default function LocationPinMap({
  officeLat = 23.8103,
  officeLng = 90.4125,
  radiusMeters = 100,
  checkInLat = null,
  checkInLng = null,
  checkOutLat = null,
  checkOutLng = null,
  editable = false,
  onUpdateCoords
}) {
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState('');

  const checkInDistance = useMemo(() => {
    if (checkInLat == null || checkInLng == null) return 0;
    return haversineDistanceMeters(officeLat, officeLng, checkInLat, checkInLng);
  }, [officeLat, officeLng, checkInLat, checkInLng]);

  const checkOutDistance = useMemo(() => {
    if (checkOutLat == null || checkOutLng == null) return 0;
    return haversineDistanceMeters(officeLat, officeLng, checkOutLat, checkOutLng);
  }, [officeLat, officeLng, checkOutLat, checkOutLng]);

  const maxDisplayMeters = useMemo(
    () => Math.max(radiusMeters * 1.4, checkInDistance * 1.25, checkOutDistance * 1.25, 150),
    [radiusMeters, checkInDistance, checkOutDistance]
  );

  const geofenceCircleRadius = useMemo(() => {
    const r = (radiusMeters / maxDisplayMeters) * 65;
    return Math.max(18, Math.min(68, r));
  }, [radiusMeters, maxDisplayMeters]);

  const projectPoint = (lat, lng) => {
    if (lat == null || lng == null) return null;
    const dLatMeters = (lat - officeLat) * 111320;
    const dLngMeters = (lng - officeLng) * 111320 * Math.cos((officeLat * Math.PI) / 180);
    const scale = 65 / maxDisplayMeters;
    const x = Math.max(14, Math.min(266, 140 + dLngMeters * scale));
    const y = Math.max(14, Math.min(166, 90 - dLatMeters * scale));
    return { x, y };
  };

  const checkInPoint = projectPoint(checkInLat, checkInLng);
  const checkOutPoint = projectPoint(checkOutLat, checkOutLng);

  const handleSvgClick = (e) => {
    if (!editable || !onUpdateCoords) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * 280;
    const clickY = ((e.clientY - rect.top) / rect.height) * 180;
    const dxMeters = ((clickX - 140) / 65) * 100;
    const dyMeters = ((90 - clickY) / 65) * 100;
    const newLat = Number((officeLat + dyMeters / 111320).toFixed(6));
    const newLng = Number(
      (officeLng + dxMeters / (111320 * Math.cos((officeLat * Math.PI) / 180))).toFixed(6)
    );
    onUpdateCoords({ lat: newLat, lng: newLng });
  };

  const useCurrentGps = async () => {
    setGpsError('');
    setGpsLoading(true);
    try {
      const pos = await getHighAccuracyPosition();
      if (onUpdateCoords) onUpdateCoords({ lat: pos.lat, lng: pos.lng });
    } catch (err) {
      setGpsError(err.message);
    } finally {
      setGpsLoading(false);
    }
  };

  const applyPreset = (name) => {
    const found = PRESETS.find((p) => p.name === name);
    if (found && onUpdateCoords) {
      onUpdateCoords({ lat: found.lat, lng: found.lng });
    }
  };

  return (
    <div className="bg-slate-900 text-slate-100 rounded-2xl p-4 overflow-hidden">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-xs font-medium text-slate-300">Geofence Pin &amp; Coordinates</div>
        <div className="text-xs font-mono-tabular text-emerald-300">Radius: {radiusMeters}m</div>
      </div>

      <div className="relative bg-slate-950/70 rounded-xl border border-slate-800 p-2">
        <svg
          viewBox="0 0 280 180"
          className={`w-full h-44 select-none ${editable ? 'cursor-crosshair' : ''}`}
          onClick={handleSvgClick}
        >
          <line x1="0" y1="90" x2="280" y2="90" stroke="#1e293b" strokeWidth="1" strokeDasharray="3 3" />
          <line x1="140" y1="0" x2="140" y2="180" stroke="#1e293b" strokeWidth="1" strokeDasharray="3 3" />
          <circle cx="140" cy="90" r="64" fill="none" stroke="#334155" strokeWidth="1" strokeDasharray="2 4" />

          <circle
            cx="140"
            cy="90"
            r={geofenceCircleRadius}
            fill="rgba(16, 185, 129, 0.12)"
            stroke="#10b981"
            strokeWidth="1.5"
          />

          {checkInPoint && (
            <line
              x1="140"
              y1="90"
              x2={checkInPoint.x}
              y2={checkInPoint.y}
              stroke="#38bdf8"
              strokeWidth="1.5"
              strokeDasharray="3 2"
            />
          )}
          {checkOutPoint && (
            <line
              x1="140"
              y1="90"
              x2={checkOutPoint.x}
              y2={checkOutPoint.y}
              stroke="#f59e0b"
              strokeWidth="1.5"
              strokeDasharray="3 2"
            />
          )}

          <circle cx="140" cy="90" r="6" fill="#10b981" stroke="#ffffff" strokeWidth="2" />
          <text x="148" y="86" fill="#a7f3d0" fontSize="10" fontFamily="DM Sans, sans-serif">
            Office
          </text>

          {checkInPoint && (
            <g>
              <circle cx={checkInPoint.x} cy={checkInPoint.y} r="6" fill="#38bdf8" stroke="#ffffff" strokeWidth="2" />
              <text
                x={checkInPoint.x + 8}
                y={checkInPoint.y + 3}
                fill="#bae6fd"
                fontSize="10"
                fontFamily="DM Sans, sans-serif"
              >
                In ({checkInDistance}m)
              </text>
            </g>
          )}

          {checkOutPoint && (
            <g>
              <circle cx={checkOutPoint.x} cy={checkOutPoint.y} r="6" fill="#f59e0b" stroke="#ffffff" strokeWidth="2" />
              <text
                x={checkOutPoint.x + 8}
                y={checkOutPoint.y + 13}
                fill="#fde68a"
                fontSize="10"
                fontFamily="DM Sans, sans-serif"
              >
                Out ({checkOutDistance}m)
              </text>
            </g>
          )}
        </svg>
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono-tabular text-slate-300">
        <div>
          Office: {Number(officeLat).toFixed(5)}, {Number(officeLng).toFixed(5)}
        </div>
        {checkInLat != null && checkInLng != null && (
          <div className="text-sky-300">
            In: {Number(checkInLat).toFixed(5)}, {Number(checkInLng).toFixed(5)} · {checkInDistance}m
          </div>
        )}
        {checkOutLat != null && checkOutLng != null && (
          <div className="text-amber-300">
            Out: {Number(checkOutLat).toFixed(5)}, {Number(checkOutLng).toFixed(5)} · {checkOutDistance}m
          </div>
        )}
      </div>

      {editable && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={useCurrentGps}
            disabled={gpsLoading}
            className="min-h-[40px] px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium transition-colors disabled:opacity-60"
          >
            {gpsLoading ? 'লোকেশন নেওয়া হচ্ছে...' : 'Use Current GPS Location'}
          </button>
          <select
            onChange={(e) => applyPreset(e.target.value)}
            defaultValue=""
            className="min-h-[40px] px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-100"
          >
            <option value="">Quick Bangladesh Preset...</option>
            {PRESETS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {gpsError && <p className="mt-2 text-xs text-rose-300">{gpsError}</p>}
    </div>
  );
}
