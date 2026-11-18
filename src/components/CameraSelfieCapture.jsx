import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, AlertTriangle } from 'lucide-react';
import { captureWatermarkedSelfie, watermarkImageFromDataUrl } from '../utils/camera.js';
import { formatDhakaDateTime } from '../utils/dhakaTime.js';

function getCapacitorCamera() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  if (!cap) return null;
  const isNative =
    typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : Boolean(cap.isNative);
  if (!isNative) return null;
  return cap.Plugins?.Camera || null;
}

function raceTimeout(promise, ms, timeoutMessage) {
  let timerId = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timerId = setTimeout(() => {
        const err = new Error(timeoutMessage);
        err.name = 'TimeoutError';
        reject(err);
      }, ms);
    })
  ]).finally(() => {
    if (timerId) clearTimeout(timerId);
  });
}

async function getUserMediaWithTimeout(constraints, ms = 8000) {
  let timedOut = false;
  let timerId = null;

  const mediaPromise = navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
    if (timedOut && stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
    return stream;
  });

  try {
    return await Promise.race([
      mediaPromise,
      new Promise((_, reject) => {
        timerId = setTimeout(() => {
          timedOut = true;
          const err = new Error('ক্যামেরা চালু হতে সময় বেশি লাগছে।');
          err.name = 'TimeoutError';
          reject(err);
        }, ms);
      })
    ]);
  } finally {
    if (timerId) clearTimeout(timerId);
  }
}

async function ensureNativeCameraPermission(capCamera) {
  if (!capCamera) return 'granted';
  try {
    if (typeof capCamera.checkPermissions === 'function') {
      const checked = await raceTimeout(capCamera.checkPermissions(), 4000, 'Permission check timeout');
      if (checked?.camera === 'granted') return 'granted';
    }
    if (typeof capCamera.requestPermissions === 'function') {
      let requested;
      try {
        requested = await raceTimeout(
          capCamera.requestPermissions({ permissions: ['camera'] }),
          15000,
          'Permission request timeout'
        );
      } catch {
        requested = await raceTimeout(capCamera.requestPermissions(), 15000, 'Permission request timeout');
      }
      return requested?.camera || 'prompt';
    }
  } catch (err) {
    console.warn('Capacitor camera permission check notice:', err);
  }
  return 'prompt';
}

function waitForVideoReady(videoEl, timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (!videoEl) {
      resolve();
      return;
    }
    if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
      videoEl.play().catch(() => {});
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      videoEl.removeEventListener('loadedmetadata', onReady);
      videoEl.removeEventListener('canplay', onReady);
      clearTimeout(timerId);
      videoEl.play().catch(() => {});
      resolve();
    };
    const onReady = () => {
      if (videoEl.videoWidth > 0 || videoEl.readyState >= 2) {
        finish();
      }
    };

    videoEl.addEventListener('loadedmetadata', onReady);
    videoEl.addEventListener('canplay', onReady);
    const timerId = setTimeout(finish, timeoutMs);
    videoEl.play().catch(() => {});
  });
}

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
  const requestSeqRef = useRef(0);
  const usedNativeCameraRef = useRef(false);

  const [streamActive, setStreamActive] = useState(false);
  const [cameraStatusText, setCameraStatusText] = useState('সামনের ক্যামেরা চালু হচ্ছে...');
  const [showNativeFallbackBtn, setShowNativeFallbackBtn] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [capturedBlob, setCapturedBlob] = useState(null);
  const [capturedPreviewUrl, setCapturedPreviewUrl] = useState('');

  const hasNativeCamera = Boolean(getCapacitorCamera()?.getPhoto);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStreamActive(false);
  }, []);

  const captureWithNativeCamera = useCallback(async () => {
    const capCamera = getCapacitorCamera();
    if (!capCamera || typeof capCamera.getPhoto !== 'function') {
      setCameraError('এই ডিভাইসে নেটিভ ক্যামেরা প্লাগইন পাওয়া যায়নি।');
      return;
    }

    const seq = ++requestSeqRef.current;
    stopCamera();
    setCameraError('');
    setCapturing(true);
    setCameraStatusText('নেটিভ ক্যামেরা চালু হচ্ছে...');

    try {
      const perm = await ensureNativeCameraPermission(capCamera);
      if (seq !== requestSeqRef.current) return;
      if (perm === 'denied') {
        throw new Error('ক্যামেরা অনুমতি দেওয়া হয়নি। অনুগ্রহ করে অ্যাপ সেটিংস থেকে ক্যামেরা অনুমতি চালু করুন।');
      }

      const photo = await capCamera.getPhoto({
        quality: 80,
        width: 800,
        allowEditing: false,
        resultType: 'dataUrl',
        source: 'CAMERA',
        direction: 'FRONT',
        correctOrientation: true,
        saveToGallery: false
      });
      if (seq !== requestSeqRef.current) return;

      const dataUrl =
        photo?.dataUrl || (photo?.base64String ? `data:image/jpeg;base64,${photo.base64String}` : '');
      if (!dataUrl) {
        throw new Error('ক্যামেরা থেকে ছবি পাওয়া যায়নি।');
      }

      const result = await watermarkImageFromDataUrl(dataUrl, {
        name: employeeName,
        lat,
        lng,
        accuracy,
        timestampText: formatDhakaDateTime(new Date())
      });
      if (seq !== requestSeqRef.current) {
        URL.revokeObjectURL(result.previewUrl);
        return;
      }

      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      usedNativeCameraRef.current = true;
      previewUrlRef.current = result.previewUrl;
      setCapturedBlob(result.blob);
      setCapturedPreviewUrl(result.previewUrl);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      const msg = String(err?.message || '');
      if (/cancel/i.test(msg)) {
        setCameraError('ক্যামেরা বাতিল করা হয়েছে। আবার চেষ্টা করতে নিচের বাটনে ট্যাপ করুন।');
      } else {
        setCameraError(msg || 'নেটিভ ক্যামেরা চালু করা যায়নি।');
      }
    } finally {
      if (seq === requestSeqRef.current) {
        setCapturing(false);
      }
    }
  }, [accuracy, employeeName, lat, lng, stopCamera]);

  const startCamera = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    usedNativeCameraRef.current = false;
    setCameraError('');
    setShowNativeFallbackBtn(false);
    setCameraStatusText('সামনের ক্যামেরা চালু হচ্ছে...');
    stopCamera();

    const capCamera = getCapacitorCamera();
    const slowTimer = capCamera?.getPhoto
      ? setTimeout(() => {
          if (seq === requestSeqRef.current) {
            setShowNativeFallbackBtn(true);
          }
        }, 2500)
      : null;

    try {
      // Request Android runtime CAMERA permission before WebView getUserMedia
      if (capCamera) {
        setCameraStatusText('ক্যামেরা অনুমতি যাচাই হচ্ছে...');
        const perm = await ensureNativeCameraPermission(capCamera);
        if (seq !== requestSeqRef.current) return;
        if (perm === 'denied') {
          throw Object.assign(
            new Error('ক্যামেরা অনুমতি দেওয়া হয়নি। অনুগ্রহ করে অ্যাপ সেটিংস থেকে ক্যামেরা অনুমতি চালু করুন।'),
            { name: 'NotAllowedError' }
          );
        }
        setCameraStatusText('সামনের ক্যামেরা চালু হচ্ছে...');
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (capCamera?.getPhoto) {
          await captureWithNativeCamera();
          return;
        }
        throw new Error('এই ডিভাইসে ইন-অ্যাপ ক্যামেরা সমর্থিত নয়।');
      }

      let stream;
      try {
        stream = await getUserMediaWithTimeout(
          { video: { facingMode: { ideal: 'user' } }, audio: false },
          8000
        );
      } catch (primaryErr) {
        if (seq !== requestSeqRef.current) return;
        if (primaryErr.name === 'OverconstrainedError' || primaryErr.name === 'NotFoundError') {
          stream = await getUserMediaWithTimeout({ video: true, audio: false }, 8000);
        } else {
          throw primaryErr;
        }
      }

      if (seq !== requestSeqRef.current) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await waitForVideoReady(videoRef.current, 3500);
      }
      if (seq !== requestSeqRef.current) return;

      setStreamActive(true);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      stopCamera();

      // In Capacitor APK, if WebView getUserMedia stalls/fails (except explicit permission denial),
      // automatically launch the native Android camera so attendance never gets stuck.
      if (capCamera?.getPhoto && err.name !== 'NotAllowedError') {
        await captureWithNativeCamera();
        return;
      }

      setCameraError(
        err.name === 'NotAllowedError'
          ? 'ক্যামেরা অনুমতি দেওয়া হয়নি। অনুগ্রহ করে সামনের ক্যামেরা অনুমতি চালু করুন।'
          : err.message || 'সামনের ক্যামেরা চালু করা যায়নি।'
      );
    } finally {
      if (slowTimer) clearTimeout(slowTimer);
    }
  }, [captureWithNativeCamera, stopCamera]);

  useEffect(() => {
    startCamera();
    return () => {
      requestSeqRef.current += 1;
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
      usedNativeCameraRef.current = false;
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
    if (usedNativeCameraRef.current && hasNativeCamera) {
      await captureWithNativeCamera();
    } else {
      await startCamera();
    }
  };

  const confirmPhoto = () => {
    if (!capturedBlob || !onCaptured) return;
    onCaptured(capturedBlob);
  };

  const handleCancel = () => {
    requestSeqRef.current += 1;
    stopCamera();
    if (onCancel) onCancel();
  };

  return (
    <div className="bg-slate-900 rounded-2xl overflow-hidden text-white">
      <div className="relative aspect-[4/3] bg-slate-950 flex items-center justify-center overflow-hidden">
        {/* Keep <video> mounted without display:none so Android WebView decodes frames reliably */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover scale-x-[-1] transition-opacity duration-200 ${
            !capturedPreviewUrl && streamActive ? 'opacity-100' : 'opacity-0 pointer-events-none absolute inset-0'
          }`}
        />

        {capturedPreviewUrl && (
          <img
            src={capturedPreviewUrl}
            alt="Captured attendance selfie"
            className="w-full h-full object-cover relative z-10"
          />
        )}

        {!streamActive && !capturedPreviewUrl && (
          <div className="relative z-10 p-6 text-center space-y-3">
            {!cameraError ? (
              <Camera className="w-10 h-10 text-emerald-400 mx-auto animate-pulse" />
            ) : (
              <AlertTriangle className="w-10 h-10 text-rose-400 mx-auto" />
            )}
            <p className="text-sm text-slate-200">{cameraError || cameraStatusText}</p>
            {(cameraError || showNativeFallbackBtn) && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {cameraError && (
                  <button
                    type="button"
                    onClick={startCamera}
                    className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-sm font-medium text-white"
                  >
                    Retry Camera
                  </button>
                )}
                {hasNativeCamera && (
                  <button
                    type="button"
                    onClick={captureWithNativeCamera}
                    className="min-h-[44px] px-4 py-2 rounded-xl border border-emerald-400/50 bg-emerald-950/60 hover:bg-emerald-900 text-sm font-medium text-emerald-200"
                  >
                    নেটিভ ক্যামেরা চালু করুন
                  </button>
                )}
              </div>
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
