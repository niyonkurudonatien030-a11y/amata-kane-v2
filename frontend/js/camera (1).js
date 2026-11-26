// Browser camera capture.  Two ways to get a photo:
//  1) <input type="file" accept="image/*" capture="environment">  -> opens the phone's own camera app (most reliable on Android)
//  2) getUserMedia()  -> live camera preview inside the page; we draw one video frame onto a <canvas> and turn it into a JPEG File.
// getUserMedia only works on HTTPS or http://localhost (browser security rule).
export function liveCameraSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
}

export function liveCapture() {
  return new Promise((resolve, reject) => {
    const wrap = document.createElement('div');
    wrap.className = 'camera';
    wrap.innerHTML = '<video playsinline autoplay muted></video><div class="bar">' +
      '<button type="button" class="btn gold" data-cam="shoot">Capture</button>' +
      '<button type="button" class="btn ghost" data-cam="cancel">Cancel</button></div>';
    document.body.appendChild(wrap);
    const video = wrap.querySelector('video');
    let stream = null;
    const done = (value, err) => {
      if (stream) stream.getTracks().forEach((t) => t.stop());   // switch the camera light off
      wrap.remove();
      err ? reject(err) : resolve(value);
    };
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((s) => { stream = s; video.srcObject = s; })
      .catch(() => done(null, new Error('Camera permission was denied or no camera was found.')));
    wrap.addEventListener('click', (e) => {
      const act = e.target.dataset && e.target.dataset.cam;
      if (act === 'cancel') done(null);
      if (act === 'shoot' && video.videoWidth) {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        canvas.toBlob((blob) => done(new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' })), 'image/jpeg', 0.92);
      }
    });
  });
}
