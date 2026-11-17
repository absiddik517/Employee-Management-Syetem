import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, AlertTriangle } from 'lucide-react';
import { captureWatermarkedSelfie } from '../utils/camera.js';
import { formatDhakaDateTime } from '../utils/dhakaTime.js';

export default function CameraSelfieCapture({
  employeeName,
  lat,
  lng,
  accuracy,
  onCaptured,
  onCancel
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const previewUrlRef = useRef('');

  const [streamActive, setStreamActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [capturedBlob, setCapturedBlob] = useState(null);
  const [capturedPreviewUrl, setCapturedPreviewUrl] = useState('');

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setStreamActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError('');
    stopCamera();
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('এই ডিভাইসে ইন-অ্যাপ ক্যামেরা সমর্থিত নয়।');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setStreamActive(true);
    } catch (err) {
      setStreamActive(false);
      setCameraError(
        err.name === 'NotAllowedError'
          ? 'ক্যামেরা অনুমতি দেওয়া হয়নি। অনুগ্রহ করে সামনের ক্যামেরা অনুমতি চালু করুন।'
          : err.message || 'সামনের ক্যামেরা চালু করা যায়নি।'
      );
    }
  }, [stopCamera]);

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, [startCamera, stopCamera]);

  const capturePhoto = async () => {
    setCapturing(true);
    try {
      const result = await captureWatermarkedSelfie(videoRef.current, {
        name: employeeName,
        lat,
        lng,
        accuracy,
        timestampText: formatDhakaDateTime(new Date())
      });
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      previewUrlRef.current = result.previewUrl;
      setCapturedBlob(result.blob);
      setCapturedPreviewUrl(result.previewUrl);
      stopCamera();
    } catch (err) {
      setCameraError(err.message || 'ছবি তোলা যায়নি।');
    } finally {
      setCapturing(false);
    }
  };

  const retake = async () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = '';
    }
    setCapturedBlob(null);
    setCapturedPreviewUrl('');
    await startCamera();
  };

  const confirmPhoto = () => {
    if (!capturedBlob || !onCaptured) return;
    onCaptured(capturedBlob);
  };

  const handleCancel = () => {
    stopCamera();
    if (onCancel) onCancel();
  };

  return (
    <div className="bg-slate-900 rounded-2xl overflow-hidden text-white">
      <div className="relative aspect-[4/3] bg-slate-950 flex items-center justify-center">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover scale-x-[-1] ${
            !capturedPreviewUrl && streamActive ? 'block' : 'hidden'
          }`}
        />

        {capturedPreviewUrl && (
          <img
            src={capturedPreviewUrl}
            alt="Captured attendance selfie"
            className="w-full h-full object-cover"
          />
        )}

        {!streamActive && !capturedPreviewUrl && (
          <div className="p-6 text-center space-y-3">
            {!cameraError ? (
              <Camera className="w-10 h-10 text-emerald-400 mx-auto" />
            ) : (
              <AlertTriangle className="w-10 h-10 text-rose-400 mx-auto" />
            )}
            <p className="text-sm text-slate-200">{cameraError || 'সামনের ক্যামেরা চালু হচ্ছে...'}</p>
            {cameraError && (
              <button
                type="button"
                onClick={startCamera}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-sm font-medium text-white"
              >
                Retry Camera
              </button>
            )}
          </div>
        )}
      </div>

      <div className="p-4 bg-slate-900 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="text-xs text-slate-300 font-mono-tabular">
          <div>{employeeName}</div>
          <div>
            GPS: {lat}, {lng} (±{accuracy}m)
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCancel}
            className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-700 text-sm font-medium text-slate-200 hover:bg-slate-800"
          >
            Cancel
          </button>

          {!capturedPreviewUrl ? (
            <button
              type="button"
              disabled={!streamActive || capturing}
              onClick={capturePhoto}
              className="flex-1 sm:flex-none min-h-[44px] px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white disabled:opacity-50"
            >
              {capturing ? 'প্রসেস হচ্ছে...' : 'Capture Selfie'}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={retake}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-700 text-sm font-medium text-slate-200 hover:bg-slate-800"
              >
                Retake
              </button>
              <button
                type="button"
                onClick={confirmPhoto}
                className="flex-1 sm:flex-none min-h-[44px] px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white"
              >
                Confirm &amp; Submit
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
