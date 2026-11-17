export function captureWatermarkedSelfie(videoEl, metadata) {
  return new Promise((resolve, reject) => {
    if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) {
      reject(new Error('ক্যামেরা ফ্রেম প্রস্তুত নয়। অনুগ্রহ করে আবার চেষ্টা করুন।'));
      return;
    }

    const maxWidth = 640;
    const scale = videoEl.videoWidth > maxWidth ? maxWidth / videoEl.videoWidth : 1;
    const width = Math.round(videoEl.videoWidth * scale);
    const height = Math.round(videoEl.videoHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Mirror horizontally for natural front-camera preview consistency
    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(videoEl, 0, 0, width, height);
    ctx.restore();

    // Watermark scrim bar at bottom
    const barHeight = Math.max(66, Math.round(height * 0.19));
    const grad = ctx.createLinearGradient(0, height - barHeight - 16, 0, height);
    grad.addColorStop(0, 'rgba(15, 23, 42, 0)');
    grad.addColorStop(0.35, 'rgba(15, 23, 42, 0.78)');
    grad.addColorStop(1, 'rgba(15, 23, 42, 0.92)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, height - barHeight - 16, width, barHeight + 16);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 14px "DM Sans", sans-serif';
    ctx.fillText(metadata.name || 'Employee', 12, height - barHeight + 18);

    ctx.fillStyle = '#CBD5E1';
    ctx.font = '12px "JetBrains Mono", monospace';
    ctx.fillText(
      `GPS: ${metadata.lat}, ${metadata.lng} (±${metadata.accuracy}m)`,
      12,
      height - barHeight + 37
    );
    ctx.fillText(
      `${metadata.timestampText} (Asia/Dhaka)`,
      12,
      height - barHeight + 55
    );

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('ছবি প্রসেস করা যায়নি। আবার চেষ্টা করুন।'));
          return;
        }
        resolve({
          blob,
          previewUrl: URL.createObjectURL(blob)
        });
      },
      'image/jpeg',
      0.6
    );
  });
}
