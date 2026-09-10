'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useEssText } from '@/lib/i18n/ess-locale';
import { MapPin, RefreshCw, Camera, Loader2, AlertTriangle, Check } from 'lucide-react';
import { Button, PageHeader, StatusBadge, DataList, DataCard, ViewToggle, useViewMode, Modal, ModalFooter, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { toBangkokISO, formatTimeBangkok } from '@/lib/utils/date';
import { TileNotices } from '../_components/tile-notices';
import { UnclosedDayCard, type OpenDay } from '../_components/unclosed-day-card';
import {
  areAttendanceControlsBlocked,
  type AttendanceLocationGate,
  type AttendanceLocationGateLoadStatus,
} from '@/lib/hr/checkin-location-gate';

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

// Semantic colour per punch type, reflecting its weight: clock-in = green (start of day),
// clock-out = red (the one you must not miss), break-start = amber (pause), break-end = blue
// (back to work). Selected = solid fill; idle = a tint so each action is still recognisable.
const TYPE_TONE: Record<AttendanceType, { selected: string; idle: string }> = {
  in: {
    selected: 'border-emerald-600 bg-emerald-600 text-white shadow-sm dark:border-emerald-500 dark:bg-emerald-500',
    idle: 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/40',
  },
  out: {
    selected: 'border-red-600 bg-red-600 text-white shadow-sm dark:border-red-500 dark:bg-red-500',
    idle: 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/40',
  },
  break_start: {
    selected: 'border-amber-500 bg-amber-500 text-white shadow-sm dark:border-amber-500 dark:bg-amber-500',
    idle: 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-900/40',
  },
  break_end: {
    selected: 'border-blue-600 bg-blue-600 text-white shadow-sm dark:border-blue-500 dark:bg-blue-500',
    idle: 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/40',
  },
};

interface Coords {
  lat: number;
  lng: number;
  accuracy: number;
  capturedAt: number;
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
  const tx = useEssText();

  const [type, setType] = useState<AttendanceType>('in');
  const [noGpsOpen, setNoGpsOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locStatus, setLocStatus] = useState<LocStatus>('idle');
  const [locationGate, setLocationGate] = useState<AttendanceLocationGate | null>(null);
  const [locationGateStatus, setLocationGateStatus] = useState<AttendanceLocationGateLoadStatus>('idle');
  const [locationNow, setLocationNow] = useState(() => Date.now());
  const [photo, setPhoto] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [view, setView] = useViewMode('me-checkin');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const locationWatchRef = useRef<number | null>(null);

  // Punch types already recorded today — those buttons are disabled so a type can't be double-tapped.
  const usedTypes = new Set(rows.map((r) => r.type));

  // --- Location ---
  const getLocation = useCallback(() => {
    setCoords(null);
    setLocationGate(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocStatus('failed');
      setLocationGateStatus('unavailable');
      return;
    }
    if (locationWatchRef.current !== null) {
      navigator.geolocation.clearWatch(locationWatchRef.current);
      locationWatchRef.current = null;
    }
    setLocStatus('loading');
    setLocationGateStatus('loading');
    locationWatchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: Date.now(),
        });
        setLocationNow(Date.now());
        setLocStatus('ready');
      },
      () => {
        setCoords(null);
        setLocationGate(null);
        setLocStatus('failed');
        setLocationGateStatus('unavailable');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

  // Even with watchPosition, browsers may pause GPS updates in the background. Never keep controls
  // unlocked forever from an old inside-area reading; stale positions require a fresh reading.
  useEffect(() => {
    if (!coords) return;
    const timer = window.setInterval(() => setLocationNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, [coords]);

  // Resolve the employee's current coordinates against the same per-branch policy used by POST.
  // Until this preflight completes, attendance controls stay locked so a known-outside punch is
  // never presented as available and rejected only after upload.
  useEffect(() => {
    if (!coords) return;
    const controller = new AbortController();
    setLocationGateStatus('loading');
    void (async () => {
      try {
        const params = new URLSearchParams({
          gps_lat: String(coords.lat),
          gps_lng: String(coords.lng),
        });
        const res = await fetch(`/api/hr/ess/checkin?${params}`, { signal: controller.signal });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.location_gate) throw new Error('location preflight failed');
        setLocationGate(json.location_gate as AttendanceLocationGate);
        setLocationGateStatus('ready');
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLocationGate(null);
        setLocationGateStatus('error');
      }
    })();
    return () => controller.abort();
  }, [coords]);

  // Days with a check-IN and no check-OUT that the employee has not filed for yet. While any
  // exists, the check-in controls are replaced by the card that closes it — the server refuses the
  // punch anyway (409 unclosed_day), so showing the button would only produce a dead tap.
  const [openDays, setOpenDays] = useState<OpenDay[]>([]);
  const fetchOpenDays = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/ess/attendance/open-days');
      if (!res.ok) return;
      const json = await res.json();
      const all = (json.data ?? []) as OpenDay[];
      setOpenDays(all.filter((d) => !d.existing_request));
    } catch {
      // Never let this keep the page from rendering — the server gate is the real guard.
    }
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
    fetchOpenDays();
    return () => {
      if (locationWatchRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(locationWatchRef.current);
        locationWatchRef.current = null;
      }
    };
  }, [getLocation, fetchToday, fetchOpenDays]);

  // If the selected punch type has already been recorded today, move to the next unused type.
  useEffect(() => {
    if (usedTypes.has(type)) {
      const next = TYPE_OPTIONS.find((o) => !usedTypes.has(o.value));
      if (next) setType(next.value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

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
    // Mirrored, to match the preview above it. getUserMedia hands over the RAW front-camera frame,
    // which is not what anyone has ever seen of themselves — every phone camera and every video
    // call shows a mirror, so raising your right hand should move the hand on the right. Un-mirrored
    // it reads as the camera being back-to-front (client report 2026-08-26).
    //
    // Mirroring the preview alone would only move the surprise to the saved photo, so the capture
    // is flipped the same way. The transform is reset before the watermark, or the burned-in time
    // and GPS would come out as mirror writing.
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
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
  // Post the punch. GPS is sent only when we have it; a punch with no coords is accepted server-side
  // but held for HR review, and the toast tells the employee it went to HR.
  const doSubmit = useCallback(async () => {
    if (!photo) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/hr/ess/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          ...(coords ? { gps_lat: coords.lat, gps_lng: coords.lng } : {}),
          photo,
          device: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The server refuses a new check-in while a day hangs open. Surfacing the card is more use
        // than the message alone — it is the thing that clears the block.
        if (json?.code === 'unclosed_day') fetchOpenDays();
        if (json?.code === 'outside_geofence_not_allowed') {
          throw new Error(tx(
            'สาขานี้ไม่อนุญาตให้ลงเวลานอกพื้นที่ กรุณาเข้าพื้นที่สาขาแล้วลองอีกครั้ง',
            'This branch does not allow attendance outside its area. Move into the branch area and try again.',
            'ဤဆိုင်ခွဲသည် သတ်မှတ်ဧရိယာပြင်ပမှ အလုပ်ချိန်မှတ်တမ်းတင်ခြင်းကို ခွင့်မပြုပါ။ ဆိုင်ခွဲဧရိယာအတွင်း ဝင်ပြီး ထပ်မံကြိုးစားပါ။',
            'ສາຂານີ້ບໍ່ອະນຸຍາດໃຫ້ລົງເວລານອກພື້ນທີ່ ກະລຸນາເຂົ້າພື້ນທີ່ສາຂາແລ້ວລອງອີກຄັ້ງ'
          ));
        }
        if (json?.code === 'outside_geofence_limit_exceeded') {
          throw new Error(tx(
            `อยู่นอกระยะที่สาขาอนุญาต: ห่าง ${json.distance_m} ม. อนุญาตไม่เกิน ${json.allowed_distance_m} ม. กรุณาเข้าใกล้สาขาแล้วลองอีกครั้ง`,
            `You are beyond the branch limit: ${json.distance_m} m away, maximum ${json.allowed_distance_m} m. Move closer and try again.`,
            `ဆိုင်ခွဲ၏ ခွင့်ပြုအကွာအဝေးကို ကျော်လွန်နေသည်။ အကွာအဝေး ${json.distance_m} မီတာ၊ အများဆုံး ${json.allowed_distance_m} မီတာ။ ဆိုင်ခွဲနှင့် ပိုမိုနီးကပ်စွာ ရွှေ့ပြီး ထပ်မံကြိုးစားပါ။`,
            `ຢູ່ນອກໄລຍະທີ່ສາຂາອະນຸຍາດ: ຫ່າງ ${json.distance_m} ມ. ອະນຸຍາດບໍ່ເກີນ ${json.allowed_distance_m} ມ. ກະລຸນາເຂົ້າໃກ້ສາຂາແລ້ວລອງອີກຄັ້ງ`
          ));
        }
        throw new Error(json?.error || t('failed'));
      }
      const pending = json.review_status === 'pending';
      toast({
        type: pending ? 'warning' : 'success',
        title: !coords
          ? tx(
              'บันทึกแล้ว — ส่งให้ HR ตรวจสอบ (ไม่มีตำแหน่ง GPS)',
              'Saved — sent to HR for review (no GPS)',
              'သိမ်းပြီးပါပြီ — HR စစ်ဆေးရန် ပို့ထားသည် (GPS တည်နေရာ မရှိ)',
              'ບັນທຶກແລ້ວ — ສົ່ງໃຫ້ HR ກວດສອບ (ບໍ່ມີຕຳແໜ່ງ GPS)'
            )
          : pending
            ? t('successPending')
            : json.in_geofence === false
              ? t('successOut')
              : t('success'),
      });
      setPhoto(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await fetchToday();
    } catch (err) {
      toast({ type: 'error', title: err instanceof Error ? err.message : t('failed') });
    } finally {
      setSubmitting(false);
    }
  }, [coords, photo, type, t, tx, fetchToday, fetchOpenDays]);

  const submit = useCallback(() => {
    if (areAttendanceControlsBlocked(locationGateStatus, locationGate)) return;
    if (!photo) {
      toast({ type: 'warning', title: t('needPhoto') });
      return;
    }
    // No GPS → confirm first and warn that HR must review + the employee must explain it.
    if (!coords) {
      setNoGpsOpen(true);
      return;
    }
    void doSubmit();
  }, [photo, coords, doSubmit, t, locationGateStatus, locationGate]);

  // An unresolved open day blocks a new check-in server-side, so the button must not offer one.
  // Closing punches stay allowed: someone mid-shift must always be able to clock OUT.
  const blockedByOpenDay = openDays.length > 0 && type === 'in';
  const locationIsStale = locStatus === 'ready' && coords !== null && locationNow - coords.capturedAt > 30_000;
  const blockedByLocation = areAttendanceControlsBlocked(locationGateStatus, locationGate, !locationIsStale);
  const canSubmit = photo !== null && !submitting && !usedTypes.has(type) && !blockedByOpenDay && !blockedByLocation;

  return (
    <div className="mx-auto max-w-md space-y-5 p-4">
      {/* Header */}
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={<ViewToggle value={view} onChange={setView} />}
      />

      <TileNotices tile="checkin" />

      {openDays.length > 0 && (
        <UnclosedDayCard
          days={openDays}
          onFiled={() => {
            fetchOpenDays();
            fetchToday();
          }}
        />
      )}

      {/* Type selector */}
      <div className="grid grid-cols-2 gap-2">
        {TYPE_OPTIONS.map((opt) => {
          const selected = type === opt.value;
          const used = usedTypes.has(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setType(opt.value)}
              aria-pressed={selected}
              disabled={used || blockedByLocation}
              className={cn(
                'inline-flex items-center justify-center gap-1 rounded-xl border px-3 py-3 text-sm font-semibold transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
                used || blockedByLocation
                  ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500'
                  : selected
                    ? TYPE_TONE[opt.value].selected
                    : TYPE_TONE[opt.value].idle
              )}
            >
              {t(opt.key)}
              {used && <Check className="h-3.5 w-3.5" />}
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
                locationGate?.status === 'blocked' || locationGateStatus === 'error' || locationIsStale
                  ? 'text-red-500'
                  : locationGate?.status === 'outside_pending'
                    ? 'text-amber-500'
                    : locStatus === 'ready' && locationGateStatus === 'ready'
                  ? 'text-emerald-500'
                  : locStatus === 'failed'
                    ? 'text-red-500'
                    : 'text-gray-400'
              )}
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                {locStatus === 'loading' || locationGateStatus === 'loading'
                  ? t('gettingLocation')
                  : locationIsStale
                    ? tx(
                        'ตำแหน่งหมดอายุ กรุณาตรวจใหม่',
                        'Location expired; refresh it',
                        'တည်နေရာ သက်တမ်းကုန်သွားပါပြီ။ ပြန်စစ်ပါ။',
                        'ຕຳແໜ່ງໝົດອາຍຸ ກະລຸນາກວດໃໝ່'
                      )
                  : locationGate?.status === 'blocked'
                    ? tx(
                        'อยู่นอกรัศมีที่อนุญาต',
                        'Outside the allowed radius',
                        'ခွင့်ပြုအချင်းဝက်ပြင်ပတွင် ရှိနေသည်',
                        'ຢູ່ນອກລັດສະໝີທີ່ອະນຸຍາດ'
                      )
                    : locationGateStatus === 'error'
                      ? tx(
                          'ตรวจสอบพื้นที่ลงเวลาไม่ได้',
                          'Could not verify the attendance area',
                          'အလုပ်ချိန်မှတ်တမ်းဧရိယာကို စစ်ဆေး၍မရပါ',
                          'ບໍ່ສາມາດກວດສອບພື້ນທີ່ລົງເວລາໄດ້'
                        )
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

      {locStatus === 'failed' && (
        <p className="-mt-3 flex items-start gap-1.5 px-1 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {tx(
            'ไม่พบตำแหน่ง GPS — ยังบันทึกได้ แต่จะถูกส่งให้ HR ตรวจสอบ และต้องชี้แจงเหตุผลกับ HR',
            'No GPS — you can still save, but it will be sent to HR for review and you must explain it.',
            'GPS တည်နေရာ မတွေ့ပါ — သိမ်း၍ရသေးသည် သို့သော် HR စစ်ဆေးရန် ပို့မည်ဖြစ်ပြီး HR ကို အကြောင်းပြချက် ရှင်းပြရမည်',
            'ບໍ່ພົບຕຳແໜ່ງ GPS — ຍັງບັນທຶກໄດ້ ແຕ່ຈະຖືກສົ່ງໃຫ້ HR ກວດສອບ ແລະ ຕ້ອງຊີ້ແຈງເຫດຜົນກັບ HR'
          )}
        </p>
      )}

      {locationGateStatus === 'error' && (
        <p className="-mt-3 flex items-start gap-1.5 px-1 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {tx(
            'ยังไม่สามารถยืนยันพื้นที่ของคุณได้ ปุ่มลงเวลาถูกปิดไว้ กรุณากดตรวจตำแหน่งใหม่',
            'Your area could not be verified. Attendance buttons are disabled; refresh your location.',
            'သင့်ဧရိယာကို အတည်မပြုနိုင်သေးပါ။ အလုပ်ချိန်မှတ်တမ်းခလုတ်များကို ပိတ်ထားသည်။ တည်နေရာကို ပြန်စစ်ပါ။',
            'ຍັງບໍ່ສາມາດຢືນຢັນພື້ນທີ່ຂອງທ່ານໄດ້ ປຸ່ມລົງເວລາຖືກປິດໄວ້ ກະລຸນາກວດຕຳແໜ່ງໃໝ່'
          )}
        </p>
      )}

      {locationIsStale && (
        <p className="-mt-3 flex items-start gap-1.5 px-1 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {tx(
            'ตำแหน่งล่าสุดเกิน 30 วินาทีแล้ว ปุ่มลงเวลาถูกปิดไว้ กรุณากดตรวจตำแหน่งใหม่',
            'Your last location is over 30 seconds old. Attendance buttons are disabled; refresh your location.',
            'နောက်ဆုံးတည်နေရာသည် စက္ကန့် ၃၀ ကျော်နေပါပြီ။ အလုပ်ချိန်မှတ်တမ်းခလုတ်များကို ပိတ်ထားသည်။ တည်နေရာကို ပြန်စစ်ပါ။',
            'ຕຳແໜ່ງຫຼ້າສຸດເກີນ 30 ວິນາທີແລ້ວ ປຸ່ມລົງເວລາຖືກປິດໄວ້ ກະລຸນາກວດຕຳແໜ່ງໃໝ່'
          )}
        </p>
      )}

      {locationGateStatus === 'ready' && locationGate?.status === 'blocked' && (
        <p className="-mt-3 flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950/30 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {locationGate.code === 'outside_geofence_limit_exceeded'
            ? tx(
                `คุณอยู่นอกพื้นที่อนุโลม ห่าง ${locationGate.distance_m} ม. (อนุญาตไม่เกิน ${locationGate.allowed_distance_m} ม.) จึงไม่สามารถเช็คอินหรือเช็คเอาต์ได้`,
                `You are outside the allowed area at ${locationGate.distance_m} m (maximum ${locationGate.allowed_distance_m} m), so check-in and check-out are disabled.`,
                `သင်သည် ခွင့်ပြုဧရိယာပြင်ပ ${locationGate.distance_m} မီတာတွင် ရှိနေသည် (အများဆုံး ${locationGate.allowed_distance_m} မီတာ) ထို့ကြောင့် အဝင်/အထွက်မှတ်တမ်းတင်၍ မရပါ။`,
                `ທ່ານຢູ່ນອກພື້ນທີ່ອະນຸໂລມ ຫ່າງ ${locationGate.distance_m} ມ. (ສູງສຸດ ${locationGate.allowed_distance_m} ມ.) ຈຶ່ງບໍ່ສາມາດເຊັກອິນ ຫຼື ເຊັກເອົາໄດ້`
              )
            : tx(
                `คุณอยู่นอกรัศมีสาขา ห่าง ${locationGate.distance_m} ม. สาขานี้ไม่อนุญาตให้ลงเวลานอกพื้นที่ จึงไม่สามารถเช็คอินหรือเช็คเอาต์ได้`,
                `You are ${locationGate.distance_m} m outside the branch radius. This branch does not allow outside attendance, so check-in and check-out are disabled.`,
                `သင်သည် ဆိုင်ခွဲအချင်းဝက်ပြင်ပ ${locationGate.distance_m} မီတာတွင် ရှိနေသည်။ ဤဆိုင်ခွဲသည် ပြင်ပမှတ်တမ်းတင်မှုကို ခွင့်မပြုသဖြင့် အဝင်/အထွက်မှတ်တမ်းတင်၍ မရပါ။`,
                `ທ່ານຢູ່ນອກລັດສະໝີສາຂາ ຫ່າງ ${locationGate.distance_m} ມ. ສາຂານີ້ບໍ່ອະນຸຍາດໃຫ້ລົງເວລານອກພື້ນທີ່ ຈຶ່ງບໍ່ສາມາດເຊັກອິນ ຫຼື ເຊັກເອົາໄດ້`
              )}
        </p>
      )}

      {locationGateStatus === 'ready' && locationGate?.status === 'outside_pending' && (
        <p className="-mt-3 flex items-start gap-1.5 px-1 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {tx(
            `อยู่นอกสาขา ${locationGate.distance_m} ม. แต่ยังอยู่ในพื้นที่อนุโลม การลงเวลาจะส่งให้ HR ตรวจสอบทันที`,
            `You are ${locationGate.distance_m} m outside the branch but within its allowance. HR will be notified immediately.`,
            `သင်သည် ဆိုင်ခွဲပြင်ပ ${locationGate.distance_m} မီတာတွင် ရှိသော်လည်း ခွင့်ပြုဧရိယာအတွင်း ဖြစ်သည်။ HR ကို ချက်ချင်း အသိပေးမည်။`,
            `ທ່ານຢູ່ນອກສາຂາ ${locationGate.distance_m} ມ. ແຕ່ຍັງຢູ່ໃນພື້ນທີ່ອະນຸໂລມ ລະບົບຈະແຈ້ງ HR ທັນທີ`
          )}
        </p>
      )}

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
              /* Mirrored — the selfie convention. `capture` flips the canvas to match, so the
                 photo that gets saved is the one the employee was looking at. */
              className="h-full w-full -scale-x-100 object-cover"
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
          <DataList compact={view === 'compact'}>
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

      {/* No-GPS confirmation */}
      <Modal
        isOpen={noGpsOpen}
        onClose={() => setNoGpsOpen(false)}
        title={tx('ไม่พบตำแหน่ง GPS', 'No GPS location', 'GPS တည်နေရာ မတွေ့ပါ', 'ບໍ່ພົບຕຳແໜ່ງ GPS')}
        size="sm"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-900/30">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {tx(
              'ระบบไม่พบตำแหน่ง GPS ของคุณ หากบันทึกต่อ การลงเวลานี้จะถูกส่งให้ HR ตรวจสอบก่อน และคุณจะต้องชี้แจงเหตุผลกับ HR',
              'Your GPS location was not found. If you continue, this punch is sent to HR for review first and you will need to explain the reason to HR.',
              'သင့် GPS တည်နေရာကို ရှာမတွေ့ပါ။ ဆက်သိမ်းလျှင် ဤအချိန်မှတ်တမ်းကို HR အရင် စစ်ဆေးမည်ဖြစ်ပြီး HR ကို အကြောင်းပြချက် ရှင်းပြရမည်',
              'ລະບົບບໍ່ພົບຕຳແໜ່ງ GPS ຂອງທ່ານ ຖ້າບັນທຶກຕໍ່ ການລົງເວລານີ້ຈະຖືກສົ່ງໃຫ້ HR ກວດສອບກ່ອນ ແລະ ທ່ານຕ້ອງຊີ້ແຈງເຫດຜົນກັບ HR'
            )}
          </p>
        </div>
        <ModalFooter>
          <Button variant="outline" onClick={() => setNoGpsOpen(false)} disabled={submitting}>
            {tx('ยกเลิก', 'Cancel', 'ပယ်ဖျက်', 'ຍົກເລີກ')}
          </Button>
          <Button
            onClick={() => {
              setNoGpsOpen(false);
              void doSubmit();
            }}
            isLoading={submitting}
          >
            {tx('บันทึกและส่งให้ HR', 'Save & send to HR', 'သိမ်းပြီး HR သို့ ပို့ရန်', 'ບັນທຶກ ແລະ ສົ່ງໃຫ້ HR')}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
