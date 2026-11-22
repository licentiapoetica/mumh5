// Opening the webcam with the choices from Settings, Video.
import { store } from './settings.svelte.ts';
import { desktop } from './native.ts';

// A face needs far less than a screen full of text, so these stay well under the screen rates
export const CAMERA_SIZES = {
  '480': { label: '480p', width: 854, height: 480, bitrate: 700_000 },
  '720': { label: '720p', width: 1280, height: 720, bitrate: 1_200_000 },
  '1080': { label: '1080p', width: 1920, height: 1080, bitrate: 2_500_000 }
} as const;
export const CAMERA_RATES = [15, 24, 30, 60] as const;

export function cameraBitrate(): number {
  const { cameraSize, cameraFps } = store.settings;
  return CAMERA_SIZES[cameraSize].bitrate * (cameraFps > 30 ? 1.5 : 1);
}

// Wishes, not demands: a camera that cannot do this gives the nearest it has
export function cameraWishes(): MediaTrackConstraints {
  const { width, height } = CAMERA_SIZES[store.settings.cameraSize];
  return { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: store.settings.cameraFps } };
}

// A saved camera that is gone is an error, not a reason to turn on a different one by itself
export async function openCamera(deviceId: string = store.settings.cameraDevice): Promise<MediaStream> {
  const video: MediaTrackConstraints = deviceId
    ? { ...cameraWishes(), deviceId: { exact: deviceId } }
    : { ...cameraWishes(), facingMode: 'user' };
  try {
    return await navigator.mediaDevices.getUserMedia({ video });
  } catch (e) {
    // Anything but these may be a phone camera that dislikes the wishes: ask for what it has
    if (['NotAllowedError', 'SecurityError', 'NotFoundError', 'OverconstrainedError'].includes((e as Error).name)) throw e;
    return navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : true });
  }
}

export function cameraError(e: unknown): string {
  const { name, message } = e as Error;
  if (name === 'NotFoundError') return 'No camera was found.';
  if (name === 'OverconstrainedError') return 'The chosen camera is not connected. Pick another one in Settings, Video.';
  if (name === 'NotReadableError') return 'The camera could not be started. Another program may be using it.';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return desktop
      ? 'The camera was refused. Allow camera access for mumh5 in your system settings, then try again.'
      : 'The camera was refused. If no question appeared, access is blocked: allow the camera for this site (the icon next to the address), and for the browser app in the phone\'s settings, then try again.';
  }
  return `Could not open the camera (${name}): ${message}`;
}
