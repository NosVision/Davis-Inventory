'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileText, Loader2, CheckCircle2, Clock } from 'lucide-react';
import {
  Button,
  EmptyState,
  PageHeader,
  StatusBadge,
  DataList,
  DataCard,
  toast,
} from '@/components/ui';
import { PolicyReaderModal, type ReaderPolicy } from '@/components/hr/policy-reader-modal';
import { useEssText } from '@/lib/i18n/ess-locale';
import { formatThaiDateTime } from '@/lib/utils/format';

interface Policy extends ReaderPolicy {
  sort_order: number;
  acked_at?: string | null;
}

// Employee self-service policy list. Every linked employee must READ the company handbook, scroll to
// the bottom, accept, then save — the acknowledgement is stored per version (a version bump forces a
// fresh accept). The reader itself is the shared PolicyReaderModal.
export default function MyPoliciesPage() {
  const tx = useEssText();
  const L = {
    title: tx('ระเบียบบริษัท', 'Company policies', 'ကုမ္ပဏီစည်းမျဉ်း', 'ລະບຽບບໍລິສັດ'),
    subtitle: tx(
      'อ่านและกดยอมรับระเบียบพนักงาน — ระบบจะบันทึกไว้ตามเวอร์ชัน',
      'Read and accept the staff handbook — stored per version',
      'ဝန်ထမ်းစည်းမျဉ်းကို ဖတ်ပြီး လက်ခံပါ — ဗားရှင်းအလိုက် စနစ်က မှတ်ထားမည်',
      'ອ່ານ ແລະ ກົດຍອມຮັບລະບຽບພະນັກງານ — ລະບົບຈະບັນທຶກໄວ້ຕາມເວີຊັນ'
    ),
    empty: tx('ยังไม่มีระเบียบให้อ่าน', 'No policies to read yet', 'ဖတ်ရန် စည်းမျဉ်း မရှိသေးပါ', 'ຍັງບໍ່ມີລະບຽບໃຫ້ອ່ານ'),
    version: tx('เวอร์ชัน', 'Version', 'ဗားရှင်း', 'ເວີຊັນ'),
    acknowledged: tx('ยอมรับแล้ว', 'Accepted', 'လက်ခံပြီးပြီ', 'ຍອມຮັບແລ້ວ'),
    pending: tx('ต้องอ่าน/ยอมรับ', 'Must read & accept', 'ဖတ်/လက်ခံရမည်', 'ຕ້ອງອ່ານ/ຍອມຮັບ'),
    read: tx('อ่านอีกครั้ง', 'Read again', 'ထပ်ဖတ်ရန်', 'ອ່ານອີກຄັ້ງ'),
    acknowledge: tx('อ่านและยอมรับ', 'Read & accept', 'ဖတ်ပြီး လက်ခံရန်', 'ອ່ານ ແລະ ຍອມຮັບ'),
    ackedOn: tx('ยอมรับเมื่อ', 'Accepted on', 'လက်ခံသည့်နေ့', 'ຍອມຮັບເມື່ອ'),
    loadFail: tx('โหลดไม่สำเร็จ', 'Load failed', 'ဖွင့်၍မရပါ', 'ໂຫຼດບໍ່ສຳເລັດ'),
  };

  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Policy | null>(null);

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/ess/policies');
      if (!res.ok) throw new Error('load failed');
      const json = await res.json();
      setPolicies((json.data ?? []) as Policy[]);
    } catch {
      toast({ type: 'error', title: L.loadFail });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  const pendingCount = policies.filter((p) => !p.acked).length;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <PageHeader title={L.title} subtitle={L.subtitle} />

      {!loading && pendingCount > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200">
          <Clock className="h-4 w-4 shrink-0" />
          {tx(
            `มีระเบียบ ${pendingCount} ฉบับที่ต้องอ่านและกดยอมรับ`,
            `${pendingCount} polic${pendingCount > 1 ? 'ies' : 'y'} to read and accept`,
            `ဖတ်ပြီး လက်ခံရမည့် စည်းမျဉ်း ${pendingCount} ခု ရှိသည်`,
            `ມີລະບຽບ ${pendingCount} ສະບັບທີ່ຕ້ອງອ່ານ ແລະ ກົດຍອມຮັບ`
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : policies.length === 0 ? (
        <EmptyState icon={FileText} title={L.empty} />
      ) : (
        <DataList>
          {policies.map((p) => (
            <DataCard
              key={p.id}
              accent={p.acked ? 'good' : 'warn'}
              title={p.title}
              status={
                <StatusBadge
                  tone={p.acked ? 'good' : 'warn'}
                  icon={p.acked ? CheckCircle2 : Clock}
                  label={p.acked ? L.acknowledged : L.pending}
                />
              }
              actions={
                <Button
                  variant={p.acked ? 'outline' : 'primary'}
                  size="sm"
                  onClick={() => setActive(p)}
                >
                  {p.acked ? L.read : L.acknowledge}
                </Button>
              }
            >
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                {p.category ? <span>{p.category}</span> : null}
                <span>· {L.version} {p.version}</span>
                {p.acked && p.acked_at ? (
                  <span>· {L.ackedOn} {formatThaiDateTime(p.acked_at)}</span>
                ) : null}
              </div>
            </DataCard>
          ))}
        </DataList>
      )}

      <PolicyReaderModal
        policy={active}
        onClose={() => setActive(null)}
        onAcked={() => {
          setActive(null);
          fetchPolicies();
        }}
      />
    </div>
  );
}
