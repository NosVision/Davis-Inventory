'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MapPin, RefreshCw, Camera, Loader2 } from 'lucide-react';
import { Button, PageHeader, StatusBadge, DataList, DataCard, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { toBangkokISO, formatTimeBangkok } from '@/lib/utils/date';

type AttendanceType = 'in' | 'out' | 'break_start' | 'break_end';

type TypeKey = 'in' | 'out' | 'breakStart' | 'breakEnd';

const TYPE_OPTIONS: { value: AttendanceType; key: TypeKey }[] = [
  { value: 'in', key: 'in' },
  { value: 'out', key: 'out' },
  { value: 'break_start', key: 'breakStart' },
  { value: 'break_end', key: 'breakEnd' },
];

const TYPE_KEY: Record<AttendanceType, TypeKey> = {
  in: 'in',
  out: 'out',
  break_start: 'breakStart',
  break_end: 'breakEnd',
};

interface Coords {
  lat: number;
  lng: number;
  accuracy: number;
}

interface AttendanceRow {
  id: string;
  type: AttendanceType;
  ts: string;
  in_geofence: boolean | null; // null = no geofence configured (undeterminable)
  distance_m: number | null;
}

type LocStatus = 'idle' | 'loading' | 'ready' | 'failed';

const isDev = process.env.NODE_ENV === 'development';

export default function CheckinPage() {
  const t = useTranslations('hr.checkin');

  const [type, setType] = useState<AttendanceType>('in');
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locStatus, setLocStatus] = useState<LocStatus>('idle');
  const [photo, setPhoto] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // --- Location ---
  const getLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocStatus('failed');
      return;
    }
    setLocStatus('loading');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setLocStatus('ready');
      },
      () => setLocStatus('failed'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

  // --- Today's list ---
  const fetchToday = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch('/api/hr/ess/checkin');
      if (!res.ok) throw new Error('load failed');
      const json = await res.json();
      setRows((json.data ?? []) as AttendanceRow[]);
    } catch {
      // The list is non-critical; keep whatever is already shown.
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    getLocation();
    fetchToday();
  }, [getLocation, fetchToday]);

  // --- Camera lifecycle ---
  const stopCamera = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      toast({ type: 'error', title: t('cameraFailed') });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
    } catch {
      toast({ type: 'error', title: t('cameraFailed') });
    }
  }, [t]);

  // Attach the stream once the <video> element is mounted (cameraOn === true).
  useEffect(() => {
    if (cameraOn && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraOn]);

  // Stop the camera on unmount.
  useEffect(() => {
    return () => {
      const stream = streamRef.current;
      if (stream) stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // --- Watermark: translucent bar + Bangkok time + GPS, burned onto the canvas ---
  const drawWatermark = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const barHeight = Math.max(52, Math.round(h * 0.14));
      const top = h - barHeight;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(0, top, w, barHeight);

      const fontSize = Math.max(14, Math.round(h * 0.032));
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${fontSize}px system-ui, sans-serif`;

      const timeStr = toBangkokISO();
      const coordStr = coords
        ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`
        : 'GPS n/a';
      const pad = Math.round(w * 0.03);
      ctx.fillText(timeStr, pad, top + barHeight * 0.34);
      ctx.fillText(coordStr, pad, top + barHeight * 0.7);
    },
    [coords]
  );

  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    drawWatermark(ctx, w, h);
    setPhoto(canvas.toDataURL('image/jpeg', 0.85));
    stopCamera();
  }, [drawWatermark, stopCamera]);

  const retake = useCallback(() => {
    setPhoto(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // --- Dev bypass: draw an uploaded file through the same watermark path ---
  const onDevFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const w = img.naturalWidth || 640;
          const h = img.naturalHeight || 480;
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(img, 0, 0, w, h);
          drawWatermark(ctx, w, h);
          setPhoto(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    },
    [drawWatermark]
  );

  // --- Submit ---
  const submit = useCallback(async () => {
    if (!coords) {
      toast({ type: 'warning', title: t('needLocation') });
      return;
    }
    if (!photo) {
      toast({ type: 'warning', title: t('needPhoto') });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/hr/ess/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          gps_lat: coords.lat,
          gps_lng: coords.lng,
          photo,
          device: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || t('failed'));
      toast({
        type: 'success',
        title: json.in_geofence === false ? t('successOut') : t('success'),
      });
      setPhoto(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await fetchToday();
    } catch (err) {
      toast({ type: 'error', title: err instanceof Error ? err.message : t('failed') });
    } finally {
      setSubmitting(false);
    }
  }, [coords, photo, type, t, fetchToday]);

  const canSubmit = coords !== null && photo !== null && !submitting;

  return (
    <div className="mx-auto max-w-md space-y-5 p-4">
      {/* Header */}
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {/* Type selector */}
      <div className="grid grid-cols-2 gap-2">
        {TYPE_OPTIONS.map((opt) => {
          const selected = type === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setType(opt.value)}
              aria-pressed={selected}
              className={cn(
                'rounded-xl border px-3 py-3 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                selected
                  ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm dark:border-indigo-500 dark:bg-indigo-500'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
              )}
            >
              {t(opt.key)}
            </button>
          );
        })}
      </div>

      {/* GPS */}
      <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <MapPin
              className={cn(
                'h-5 w-5 shrink-0',
                locStatus === 'ready'
                  ? 'text-emerald-500'
                  : locStatus === 'failed'
                    ? 'text-red-500'
                    : 'text-gray-400'
              )}
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                {locStatus === 'loading'
                  ? t('gettingLocation')
                  : locStatus === 'ready'
                    ? t('locationReady')
                    : locStatus === 'failed'
                      ? t('locationFailed')
                      : t('gettingLocation')}
              </p>
              {coords && (
                <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                  {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
                </p>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={getLocation}
            icon={
              <RefreshCw
                className={cn('h-4 w-4', locStatus === 'loading' && 'animate-spin')}
              />
            }
          >
            <span className="sr-only sm:not-sr-only">{t('gettingLocation')}</span>
          </Button>
        </div>
      </div>

      {/* Camera / photo */}
      <div className="space-y-3">
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-900">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="selfie" className="h-full w-full object-cover" />
          ) : cameraOn ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-gray-400">
              <Camera className="h-10 w-10" />
            </div>
          )}
        </div>
        <canvas ref={canvasRef} className="hidden" />

        <div className="flex flex-wrap gap-2">
          {photo ? (
            <Button variant="outline" size="md" onClick={retake} className="flex-1">
              {t('retake')}
            </Button>
          ) : cameraOn ? (
            <Button size="md" onClick={capture} className="flex-1">
              {t('capture')}
            </Button>
          ) : (
            <Button
              size="md"
              onClick={startCamera}
              icon={<Camera className="h-4 w-4" />}
              className="flex-1"
            >
              {t('startCamera')}
            </Button>
          )}
        </div>

        {isDev && !photo && (
          <label className="block cursor-pointer text-xs text-gray-500 dark:text-gray-400">
            <span className="mb-1 block font-medium">{t('devUpload')}</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={onDevFile}
              className="block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-gray-200 file:px-3 file:py-2 file:text-xs file:font-medium file:text-gray-700 dark:file:bg-gray-700 dark:file:text-gray-200"
            />
          </label>
        )}
      </div>

      {/* Submit */}
      <Button
        size="lg"
        onClick={submit}
        disabled={!canSubmit}
        isLoading={submitting}
        className="w-full"
      >
        {submitting ? t('submitting') : t('submit')}
      </Button>

      {/* Today */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          {t('recentHeading')}
        </h2>
        {loadingList ? (
          <div className="flex items-center justify-center py-6 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-400 dark:border-gray-700">
            {t('noneToday')}
          </p>
        ) : (
          <DataList>
            {rows.map((row) => {
              const geoTone =
                row.in_geofence === null ? 'neutral' : row.in_geofence ? 'good' : 'warn';
              const geoLabel =
                row.in_geofence === null
                  ? t('noGeofence')
                  : row.in_geofence
                    ? t('inGeofence')
                    : t('outGeofence');
              return (
                <DataCard
                  key={row.id}
                  accent={geoTone}
                  title={t(TYPE_KEY[row.type])}
                  subtitle={formatTimeBangkok(row.ts)}
                  status={<StatusBadge tone={geoTone} label={geoLabel} />}
                />
              );
            })}
          </DataList>
        )}
      </div>
    </div>
  );
}
