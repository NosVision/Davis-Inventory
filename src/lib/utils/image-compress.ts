'use client';

// ---------------------------------------------------------------------------
// image-compress
// ---------------------------------------------------------------------------
// Client-side image downscale + re-encode before upload. Goal: keep Supabase
// storage usage and bandwidth down without hurting on-screen quality.
//
// Behaviour:
//   - Resizes so the longest edge ≤ maxDimension (default 1920px). Never
//     enlarges — small photos pass through at original dimensions.
//   - Re-encodes to WebP when the browser can (Chrome/Edge/Safari 14+/Firefox).
//     Falls back to JPEG. Both are far smaller than typical phone JPEGs
//     because we drop EXIF metadata, normalise quality, and re-encode at
//     ~0.78 quality which is visually indistinguishable for product photos.
//   - Honours EXIF orientation via createImageBitmap so rotated phone
//     photos don't end up sideways.
//   - HEIC and other types that the browser can't decode pass through
//     untouched — the server route still accepts them.
//   - If the re-encoded output is larger than the input (rare, but happens
//     with already-tiny WebP source), returns the original.
//   - Tiny files (< minBytes) are returned untouched to skip the work.
// ---------------------------------------------------------------------------

export interface CompressOptions {
  /** Max length of the longest edge in pixels. Default 1920. */
  maxDimension?: number;
  /** Encode quality, 0..1. Default 0.78. */
  quality?: number;
  /** Skip compression when the file is already smaller than this (bytes). Default 200KB. */
  minBytes?: number;
  /** Force output format. 'auto' picks WebP when supported. Default 'auto'. */
  format?: 'auto' | 'webp' | 'jpeg';
}

const DEFAULT_MAX_DIMENSION = 1920;
const DEFAULT_QUALITY = 0.78;
const DEFAULT_MIN_BYTES = 200 * 1024;

let cachedWebpSupport: boolean | null = null;

function supportsWebp(): boolean {
  if (cachedWebpSupport !== null) return cachedWebpSupport;
  if (typeof document === 'undefined') {
    cachedWebpSupport = false;
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const dataUrl = canvas.toDataURL('image/webp');
    cachedWebpSupport = dataUrl.startsWith('data:image/webp');
  } catch {
    cachedWebpSupport = false;
  }
  return cachedWebpSupport;
}

/**
 * Returns true for types we can decode in the browser. HEIC is excluded —
 * Safari decodes it natively but Chrome/Firefox don't, and we'd rather skip
 * than ship a wasm decoder. The upload route accepts HEIC and converts it
 * server-side if needed.
 */
function isCompressibleType(type: string): boolean {
  return type === 'image/jpeg' || type === 'image/png' || type === 'image/webp';
}

async function decodeToBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // fall through to <img> path
    }
  }

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to decode image'));
    };
    img.src = objectUrl;
  });
}

function getBitmapSize(bitmap: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  if ('naturalWidth' in bitmap) {
    return { width: bitmap.naturalWidth, height: bitmap.naturalHeight };
  }
  return { width: bitmap.width, height: bitmap.height };
}

function renameToExt(name: string, ext: string): string {
  return name.replace(/\.[^.]+$/, '') + '.' + ext;
}

/**
 * Downscale and re-encode an image file. Always returns a File — the
 * original is returned when compression is skipped or wouldn't help.
 */
export async function compressImage(
  file: File,
  options: CompressOptions = {},
): Promise<File> {
  if (typeof window === 'undefined') return file;

  const {
    maxDimension = DEFAULT_MAX_DIMENSION,
    quality = DEFAULT_QUALITY,
    minBytes = DEFAULT_MIN_BYTES,
    format = 'auto',
  } = options;

  if (!isCompressibleType(file.type)) return file;
  if (file.size <= minBytes) return file;

  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await decodeToBitmap(file);
  } catch {
    return file;
  }

  const { width: srcWidth, height: srcHeight } = getBitmapSize(bitmap);
  if (!srcWidth || !srcHeight) {
    if ('close' in bitmap) bitmap.close();
    return file;
  }

  const longest = Math.max(srcWidth, srcHeight);
  const scale = longest > maxDimension ? maxDimension / longest : 1;
  const targetWidth = Math.round(srcWidth * scale);
  const targetHeight = Math.round(srcHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    if ('close' in bitmap) bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, targetWidth, targetHeight);
  if ('close' in bitmap) bitmap.close();

  const useWebp = format === 'webp' || (format === 'auto' && supportsWebp());
  const mime = useWebp ? 'image/webp' : 'image/jpeg';
  const ext = useWebp ? 'webp' : 'jpg';

  const blob: Blob | null = await new Promise((resolve) => {
    canvas.toBlob(resolve, mime, quality);
  });

  if (!blob) return file;
  if (blob.size >= file.size) return file;

  return new File([blob], renameToExt(file.name || 'photo', ext), {
    type: mime,
    lastModified: Date.now(),
  });
}
