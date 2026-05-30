'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, Button, toast } from '@/components/ui';
import {
  ArrowLeft,
  BookOpen,
  Store,
  MessageCircle,
  SlidersHorizontal,
  Sparkles,
  Rocket,
  ClipboardCheck,
  Copy,
  Check,
  ExternalLink,
  AlertTriangle,
  Lightbulb,
  LayoutGrid,
  Smartphone,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Small presentational helpers (kept local — this is a one-off guide page)
// ---------------------------------------------------------------------------

function StepCard({
  n,
  icon,
  title,
  children,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card padding="none">
      <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-700/50">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-sm font-bold text-white shadow-sm">
          {n}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-indigo-600 dark:text-indigo-400">{icon}</span>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
        </div>
      </div>
      <CardContent className="space-y-3 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
        {children}
      </CardContent>
    </Card>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div>{children}</div>
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-800 dark:border-blue-800/50 dark:bg-blue-900/20 dark:text-blue-300">
      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
      <div>{children}</div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[0.8em] text-gray-800 dark:bg-gray-800 dark:text-gray-200">
      {children}
    </code>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BranchSetupGuidePage() {
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  const webhookUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/api/line/webhook` : '/api/line/webhook';

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ type: 'error', title: 'คัดลอกไม่สำเร็จ' });
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-16">
      {/* Back + Title */}
      <div>
        <button
          onClick={() => router.push('/settings')}
          className="mb-3 flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ArrowLeft className="h-4 w-4" />
          กลับ
        </button>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-sm">
            <BookOpen className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">คู่มือการเพิ่มสาขาใหม่</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              ตั้งค่า LINE OA · Messaging API · LIFF ทีละขั้นตามลำดับ
            </p>
          </div>
        </div>
      </div>

      {/* Why each branch needs its own LINE OA */}
      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800/50 dark:bg-indigo-900/20">
        <p className="text-sm font-medium text-indigo-900 dark:text-indigo-200">
          ทำไมแต่ละสาขาต้องมี LINE OA แยกของตัวเอง
        </p>
        <p className="mt-1 text-xs leading-relaxed text-indigo-700 dark:text-indigo-300">
          LINE สร้าง <strong>userId ของลูกค้าตาม Provider</strong> ที่เป็นเจ้าของบัญชี — ถ้าใช้ LINE OA
          ร่วมกันหลายสาขา ข้อมูลฝากเหล้าของลูกค้าจะข้ามสาขากันมั่ว ดังนั้นแต่ละสาขาต้องมี
          <strong> LINE OA + Messaging API + LIFF เป็นของตัวเอง</strong> แล้วนำค่ามากรอกที่หน้าตั้งค่าสาขานั้น
          ทำตาม 6 ขั้นด้านล่าง <strong>เรียงตามลำดับ</strong> จะตั้งค่าได้ครบในรอบเดียว
        </p>
      </div>

      {/* Step 1 — Create LINE OA */}
      <StepCard n={1} icon={<Store className="h-4 w-4" />} title="สร้าง LINE Official Account (LINE OA)">
        <ol className="ml-4 list-decimal space-y-1.5">
          <li>
            เข้า <Code>LINE Official Account Manager</Code> ที่{' '}
            <a
              href="https://manager.line.biz"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 font-medium text-indigo-600 underline decoration-dotted underline-offset-2 dark:text-indigo-400"
            >
              manager.line.biz <ExternalLink className="h-3 w-3" />
            </a>{' '}
            แล้วล็อกอินด้วยบัญชี LINE Business
          </li>
          <li>กด <strong>สร้างบัญชีใหม่ (Create)</strong> → ตั้งชื่อ OA เป็นชื่อสาขา + ใส่รูปโปรไฟล์</li>
          <li>เลือกประเภทธุรกิจ → ยืนยัน จะได้ LINE OA ของสาขาใหม่</li>
        </ol>
        <Tip>
          แนะนำตั้งชื่อ OA ให้มีชื่อสาขาชัดเจน เช่น <Code>ร้านเหล้า — สาขาสุขุมวิท</Code> จะได้ไม่สับสนเวลามีหลายสาขา
        </Tip>
      </StepCard>

      {/* Step 2 — Enable Messaging API (MUST start from OA Manager) */}
      <StepCard
        n={2}
        icon={<SlidersHorizontal className="h-4 w-4" />}
        title="เปิดใช้ Messaging API (เริ่มจากเมนูตั้งค่าใน LINE OA ก่อน)"
      >
        <p>
          จุดที่คนพลาดบ่อยที่สุด: <strong>ห้ามเข้า LINE Developers Console ตรง ๆ</strong> ให้เปิดผ่าน
          LINE OA Manager ก่อน ระบบจะผูก Provider/Channel ให้ถูกต้องอัตโนมัติ
        </p>
        <ol className="ml-4 list-decimal space-y-1.5">
          <li>
            ใน LINE OA Manager (ของสาขาที่เพิ่งสร้าง) → ไปที่เมนู <strong>ตั้งค่า (Settings)</strong> ที่มุมขวาบน
          </li>
          <li>
            เลือกหัวข้อ <strong>Messaging API</strong> ในเมนูด้านซ้าย
          </li>
          <li>
            กด <strong>เปิดใช้ Messaging API (Enable / Use Messaging API)</strong>
          </li>
          <li>
            เลือก <strong>Provider</strong> — แนะนำ <strong>สร้าง Provider ใหม่แยกต่อสาขา/แบรนด์</strong>{' '}
            (เพราะ userId ผูกกับ Provider)
          </li>
          <li>ยอมรับเงื่อนไข → ยืนยัน ระบบจะสร้าง Messaging API channel ให้อัตโนมัติ</li>
          <li>
            เสร็จแล้วหน้านี้จะมีลิงก์ <strong>LINE Developers Console</strong> ให้กดไปตั้งค่าต่อ (ไปขั้นที่ 3)
          </li>
        </ol>
        <Warn>
          ถ้าเข้า Developers Console เองโดยไม่ผ่าน OA Manager จะได้ channel ที่ <strong>ไม่ผูกกับ LINE OA</strong>{' '}
          ของสาขา ทำให้บอทส่ง/รับข้อความไม่ได้ — ต้องเริ่มจากปุ่ม Enable ใน OA Manager เท่านั้น
        </Warn>
      </StepCard>

      {/* Step 3 — Configure in Developers Console + Webhook */}
      <StepCard
        n={3}
        icon={<MessageCircle className="h-4 w-4" />}
        title="ตั้งค่าใน LINE Developers Console + Webhook"
      >
        <p>
          เปิด channel ที่เพิ่งถูกสร้างใน{' '}
          <a
            href="https://developers.line.biz/console/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-indigo-600 underline decoration-dotted underline-offset-2 dark:text-indigo-400"
          >
            developers.line.biz <ExternalLink className="h-3 w-3" />
          </a>
        </p>
        <p className="font-medium text-gray-900 dark:text-white">แท็บ Basic settings:</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>คัดลอก <strong>Channel ID</strong></li>
          <li>คัดลอก <strong>Channel secret</strong></li>
        </ul>
        <p className="font-medium text-gray-900 dark:text-white">แท็บ Messaging API:</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            ที่ <strong>Channel access token (long-lived)</strong> → กด <strong>Issue</strong> → คัดลอกไว้
          </li>
          <li>
            ที่ <strong>Webhook URL</strong> → วาง URL นี้ → กด <strong>Update</strong> → กด <strong>Verify</strong>{' '}
            (ต้องขึ้น Success / 200)
          </li>
          <li>เปิดสวิตช์ <strong>Use webhook</strong> ให้เป็น Enabled</li>
          <li>
            ปิด <strong>Auto-reply messages</strong> และ <strong>Greeting messages</strong>{' '}
            (กันบอท LINE ตอบซ้อนกับระบบ)
          </li>
        </ul>

        {/* Webhook URL copy box */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Webhook URL ของระบบ (คัดลอกไปวาง):</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-gray-100 px-3 py-2.5 text-xs text-gray-800 dark:bg-gray-800 dark:text-gray-200">
              {webhookUrl}
            </code>
            <button
              onClick={copyWebhook}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" /> คัดลอกแล้ว
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" /> คัดลอก
                </>
              )}
            </button>
          </div>
        </div>

        <Warn>
          ระวังพิมพ์ผิด! Webhook URL ต้องเป็น <Code>/api/line/webhook</Code> (ขีด <strong>/</strong> คั่น){' '}
          <strong>ไม่ใช่</strong> <Code>/api/line-webhook</Code> (ขีดกลาง <strong>-</strong>) — ถ้าพิมพ์เป็นขีดกลาง
          กด Verify จะขึ้น <strong>404 ไม่พบ</strong> ทันที ให้กดปุ่ม &quot;คัดลอก&quot; ด้านบนแล้ววางจะปลอดภัยสุด
        </Warn>
      </StepCard>

      {/* Step 4 — Create LIFF */}
      <StepCard n={4} icon={<Sparkles className="h-4 w-4" />} title="สร้าง LIFF app">
        <p>
          LIFF คือหน้าเว็บของระบบที่เปิดในแอป LINE ให้ลูกค้าฝาก/ดูเหล้า — สร้างไว้ใต้ Provider เดียวกับ LINE OA ของสาขา
        </p>
        <ol className="ml-4 list-decimal space-y-1.5">
          <li>
            ก่อนอื่น เปิดหน้า <strong>ตั้งค่า → สาขา → [สาขาใหม่]</strong> ในระบบนี้ แล้วคัดลอกค่าในช่อง{' '}
            <strong>&quot;Endpoint URL ของ LIFF&quot;</strong> เตรียมไว้
          </li>
          <li>
            ใน LINE Developers Console → เปิด channel → แท็บ <strong>LIFF</strong> → กด <strong>Add</strong>
          </li>
          <li>
            ตั้งค่า LIFF:
            <ul className="ml-4 mt-1 list-disc space-y-1">
              <li>
                <strong>LIFF app name</strong>: เช่น ระบบฝากเหล้า
              </li>
              <li>
                <strong>Size</strong>: เลือก <strong>Full</strong>
              </li>
              <li>
                <strong>Endpoint URL</strong>: วางค่าที่คัดลอกจากหน้าตั้งค่าสาขา (ข้อ 1)
              </li>
              <li>
                <strong>Scopes</strong>: ติ๊ก <Code>profile</Code> และ <Code>openid</Code>
              </li>
              <li>เปิด <strong>Add friend option</strong> ตามต้องการ</li>
            </ul>
          </li>
          <li>
            กด <strong>Add</strong> → คัดลอก <strong>LIFF ID</strong> (รูปแบบ <Code>1234567890-abcdEFgh</Code>)
          </li>
        </ol>
        <Tip>
          ถ้าหา LIFF ในแท็บของ Messaging API channel ไม่เจอ ให้สร้าง <strong>LINE Login channel</strong>{' '}
          ภายใต้ Provider เดียวกัน แล้วเพิ่ม LIFF ในนั้น (LINE Login เป็น channel ที่ถือ LIFF)
        </Tip>
      </StepCard>

      {/* Step 5 — Publish */}
      <StepCard n={5} icon={<Rocket className="h-4 w-4" />} title="เปลี่ยนสถานะจาก Developing → Published">
        <p>
          LINE Login channel (ที่ถือ LIFF) ตอนสร้างใหม่จะอยู่สถานะ <strong>Developing</strong> — โหมดนี้
          <strong> เฉพาะ admin/tester</strong> เท่านั้นที่เปิด LIFF ได้ ลูกค้าทั่วไปจะเปิดไม่ได้
        </p>
        <ol className="ml-4 list-decimal space-y-1.5">
          <li>เปิด LINE Login channel นั้นใน Developers Console</li>
          <li>
            ดูแถบสถานะด้านบน (ใกล้ชื่อ channel) ที่เขียนว่า <strong>Developing</strong>
          </li>
          <li>
            กดสวิตช์/ปุ่มเพื่อเปลี่ยนเป็น <strong>Published</strong> แล้วยืนยัน
          </li>
        </ol>
        <Warn>
          ถ้าลืม Publish ลูกค้าจะกดลิงก์ฝากเหล้าแล้วเจอหน้าเปล่า/ขออนุญาตไม่ผ่าน — เปิด LIFF ได้แค่บัญชีที่เป็น tester เท่านั้น
        </Warn>
        <Tip>
          Scope <Code>profile</Code> + <Code>openid</Code> Publish ได้ทันทีไม่ต้องรอ review — ถ้าเพิ่ม scope พิเศษ
          (เช่น email) อาจต้องกรอกข้อมูลให้ LINE ตรวจก่อน
        </Tip>
      </StepCard>

      {/* Step 6 — Fill values into the app */}
      <StepCard n={6} icon={<ClipboardCheck className="h-4 w-4" />} title="กรอกค่าทั้งหมดลงในระบบ (หน้าตั้งค่าสาขา)">
        <p>
          กลับมาที่ <strong>ตั้งค่า → สาขา → [สาขาใหม่]</strong> → ส่วน <strong>LINE OA ของสาขา</strong>{' '}
          แล้วกรอกค่าที่คัดลอกไว้:
        </p>
        <ol className="ml-4 list-decimal space-y-1.5">
          <li>วาง <strong>Channel ID</strong> (จากขั้น 3)</li>
          <li>วาง <strong>Channel Access Token</strong> (จากขั้น 3)</li>
          <li>วาง <strong>Channel Secret</strong> (จากขั้น 3)</li>
          <li>
            กดปุ่ม <strong>&quot;ดึงจาก LINE&quot;</strong> ระบบจะดึง <strong>Bot User ID</strong> มาให้อัตโนมัติ
          </li>
          <li>วาง <strong>LIFF ID</strong> (จากขั้น 4)</li>
          <li>
            (ถ้ามี) ตั้ง <strong>Group ID</strong> แจ้งเตือน — เชิญบอทเข้ากลุ่ม LINE พนักงานแล้วพิมพ์{' '}
            <Code>groupid</Code> ในกลุ่ม บอทจะตอบ Group ID กลับมา
          </li>
          <li>
            กด <strong>บันทึก</strong>
          </li>
        </ol>
        <Warn>
          <strong>Bot User ID สำคัญมาก</strong> — ระบบใช้ค่านี้จับคู่ว่า webhook ที่เข้ามาเป็นของสาขาไหน
          ถ้าไม่ได้บันทึก เวลา LINE กด Verify จะหาไม่เจอแล้วขึ้น 404 ฉะนั้นอย่าลืมกด &quot;ดึงจาก LINE&quot; แล้วบันทึกก่อน
        </Warn>
      </StepCard>

      {/* Step 7 — Rich Menu */}
      <StepCard n={7} icon={<LayoutGrid className="h-4 w-4" />} title="เปิดใช้งาน Rich Menu + ตั้งปุ่มฝากเหล้า">
        <p>
          Rich Menu คือเมนูรูปภาพที่อยู่ด้านล่างหน้าแชทของ LINE OA — ให้ลูกค้าแตะเข้าระบบฝากเหล้าได้ทันที
          ตั้งค่าที่ <strong>LINE OA Manager</strong> (ไม่ใช่ Developers Console)
        </p>
        <ol className="ml-4 list-decimal space-y-1.5">
          <li>
            เข้า{' '}
            <a
              href="https://manager.line.biz"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 font-medium text-indigo-600 underline decoration-dotted underline-offset-2 dark:text-indigo-400"
            >
              LINE OA Manager <ExternalLink className="h-3 w-3" />
            </a>{' '}
            → เลือก OA ของสาขา → เมนู <strong>ริชเมนู (Rich menus)</strong>
          </li>
          <li>กด <strong>สร้างใหม่</strong> → ตั้งชื่อ, ช่วงเวลาแสดงผล, เลือกเทมเพลต layout แล้วอัปโหลดรูปเมนู</li>
          <li>
            ที่ช่องปุ่ม <strong>&quot;ระบบฝากเหล้า&quot;</strong> → ตั้ง <strong>Action</strong> เป็น{' '}
            <strong>ข้อความ (Text)</strong> → พิมพ์ข้อความให้ส่งเป็น <Code>alcohol deposit</Code>
          </li>
          <li>ตั้งค่าปุ่มอื่น ๆ ตามต้องการ → <strong>บันทึก</strong> → กด <strong>เปิดใช้งาน / แสดงผล</strong> ริชเมนู</li>
        </ol>
        <Warn>
          ปุ่มฝากเหล้าต้องตั้งให้ส่งข้อความ <Code>alcohol deposit</Code> เป๊ะ ๆ — เพราะบอทจับคีย์เวิร์ดนี้แล้วเปิดระบบฝากเหล้าให้
          (จะใช้คำอื่นที่บอทรองรับก็ได้ เช่น <Code>ฝากเหล้า</Code> · <Code>deposit</Code> · <Code>เมนู</Code> —
          ดูคำสั่งทั้งหมดที่หน้า ตั้งค่า → DAVIS Ai → คำสั่งที่รองรับ)
        </Warn>

        {/* Test callout */}
        <div className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-900/20 dark:text-emerald-200">
          <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <strong>ทดสอบ:</strong> เปิดแชท LINE OA ของสาขา → แตะปุ่ม <strong>&quot;ระบบฝากเหล้า&quot;</strong> ในริชเมนู →
            บอทต้องตอบกลับเป็น <strong>Flex message</strong> พร้อมปุ่ม{' '}
            <Code>📱 Open Bottle Keeper</Code> → แตะแล้วเปิดหน้า LIFF ฝากเหล้าได้ = ตั้งค่าครบถูกต้อง 🎉
          </div>
        </div>
      </StepCard>

      {/* Final checklist */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800/50 dark:bg-emerald-900/20">
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900 dark:text-emerald-200">
          <ClipboardCheck className="h-4 w-4" /> เช็กลิสต์ก่อนถือว่าเสร็จ
        </p>
        <ul className="mt-2 ml-1 space-y-1.5 text-xs text-emerald-800 dark:text-emerald-300">
          <li>☐ เปิด Messaging API ผ่าน LINE OA Manager (ไม่ใช่เข้า Console ตรง)</li>
          <li>☐ Webhook URL เป็น <Code>/api/line/webhook</Code> (slash) + กด Verify ขึ้น Success</li>
          <li>☐ Use webhook = Enabled · ปิด Auto-reply / Greeting</li>
          <li>☐ สร้าง LIFF + ตั้ง Endpoint URL จากหน้าตั้งค่าสาขา</li>
          <li>☐ เปลี่ยน LINE Login channel เป็น Published</li>
          <li>☐ กรอก Channel ID / Token / Secret / LIFF ID + กด &quot;ดึงจาก LINE&quot; (Bot User ID) แล้วบันทึก</li>
          <li>☐ เปิด Rich Menu + ปุ่มฝากเหล้าตั้ง Action ส่งข้อความ <Code>alcohol deposit</Code></li>
          <li>☐ ทดลองแตะปุ่มฝากเหล้า → ขึ้น Flex message ปุ่ม &quot;📱 Open Bottle Keeper&quot; → แตะเปิด LIFF ได้</li>
        </ul>
        <Button
          variant="primary"
          className="mt-4 w-full"
          icon={<Store className="h-4 w-4" />}
          onClick={() => router.push('/settings')}
        >
          ไปหน้าตั้งค่าสาขา
        </Button>
      </div>
    </div>
  );
}
