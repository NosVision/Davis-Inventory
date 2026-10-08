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
} from '@/lib/hr/checkin-diagnostics';

type Tx = ReturnType<typeof useEssText>;

/** What the employee can do about it — shown under the "เปิดกล้องไม่สำเร็จ" toast. */
export function cameraFailureHint(kind: CameraFailureKind, tx: Tx): string {
  switch (kind) {
    case 'denied':
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
