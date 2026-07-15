'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import {
  Share,
  SquarePlus,
  BellRing,
  Settings,
  CheckCircle2,
  Download,
  MoreVertical,
  AlertTriangle,
  Smartphone,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { usePushSubscription } from '@/hooks/use-push-subscription';
import { useInstallPWA } from '@/hooks/use-install-pwa';

// Escape hatch for demos/support: run `localStorage.setItem('pwa-gate-off','1')` in the
// console (or a future admin toggle) to disable the gate on that device.
const BYPASS_KEY = 'pwa-gate-off';

type Platform = 'ios' | 'android' | 'other';

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as Mac — a Mac with touch points is an iPad.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}
function detectInAppBrowser(): boolean {
  return /Line\/|FBAN|FBAV|Instagram|Messenger/i.test(navigator.userAgent);
}
function detectStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

// Mandatory PWA gate for phones/tablets (owner ask 2026-07-15): on iOS/Android the app MUST be
// installed to the home screen, opened from its icon, and have push notifications enabled —
// until then a fullscreen non-dismissible overlay blocks everything. Desktop is exempt
// (HR/admin work happens in a normal browser). The only escape hatches: the BYPASS_KEY above,
// and devices that cannot do web push at all (iOS < 16.4) after showing a warning.
export function PwaGate() {
  const isTh = useLocale() === 'th';
  const [mounted, setMounted] = useState(false);
  const [platform, setPlatform] = useState<Platform>('other');
  const [inApp, setInApp] = useState(false);
  const [standalone, setStandalone] = useState(true);
  const [bypass, setBypass] = useState(true); // assume bypass until proven mobile (no SSR flash)
  const [unsupportedOk, setUnsupportedOk] = useState(false);
  const [subscribeError, setSubscribeError] = useState(false);

  const { isSupported, isSubscribed, isLoading, permission, subscribe } = usePushSubscription();
  const { canInstall, isInstalling, install } = useInstallPWA();
  const [installedNow, setInstalledNow] = useState(false);

  useEffect(() => {
    setMounted(true);
    setPlatform(detectPlatform());
    setInApp(detectInAppBrowser());
    setStandalone(detectStandalone());
    setBypass(localStorage.getItem(BYPASS_KEY) === '1');
    const onInstalled = () => setInstalledNow(true);
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, []);

  // Permission already granted but no live subscription (fresh install, cleared data):
  // finish the subscription silently — no extra tap needed.
  const needsSubscribe = mounted && standalone && isSupported && permission === 'granted' && !isSubscribed;
  useEffect(() => {
    if (!needsSubscribe || isLoading) return;
    subscribe().catch(() => setSubscribeError(true));
  }, [needsSubscribe, isLoading, subscribe]);

  const stage = useMemo<'install' | 'unsupported' | 'denied' | 'notify' | null>(() => {
    if (!mounted || bypass || platform === 'other') return null;
    if (!standalone) return 'install';
    if (!isSupported) return unsupportedOk ? null : 'unsupported';
    if (permission === 'denied') return 'denied';
    if (!isSubscribed) return 'notify';
    return null;
  }, [mounted, bypass, platform, standalone, isSupported, unsupportedOk, permission, isSubscribed]);

  if (!stage) return null;

  const stepDone = (done: boolean) =>
    cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold', done ? 'bg-emerald-500 text-white' : 'bg-teal-600 text-white');

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center overflow-y-auto bg-gray-950/95 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-800">
        {/* progress: 1 install → 2 notifications */}
        <div className="mb-4 flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
          <span className={stepDone(stage !== 'install')}>{stage !== 'install' ? '✓' : '1'}</span>
          {isTh ? 'ติดตั้งแอป' : 'Install app'}
          <span className="h-px flex-1 bg-gray-200 dark:bg-gray-600" />
          <span className={stepDone(false)}>2</span>
          {isTh ? 'เปิดแจ้งเตือน' : 'Notifications'}
        </div>

        {stage === 'install' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400">
                <Smartphone className="h-6 w-6" />
              </div>
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{isTh ? 'ต้องใช้งานผ่านแอปเท่านั้น' : 'App required'}</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {isTh ? 'ติดตั้งลงหน้าจอโฮมแล้วเปิดจากไอคอน เพื่อรับแจ้งเตือนเงินเดือน/ตารางงาน' : 'Install to your home screen and open from the icon to receive payroll/schedule alerts'}
                </p>
              </div>
            </div>

            {inApp && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {isTh
                  ? 'คุณกำลังเปิดจากแอปอื่น (เช่น LINE/Facebook) — กดเมนูมุมขวาบน แล้วเลือก "เปิดในเบราว์เซอร์" ก่อน'
                  : 'You are inside another app (LINE/Facebook). Use its menu → "Open in browser" first.'}
              </div>
            )}

            {installedNow ? (
              <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                {isTh ? 'ติดตั้งแล้ว! ปิดหน้านี้ แล้วเปิดแอปจากไอคอนบนหน้าจอโฮม' : 'Installed! Close this tab and open the app from your home screen icon.'}
              </div>
            ) : platform === 'android' && canInstall ? (
              <button
                type="button"
                onClick={() => install()}
                disabled={isInstalling}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
              >
                {isInstalling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {isTh ? 'ติดตั้งแอปตอนนี้' : 'Install now'}
              </button>
            ) : (
              <ol className="space-y-2.5 text-sm text-gray-700 dark:text-gray-200">
                {platform === 'ios' ? (
                  <>
                    <li className="flex items-center gap-2.5">
                      <span className={stepDone(false)}>1</span>
                      {isTh ? 'กดปุ่มแชร์' : 'Tap the Share button'} <Share className="h-4 w-4 text-sky-500" />
                    </li>
                    <li className="flex items-center gap-2.5">
                      <span className={stepDone(false)}>2</span>
                      {isTh ? 'เลือก "เพิ่มลงหน้าจอโฮม"' : 'Choose "Add to Home Screen"'} <SquarePlus className="h-4 w-4 text-sky-500" />
                    </li>
                    <li className="flex items-center gap-2.5">
                      <span className={stepDone(false)}>3</span>
                      {isTh ? 'เปิดแอปจากไอคอนบนหน้าจอโฮม' : 'Open the app from its icon'}
                    </li>
                  </>
                ) : (
                  <>
                    <li className="flex items-center gap-2.5">
                      <span className={stepDone(false)}>1</span>
                      {isTh ? 'กดเมนู' : 'Open the menu'} <MoreVertical className="h-4 w-4 text-sky-500" />
                      {isTh ? 'มุมขวาบน' : 'top right'}
                    </li>
                    <li className="flex items-center gap-2.5">
                      <span className={stepDone(false)}>2</span>
                      {isTh ? 'เลือก "ติดตั้งแอป" หรือ "เพิ่มลงหน้าจอหลัก"' : 'Choose "Install app" / "Add to Home screen"'}
                    </li>
                    <li className="flex items-center gap-2.5">
                      <span className={stepDone(false)}>3</span>
                      {isTh ? 'เปิดแอปจากไอคอนบนหน้าจอโฮม' : 'Open the app from its icon'}
                    </li>
                  </>
                )}
              </ol>
            )}

            <p className="text-center text-[11px] text-gray-400 dark:text-gray-500">
              {isTh ? 'ติดตั้งไว้แล้ว? ปิดเบราว์เซอร์นี้ แล้วเปิดจากไอคอนแอปแทน' : 'Already installed? Close this browser tab and open from the app icon instead.'}
            </p>
          </div>
        )}

        {stage === 'unsupported' && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {isTh
                ? 'อุปกรณ์นี้ไม่รองรับการแจ้งเตือน (iOS ต้องเวอร์ชัน 16.4 ขึ้นไป) — จะไม่ได้รับแจ้งเตือนเงินเดือน/ตารางงาน'
                : 'This device cannot receive push notifications (iOS 16.4+ required) — you will miss payroll/schedule alerts.'}
            </div>
            <button
              type="button"
              onClick={() => setUnsupportedOk(true)}
              className="inline-flex w-full items-center justify-center rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {isTh ? 'เข้าใจแล้ว ใช้งานต่อ' : 'I understand, continue'}
            </button>
          </div>
        )}

        {stage === 'denied' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
                <Settings className="h-6 w-6" />
              </div>
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{isTh ? 'การแจ้งเตือนถูกปิดอยู่' : 'Notifications are blocked'}</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">{isTh ? 'ต้องเปิดในตั้งค่าเครื่องก่อนจึงใช้งานได้' : 'Enable them in your device settings to continue'}</p>
              </div>
            </div>
            <ol className="space-y-2 text-sm text-gray-700 dark:text-gray-200">
              {platform === 'ios' ? (
                <>
                  <li>1. {isTh ? 'เปิด "การตั้งค่า" ของเครื่อง' : 'Open iOS Settings'}</li>
                  <li>2. {isTh ? 'เลื่อนหาแอปนี้ → การแจ้งเตือน' : 'Find this app → Notifications'}</li>
                  <li>3. {isTh ? 'เปิด "อนุญาตการแจ้งเตือน" แล้วกลับมาที่แอป' : 'Turn on "Allow Notifications" and return here'}</li>
                </>
              ) : (
                <>
                  <li>1. {isTh ? 'เปิด "ตั้งค่า" → แอป → แอปนี้' : 'Open Settings → Apps → this app'}</li>
                  <li>2. {isTh ? 'การแจ้งเตือน → อนุญาต' : 'Notifications → Allow'}</li>
                  <li>3. {isTh ? 'กลับมาที่แอปนี้อีกครั้ง' : 'Return to this app'}</li>
                </>
              )}
            </ol>
            <p className="text-center text-[11px] text-gray-400">{isTh ? 'หน้านี้จะหายไปเองเมื่อเปิดแจ้งเตือนแล้ว' : 'This screen disappears once notifications are enabled.'}</p>
          </div>
        )}

        {stage === 'notify' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400">
                <BellRing className="h-6 w-6" />
              </div>
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{isTh ? 'เปิดการแจ้งเตือน' : 'Enable notifications'}</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {isTh ? 'สลิปเงินเดือน ตารางงาน ผลคำขอลา และประกาศ จะแจ้งผ่านที่นี่' : 'Payslips, schedules, leave results and announcements arrive here'}
                </p>
              </div>
            </div>
            {subscribeError && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-900/20 dark:text-rose-400">
                {isTh ? 'เปิดไม่สำเร็จ ลองใหม่อีกครั้ง' : 'Failed to enable — please try again'}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                setSubscribeError(false);
                subscribe().catch(() => setSubscribeError(true));
              }}
              disabled={isLoading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
              {isTh ? 'เปิดการแจ้งเตือน' : 'Enable notifications'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
