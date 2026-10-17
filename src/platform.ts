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

/** Loads one picture when it is needed – a batch of photos would not fit into memory at once. */
export type ImageLoader = () => Promise<HTMLImageElement>;

function pickFilesInBrowser(capture: boolean, multiple: boolean): Promise<ImageLoader[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = multiple;
    if (capture) input.setAttribute('capture', 'environment');
    input.onchange = () => resolve([...(input.files ?? [])].map((file) => async () => {
      const url = URL.createObjectURL(file);
      try { return await loadImage(url); } finally { URL.revokeObjectURL(url); }
    }));
    input.click();
  });
}

const cancelled = (e: unknown) => /cancel/i.test(String((e as Error)?.message ?? e));

/** Takes a photo with the camera. The temporary camera file is deleted right after loading. */
export async function takePhoto(): Promise<HTMLImageElement | null> {
  if (!native) { const [load] = await pickFilesInBrowser(true, false); return load ? load() : null; }
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

/** Picks one or more pictures/screenshots from the gallery. The originals are left untouched. */
export async function pickImages(): Promise<ImageLoader[]> {
  if (!native) return pickFilesInBrowser(false, true);
  try {
    const res = await Camera.chooseFromGallery({
      mediaType: MediaTypeSelection.Photo, allowMultipleSelection: true, limit: 0, quality: 100, correctOrientation: true,
    });
    return res.results.flatMap((r) => (r.webPath ? [() => loadImage(r.webPath!)] : []));
  } catch (e) {
    if (cancelled(e)) return [];
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
