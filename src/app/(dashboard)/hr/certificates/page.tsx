'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Loader2, FileText, Download } from 'lucide-react';
import { Button, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

// §J9 P5.2 — HR issues หนังสือรับรองการทำงาน/เงินเดือน on request. Pick company → employee →
// salary toggle → generate a Thai PDF (react-pdf, lazy-loaded). Self-contained locale strings.
interface Company { id: string; name: string; address: string | null }
interface EmployeeRow {
  profile_id: string;
  rate_satang: number;
  pay_type: string;
  start_date: string | null;
  profile: { display_name: string | null; username: string | null } | null;
  position: { name: string | null } | null;
  company: { name: string | null } | null;
}

const inputCls =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
function toThaiDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}
const nameOf = (p: EmployeeRow['profile']) => p?.display_name || p?.username || '—';

export default function HrCertificatesPage() {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'ออกหนังสือรับรอง', subtitle: 'หนังสือรับรองการทำงาน / เงินเดือน (ออกเป็น PDF)', company: 'บริษัท', employee: 'พนักงาน', pick: '—', withSalary: 'รวมเงินเดือน (หนังสือรับรองเงินเดือน)', issuer: 'ผู้ลงนาม', issuerRole: 'ตำแหน่งผู้ลงนาม', issuerPh: 'ชื่อผู้มีอำนาจลงนาม', rolePh: 'เช่น ผู้จัดการฝ่ายบุคคล', generate: 'ออก PDF', loadFailed: 'โหลดไม่สำเร็จ', pickEmp: 'เลือกพนักงานก่อน', done: 'สร้าง PDF แล้ว', genFailed: 'สร้าง PDF ไม่สำเร็จ', fullTime: 'พนักงานประจำ', partTime: 'พนักงานพาร์ทไทม์', perMonth: 'บาท/เดือน', perDay: 'บาท/วัน', perHour: 'บาท/ชั่วโมง' }
    : { title: 'Issue certificate', subtitle: 'Work / salary certificate (PDF)', company: 'Company', employee: 'Employee', pick: '—', withSalary: 'Include salary (salary certificate)', issuer: 'Signatory', issuerRole: 'Signatory title', issuerPh: 'Authorized signatory name', rolePh: 'e.g. HR Manager', generate: 'Generate PDF', loadFailed: 'Load failed', pickEmp: 'Pick an employee first', done: 'PDF created', genFailed: 'PDF generation failed', fullTime: 'Full-time employee', partTime: 'Part-time employee', perMonth: 'THB/month', perDay: 'THB/day', perHour: 'THB/hour' };

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [profileId, setProfileId] = useState('');
  const [withSalary, setWithSalary] = useState(false);
  const [issuerName, setIssuerName] = useState('');
  const [issuerRole, setIssuerRole] = useState(isTh ? 'ผู้จัดการฝ่ายบุคคล' : 'HR Manager');
  const [loadingEmp, setLoadingEmp] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/companies');
        setCompanies(((await res.json()).data ?? []) as Company[]);
      } catch { toast({ type: 'error', title: L.loadFailed }); }
    })();
  }, [L.loadFailed]);

  const loadEmployees = useCallback(async (cid: string) => {
    setProfileId('');
    if (!cid) { setEmployees([]); return; }
    setLoadingEmp(true);
    try {
      const res = await fetch(`/api/hr/employees?company_id=${cid}&status=active&limit=200`);
      setEmployees(((await res.json()).data ?? []) as EmployeeRow[]);
    } catch { toast({ type: 'error', title: L.loadFailed }); }
    finally { setLoadingEmp(false); }
  }, [L.loadFailed]);

  useEffect(() => { loadEmployees(companyId); }, [companyId, loadEmployees]);

  const salaryLabel = (e: EmployeeRow): string => {
    const baht = (e.rate_satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const unit = e.pay_type === 'daily' ? L.perDay : e.pay_type === 'hourly' ? L.perHour : L.perMonth;
    return `${baht} ${unit}`;
  };

  const generate = async () => {
    const emp = employees.find((e) => e.profile_id === profileId);
    const company = companies.find((c) => c.id === companyId);
    if (!emp || !company) { toast({ type: 'warning', title: L.pickEmp }); return; }
    setGenerating(true);
    try {
      const { buildHrCertificatePdf, downloadBlob } = await import('./_components/hr-certificate-pdf');
      const now = new Date();
      const isoToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const docNo = `HR-CERT-${isoToday.replace(/-/g, '')}-${emp.profile_id.slice(0, 4).toUpperCase()}`;
      const blob = await buildHrCertificatePdf({
        doc_no: docNo,
        issue_date_label: toThaiDate(isoToday),
        company_name: company.name,
        company_address: company.address,
        employee_name: nameOf(emp.profile),
        position_name: emp.position?.name ?? null,
        start_date_label: emp.start_date ? toThaiDate(emp.start_date) : null,
        employment_type_label: emp.pay_type === 'monthly' ? L.fullTime : L.partTime,
        with_salary: withSalary,
        salary_label: withSalary ? salaryLabel(emp) : null,
        issuer_name: issuerName.trim() || '—',
        issuer_role: issuerRole.trim() || (isTh ? 'ฝ่ายบุคคล' : 'HR'),
      });
      downloadBlob(blob, `${docNo}.pdf`);
      toast({ type: 'success', title: L.done });
    } catch {
      toast({ type: 'error', title: L.genFailed });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">{L.title}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{L.subtitle}</p>
      </div>

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.company}
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={cn('mt-1', inputCls)}>
              <option value="">{L.pick}</option>
              {companies.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </label>
          <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.employee}
            <select value={profileId} onChange={(e) => setProfileId(e.target.value)} disabled={!companyId || loadingEmp} className={cn('mt-1', inputCls)}>
              <option value="">{L.pick}</option>
              {employees.map((e) => (<option key={e.profile_id} value={e.profile_id}>{nameOf(e.profile)}</option>))}
            </select>
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={withSalary} onChange={(e) => setWithSalary(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
          {L.withSalary}
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.issuer}
            <input type="text" value={issuerName} onChange={(e) => setIssuerName(e.target.value)} placeholder={L.issuerPh} className={cn('mt-1', inputCls)} />
          </label>
          <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.issuerRole}
            <input type="text" value={issuerRole} onChange={(e) => setIssuerRole(e.target.value)} placeholder={L.rolePh} className={cn('mt-1', inputCls)} />
          </label>
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={generate} isLoading={generating} disabled={!profileId || generating} icon={<Download className="h-4 w-4" />}>
            {loadingEmp ? <Loader2 className="h-4 w-4 animate-spin" /> : L.generate}
          </Button>
        </div>
      </section>

      <p className="flex items-center gap-1.5 text-xs text-gray-400">
        <FileText className="h-3.5 w-3.5" /> {L.subtitle}
      </p>
    </div>
  );
}
