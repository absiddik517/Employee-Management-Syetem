import React, { useMemo } from 'react';
import { formatRadius } from './officeHelpers.js';

export default function GeofencePreview({
  lat,
  lng,
  radiusMeters = 100,
  editable = false,
  onUpdateCoords
}) {
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  const parsedRad = Number(radiusMeters);

  const coordsValid =
    lat !== '' &&
    lng !== '' &&
    !Number.isNaN(parsedLat) &&
    !Number.isNaN(parsedLng) &&
    parsedLat >= -90 &&
    parsedLat <= 90 &&
    parsedLng >= -180 &&
    parsedLng <= 180;

  const safeRadius = Number.isNaN(parsedRad) || parsedRad < 10 ? 10 : parsedRad;

  const ringRadius = useMemo(() => {
    const computed = 15 + (Math.log10(Math.max(10, safeRadius)) - 1) * 18;
    return Math.max(14, Math.min(54, computed));
  }, [safeRadius]);

  const handleSvgClick = (e) => {
    if (!editable || !onUpdateCoords || !coordsValid) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * 240;
    const clickY = ((e.clientY - rect.top) / rect.height) * 130;
    const dxMeters = ((clickX - 120) / 50) * Math.max(safeRadius, 100);
    const dyMeters = ((65 - clickY) / 50) * Math.max(safeRadius, 100);
    const newLat = Number((parsedLat + dyMeters / 111320).toFixed(6));
    const newLng = Number(
      (parsedLng + dxMeters / (111320 * Math.cos((parsedLat * Math.PI) / 180))).toFixed(6)
    );
    onUpdateCoords({ lat: newLat, lng: newLng });
  };

  return (
    <div className="rounded-[16px] border border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/45 p-3.5 space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
        <span>Geofence pin and radius</span>
        <span className="font-mono-tabular text-[#0b6b4f] dark:text-[#4fd1a1] font-semibold">
          Radius: {formatRadius(safeRadius)}
        </span>
      </div>

      <svg
        viewBox="0 0 240 130"
        role="img"
        aria-label="Geofence preview"
        onClick={handleSvgClick}
        className={`block w-full h-32 select-none text-[#0b6b4f] dark:text-[#4fd1a1] ${
          editable && coordsValid ? 'cursor-crosshair' : ''
        }`}
      >
        <path
          d="M0 65h240M120 0v130"
          className="stroke-slate-200 dark:stroke-slate-700"
          strokeWidth="1"
          strokeDasharray="3 5"
        />
        <circle
          cx="120"
          cy="65"
          r={Math.min(60, ringRadius + 10)}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.32"
          strokeDasharray="3 4"
        />
        <circle
          cx="120"
          cy="65"
          r={ringRadius}
          fill="currentColor"
          fillOpacity="0.14"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle cx="120" cy="65" r="5" fill="currentColor" />
        <text
          x="130"
          y="60"
          className="fill-slate-600 dark:fill-slate-300 text-[11px] font-semibold"
        >
          Office
        </text>
      </svg>

      <div className="flex items-center justify-between gap-2 text-xs font-mono-tabular text-slate-600 dark:text-slate-300">
        <span>
          {coordsValid
            ? `Office: ${parsedLat.toFixed(5)}, ${parsedLng.toFixed(5)}`
            : 'Enter valid coordinates'}
        </span>
        {editable && coordsValid && (
          <span className="text-[11px] font-sans text-slate-400 dark:text-slate-500">
            Tap map to nudge pin
          </span>
        )}
      </div>
    </div>
  );
}
