/**
 * Front-camera opening for the check-in selfie, plus the evidence needed when the camera or the
 * area check fails on one particular phone.
 *
 * Before 2026-10-08 the page called getUserMedia once and turned every failure into the same
 * "เปิดกล้องไม่สำเร็จ" toast, so a staff member whose phone refused could only say "it doesn't
 * work". The browser does say why (permission blocked, camera held by another app, no camera
 * matching the constraint, …) — this module keeps that reason, retries with looser constraints
 * where a retry can help, and formats a report the employee can copy and send to HR/IT.
 */

export type CameraFailureKind =
  | 'unsupported' // no navigator.mediaDevices.getUserMedia (old browser / in-app webview)
  | 'insecure' // page not served over https, so the browser hides the camera API
  | 'denied' // the site or the browser app itself has no camera permission
  | 'in_use' // the camera is held by another app, or the driver failed to start
  | 'not_found' // the phone reports no camera at all
  | 'overconstrained' // no camera matches the constraint (e.g. no front camera)
  | 'timeout' // getUserMedia never answered (a permission prompt that never appeared)
  | 'no_frames' // a stream opened but the preview never received a frame
  | 'unknown';

export interface CameraAttempt {
  label: string;
  ok: boolean;
  ms: number;
  errorName?: string;
  errorMessage?: string;
  constraint?: string;
}

export interface CameraEvent {
  at: string;
  message: string;
}

export type OpenCameraResult =
  | { ok: true; stream: MediaStream; attempts: CameraAttempt[] }
  | { ok: false; kind: CameraFailureKind; attempts: CameraAttempt[] };

const GET_USER_MEDIA_TIMEOUT_MS = 12_000;

/** Tried in order. The second drops the facing-mode hint, which some Android builds reject. */
const ATTEMPTS: { label: string; constraints: MediaStreamConstraints }[] = [
  { label: 'front (facingMode: user)', constraints: { video: { facingMode: 'user' }, audio: false } },
  { label: 'any camera (video: true)', constraints: { video: true, audio: false } },
];

/** Failures a different constraint cannot fix — retrying only shows the same refusal again. */
const FINAL_KINDS: ReadonlySet<CameraFailureKind> = new Set(['denied', 'insecure', 'unsupported', 'not_found']);

class CameraTimeoutError extends Error {
  constructor() {
    super(`getUserMedia did not answer within ${GET_USER_MEDIA_TIMEOUT_MS / 1000}s`);
    this.name = 'TimeoutError';
  }
}

export function classifyCameraError(err: unknown): CameraFailureKind {
  if (err instanceof CameraTimeoutError) return 'timeout';
  const name = err instanceof Error || err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'in_use';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'not_found';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'overconstrained';
    case 'TypeError':
      return 'unsupported';
    default:
      return 'unknown';
  }
}

function describeError(err: unknown): Pick<CameraAttempt, 'errorName' | 'errorMessage' | 'constraint'> {
  if (err instanceof Error || err instanceof DOMException) {
    const constraint = (err as { constraint?: unknown }).constraint;
    return {
      errorName: err.name,
      errorMessage: err.message,
      constraint: typeof constraint === 'string' && constraint ? constraint : undefined,
    };
  }
  return { errorName: typeof err, errorMessage: String(err) };
}

/**
 * getUserMedia with a deadline. A stream that arrives after the deadline is stopped at once,
 * or the camera light would stay on with nothing showing it.
 */
function getUserMediaWithTimeout(constraints: MediaStreamConstraints): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      settled = true;
      reject(new CameraTimeoutError());
    }, GET_USER_MEDIA_TIMEOUT_MS);
    navigator.mediaDevices.getUserMedia(constraints).then(
      (stream) => {
        if (settled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        settled = true;
        window.clearTimeout(timer);
        resolve(stream);
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export async function openFrontCamera(): Promise<OpenCameraResult> {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return { ok: false, kind: 'insecure', attempts: [] };
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, kind: 'unsupported', attempts: [] };
  }

  const attempts: CameraAttempt[] = [];
  let lastKind: CameraFailureKind = 'unknown';
  for (const attempt of ATTEMPTS) {
    const started = performance.now();
    try {
      const stream = await getUserMediaWithTimeout(attempt.constraints);
      attempts.push({ label: attempt.label, ok: true, ms: Math.round(performance.now() - started) });
      return { ok: true, stream, attempts };
    } catch (err) {
      lastKind = classifyCameraError(err);
      attempts.push({
        label: attempt.label,
        ok: false,
        ms: Math.round(performance.now() - started),
        ...describeError(err),
      });
      if (FINAL_KINDS.has(lastKind)) break;
    }
  }
  return { ok: false, kind: lastKind, attempts };
}

/** One line per track setting worth knowing when a preview stays black. */
export function describeStream(stream: MediaStream): string {
  const track = stream.getVideoTracks()[0];
  if (!track) return 'stream has no video track';
  const s = track.getSettings?.() ?? {};
  return [
    `track="${track.label || '(no label)'}"`,
    `state=${track.readyState}`,
    `muted=${track.muted}`,
    `size=${s.width ?? '?'}x${s.height ?? '?'}`,
    `facing=${s.facingMode ?? '?'}`,
    `fps=${s.frameRate ?? '?'}`,
  ].join(' ');
}

async function videoInputs(): Promise<string> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return 'enumerateDevices not available';
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === 'videoinput');
    const labels = cams.map((d) => d.label || '(label hidden until permission)');
    return `${cams.length}${labels.length ? ` — ${labels.join(' | ')}` : ''}`;
  } catch (err) {
    return `enumerate failed (${describeError(err).errorName})`;
  }
}

function displayMode(): string {
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone ? 'PWA (standalone)' : 'browser tab';
}

/** What the check-in page knew about location when the report was taken. */
export interface LocationSnapshot {
  locStatus: string;
  gateStatus: string;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  ageS: number | null;
  geoError: string | null;
  gate: {
    status: string;
    code: string | null;
    store_id: string | null;
    distance_m: number | null;
    allowed_distance_m: number | null;
  } | null;
}

export interface CheckinDebugInput {
  cameraKind: CameraFailureKind | null;
  attempts: CameraAttempt[];
  events: CameraEvent[];
  location: LocationSnapshot;
}

async function permissionState(name: 'camera' | 'geolocation'): Promise<string> {
  try {
    if (!navigator.permissions?.query) return 'permissions API not available';
    const status = await navigator.permissions.query({ name: name as PermissionName });
    return status.state;
  } catch (err) {
    return `query failed (${describeError(err).errorName})`;
  }
}

function locationLines(loc: LocationSnapshot): string[] {
  const fix =
    loc.lat !== null && loc.lng !== null
      ? `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)} ±${loc.accuracyM !== null ? Math.round(loc.accuracyM) : '?'} m` +
        ` (age ${loc.ageS ?? '?'} s)`
      : 'none';
  const gate = loc.gate
    ? `${loc.gate.status}${loc.gate.code ? ` / ${loc.gate.code}` : ''} — store ${loc.gate.store_id ?? '-'}, ` +
      `distance ${loc.gate.distance_m ?? '-'} m, allowed ${loc.gate.allowed_distance_m ?? '-'} m`
    : 'none';
  return [
    `gps status: ${loc.locStatus}`,
    `gps fix: ${fix}`,
    `gps error: ${loc.geoError ?? '-'}`,
    `area check: ${loc.gateStatus} — ${gate}`,
  ];
}

/**
 * Plain-text report for the debug modal's copy button. Device and browser facts plus the
 * employee's own GPS fix — no name, no token — meant to be pasted to HR/IT in LINE.
 */
export async function buildCheckinDebugReport({
  cameraKind,
  attempts,
  events,
  location: loc,
}: CheckinDebugInput): Promise<string> {
  const [cameraPerm, geoPerm, cams] = await Promise.all([
    permissionState('camera'),
    permissionState('geolocation'),
    videoInputs(),
  ]);
  const lines = [
    '=== Check-in debug ===',
    `time: ${new Date().toISOString()}`,
    `page: ${location.origin}${location.pathname}`,
    `mode: ${displayMode()}`,
    `secureContext: ${window.isSecureContext}`,
    `online: ${navigator.onLine}`,
    `screen: ${window.screen.width}x${window.screen.height} @${window.devicePixelRatio}`,
    `userAgent: ${navigator.userAgent}`,
    '--- location ---',
    `location permission: ${geoPerm}`,
    ...locationLines(loc),
    '--- camera ---',
    `camera result: ${cameraKind ?? 'no failure recorded'}`,
    `getUserMedia: ${typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'yes' : 'NO'}`,
    `camera permission: ${cameraPerm}`,
    `cameras: ${cams}`,
    ...(attempts.length
      ? attempts.map(
          (a, i) =>
            `attempt ${i + 1}. ${a.label}: ${a.ok ? 'OK' : `${a.errorName ?? '?'} — ${a.errorMessage ?? ''}`}` +
            `${a.constraint ? ` [constraint: ${a.constraint}]` : ''} (${a.ms} ms)`
        )
      : ['attempts: (none yet)']),
    '--- events ---',
    ...(events.length ? events.map((e) => `${e.at} ${e.message}`) : ['(none)']),
  ];
  return lines.join('\n');
}

/** Clipboard API first; the textarea fallback covers http, old WebViews and denied clipboard. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
