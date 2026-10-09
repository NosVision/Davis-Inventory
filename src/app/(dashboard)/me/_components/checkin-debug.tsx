'use client';

import { useEffect, useState } from 'react';
import { Copy, Check, Loader2 } from 'lucide-react';
import { Button, Modal, ModalFooter } from '@/components/ui';
import { useEssText } from '@/lib/i18n/ess-locale';
import {
  buildCheckinDebugReport,
  copyText,
  type CameraFailureKind,
  type CheckinDebugInput,
  type DevicePlatform,
} from '@/lib/hr/checkin-diagnostics';

type Tx = ReturnType<typeof useEssText>;

/** The only way to undo a refused permission in an iPhone home-screen app. */
function iosReinstallSteps(tx: Tx): string {
  return tx(
    'ลบไอคอน DavisManage ออกจากหน้าจอ → เปิดเว็บใน Safari → ปุ่มแชร์ → "เพิ่มไปยังหน้าจอโฮม" → เปิดจากไอคอนใหม่แล้วกด "อนุญาต"',
    'Remove the DavisManage icon from the home screen → open the site in Safari → Share → "Add to Home Screen" → open the new icon and tap "Allow".'
  );
}

/** What the employee can do about it — shown under the "เปิดกล้องไม่สำเร็จ" toast. */
export function cameraFailureHint(kind: CameraFailureKind, tx: Tx, platform: DevicePlatform): string {
  switch (kind) {
    case 'denied':
      if (platform.ios && platform.standalone) {
        return `${tx('แอปบนหน้าจอ iPhone ไม่ได้รับสิทธิ์กล้อง: ', 'The iPhone home-screen app has no camera permission: ')}${iosReinstallSteps(tx)}`;
      }
      if (platform.ios) {
        return tx(
          'ยังไม่ได้อนุญาตกล้อง: ตั้งค่า → Safari → กล้อง → "ถาม" หรือ "อนุญาต" แล้วโหลดหน้านี้ใหม่',
          'Camera not allowed: Settings → Safari → Camera → "Ask" or "Allow", then reload this page.'
        );
      }
      return tx(
        'ยังไม่ได้อนุญาตกล้อง: กดรูปแม่กุญแจข้างช่อง URL → สิทธิ์ → กล้อง → อนุญาต และตรวจในตั้งค่ามือถือ → แอป → Chrome → สิทธิ์ → กล้อง',
        'Camera not allowed: tap the lock icon next to the URL → Permissions → Camera → Allow, and check phone Settings → Apps → Chrome → Permissions → Camera.'
      );
    case 'in_use':
      return tx(
        'กล้องถูกแอปอื่นใช้อยู่ (เช่น LINE, แอปกล้อง, วิดีโอคอล) ให้ปิดแอปนั้นแล้วลองใหม่ ถ้ายังไม่ได้ให้รีสตาร์ทมือถือ',
        'Another app is using the camera (LINE, camera app, video call). Close it and try again; restart the phone if it persists.'
      );
    case 'not_found':
    case 'overconstrained':
      return tx('ไม่พบกล้องที่ใช้ได้บนเครื่องนี้', 'No usable camera was found on this device.');
    case 'insecure':
      return tx('ต้องเปิดผ่านลิงก์ https เท่านั้น', 'The page must be opened over https.');
    case 'unsupported':
      return tx(
        'เบราว์เซอร์นี้ไม่รองรับกล้อง ให้เปิดลิงก์ใน Chrome แทน (ไม่ใช่ในแอป LINE/Facebook)',
        'This browser cannot use the camera. Open the link in Chrome instead of inside LINE/Facebook.'
      );
    case 'timeout':
      return tx(
        'กล้องไม่ตอบสนอง ให้ปิดแอปแล้วเปิดใหม่ หรือรีสตาร์ทมือถือ',
        'The camera did not respond. Close and reopen the app, or restart the phone.'
      );
    case 'no_frames':
      return tx(
        'กล้องเปิดแล้วแต่ไม่มีภาพ ให้กดเปิดกล้องอีกครั้ง หรือปิดแอปที่ใช้กล้องอยู่',
        'The camera opened but shows no picture. Tap open camera again, or close apps using the camera.'
      );
    default:
      return tx(
        'กดปุ่ม "ข้อมูลแจ้งปัญหา" ด้านล่างแล้วคัดลอกส่งให้ HR',
        'Tap "Report info" below and send the copied text to HR.'
      );
  }
}

/** Location refused by the phone (GeolocationPositionError PERMISSION_DENIED). */
export function locationDeniedHint(tx: Tx, platform: DevicePlatform): string {
  const iosLocation = tx(
    'ตั้งค่า → ความเป็นส่วนตัวและความปลอดภัย → บริการหาตำแหน่ง → เว็บไซต์ Safari → "ขณะใช้งาน" และเปิด "ตำแหน่งที่แม่นยำ"',
    'Settings → Privacy & Security → Location Services → Safari Websites → "While Using", with "Precise Location" on.'
  );
  if (platform.ios && platform.standalone) {
    return `${tx('ยังไม่ได้อนุญาตตำแหน่ง: ', 'Location not allowed: ')}${iosLocation} ${tx('ถ้ายังไม่ได้: ', 'If it still fails: ')}${iosReinstallSteps(tx)}`;
  }
  if (platform.ios) return `${tx('ยังไม่ได้อนุญาตตำแหน่ง: ', 'Location not allowed: ')}${iosLocation}`;
  return tx(
    'ยังไม่ได้อนุญาตตำแหน่ง: ตั้งค่ามือถือ → แอป → Chrome → สิทธิ์ → ตำแหน่ง → "อนุญาตขณะใช้แอป" และเปิด "ใช้ตำแหน่งที่แน่นอน"',
    'Location not allowed: phone Settings → Apps → Chrome → Permissions → Location → "Allow while using", with "Use precise location" on.'
  );
}

/**
 * A fix this coarse is the phone's "approximate location" (Android rounds it to ~2 km, iOS to a few
 * km) — moving to a window will not help; only granting precise location does (2026-10-09: a
 * staff member at 24 BLVD read ±2000 m every time and was shown 871 m, then 1,361 m away).
 */
export function approximateLocationHint(tx: Tx, platform: DevicePlatform, accuracyM: number): string {
  const lead = tx(
    `มือถือส่งแค่ตำแหน่งโดยประมาณ (±${accuracyM} ม.) ระยะที่แสดงจึงผิด — `,
    `The phone is only sharing an approximate location (±${accuracyM} m), so the distance shown is wrong — `
  );
  if (platform.ios) {
    return lead + tx(
      'ตั้งค่า → ความเป็นส่วนตัวและความปลอดภัย → บริการหาตำแหน่ง → เว็บไซต์ Safari → เปิด "ตำแหน่งที่แม่นยำ" แล้วกดตรวจตำแหน่งใหม่',
      'Settings → Privacy & Security → Location Services → Safari Websites → turn on "Precise Location", then refresh your location.'
    );
  }
  return lead + tx(
    'ตั้งค่ามือถือ → แอป → Chrome → สิทธิ์ → ตำแหน่ง → เปิด "ใช้ตำแหน่งที่แน่นอน" แล้วกดตรวจตำแหน่งใหม่',
    'phone Settings → Apps → Chrome → Permissions → Location → turn on "Use precise location", then refresh your location.'
  );
}

interface CheckinDebugModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Read when the modal opens, so the report is a snapshot of that moment. */
  getInput: () => CheckinDebugInput;
}

export function CheckinDebugModal({ isOpen, onClose, getInput }: CheckinDebugModalProps) {
  const tx = useEssText();
  const [report, setReport] = useState<string | null>(null);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setReport(null);
    setCopied('idle');
    buildCheckinDebugReport(getInput())
      .then((text) => {
        if (!cancelled) setReport(text);
      })
      .catch((err: unknown) => {
        if (!cancelled) setReport(`report failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    return () => {
      cancelled = true;
    };
    // getInput is read once per opening on purpose — a live-updating report would jump under
    // the employee's thumb while they try to select it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const onCopy = async () => {
    if (!report) return;
    setCopied((await copyText(report)) ? 'ok' : 'failed');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={tx('ข้อมูลแจ้งปัญหา', 'Report info', 'ပြဿနာအချက်အလက်', 'ຂໍ້ມູນແຈ້ງບັນຫາ')}
      size="md"
    >
      <p className="mb-2 text-sm text-gray-600 dark:text-gray-300">
        {tx(
          'กดคัดลอก แล้วส่งข้อความนี้ให้ HR ทาง LINE',
          'Tap copy, then send this text to HR on LINE.',
          'ကူးယူပြီး ဤစာကို HR ထံ LINE ဖြင့် ပို့ပါ။',
          'ກົດສຳເນົາ ແລ້ວສົ່ງຂໍ້ຄວາມນີ້ໃຫ້ HR ທາງ LINE'
        )}
      </p>
      {report === null ? (
        <div className="flex items-center justify-center py-10 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <textarea
          readOnly
          value={report}
          onFocus={(e) => e.currentTarget.select()}
          className="h-72 w-full resize-none rounded-lg border border-gray-200 bg-gray-50 p-2 font-mono text-[11px] leading-snug text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
        />
      )}
      {copied === 'failed' && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          {tx(
            'คัดลอกอัตโนมัติไม่ได้ ให้กดค้างในกล่องข้อความแล้วเลือก "เลือกทั้งหมด" → "คัดลอก"',
            'Automatic copy failed. Long-press the text box, Select all, then Copy.'
          )}
        </p>
      )}
      <ModalFooter>
        <Button variant="outline" onClick={onClose}>
          {tx('ปิด', 'Close', 'ပိတ်ရန်', 'ປິດ')}
        </Button>
        <Button
          onClick={onCopy}
          disabled={report === null}
          icon={copied === 'ok' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        >
          {copied === 'ok'
            ? tx('คัดลอกแล้ว', 'Copied', 'ကူးယူပြီး', 'ສຳເນົາແລ້ວ')
            : tx('คัดลอก', 'Copy', 'ကူးယူရန်', 'ສຳເນົາ')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
