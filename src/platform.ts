// Camera, gallery, saving and sharing. Native (Capacitor) on Android, plain browser APIs in dev.
import { Capacitor } from '@capacitor/core';
import { Camera, MediaTypeSelection } from '@capacitor/camera';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const native = Capacitor.isNativePlatform();

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

function pickFileInBrowser(capture: boolean): Promise<HTMLImageElement | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (capture) input.setAttribute('capture', 'environment');
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const url = URL.createObjectURL(file);
      loadImage(url).then(resolve, reject).finally(() => URL.revokeObjectURL(url));
    };
    input.click();
  });
}

const cancelled = (e: unknown) => /cancel/i.test(String((e as Error)?.message ?? e));

/** Takes a photo with the camera. The temporary camera file is deleted right after loading. */
export async function takePhoto(): Promise<HTMLImageElement | null> {
  if (!native) return pickFileInBrowser(true);
  try {
    const res = await Camera.takePhoto({ quality: 95, saveToGallery: false, correctOrientation: true, editable: 'no' });
    if (!res.webPath) return null;
    const img = await loadImage(res.webPath);
    if (res.uri?.startsWith('file:')) Filesystem.deleteFile({ path: res.uri }).catch(() => {});
    return img;
  } catch (e) {
    if (cancelled(e)) return null;
    throw e;
  }
}

/** Picks a picture or screenshot from the gallery. The original is left untouched. */
export async function pickImage(): Promise<HTMLImageElement | null> {
  if (!native) return pickFileInBrowser(false);
  try {
    const res = await Camera.chooseFromGallery({ mediaType: MediaTypeSelection.Photo, limit: 1, quality: 100, correctOrientation: true, editable: 'no' });
    const r = res.results[0];
    return r?.webPath ? loadImage(r.webPath) : null;
  } catch (e) {
    if (cancelled(e)) return null;
    throw e;
  }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Saves the picture as a new file; returns where it went (for the message). */
export async function saveImage(blob: Blob, name: string): Promise<string> {
  if (!native) { download(blob, name); return 'Downloads'; }
  const data = await toBase64(blob);
  try {
    await Filesystem.writeFile({ path: `Pictures/Anonymisiert/${name}`, data, directory: Directory.ExternalStorage, recursive: true });
    return 'Bilder › Anonymisiert';
  } catch {
    await Filesystem.writeFile({ path: `Anonymisiert/${name}`, data, directory: Directory.Documents, recursive: true });
    return 'Dokumente › Anonymisiert';
  }
}

/** Opens the Android share sheet with the picture (WhatsApp, Mail, ...). */
export async function shareImage(blob: Blob, name: string): Promise<void> {
  if (!native) {
    const file = new File([blob], name, { type: 'image/jpeg' });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
    else download(blob, name);
    return;
  }
  const data = await toBase64(blob);
  const { uri } = await Filesystem.writeFile({ path: `share/${name}`, data, directory: Directory.Cache, recursive: true });
  try {
    await Share.share({ files: [uri], dialogTitle: 'Anonymisiertes Bild teilen' });
  } catch (e) {
    if (!cancelled(e)) throw e;
  }
}

/** Removes shared copies from the app cache. */
export async function clearShareCache(): Promise<void> {
  if (native) await Filesystem.rmdir({ path: 'share', directory: Directory.Cache, recursive: true }).catch(() => {});
}
