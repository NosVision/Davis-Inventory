'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Loader2, FileText, Download } from 'lucide-react';
import { Button, PageHeader, toast } from '@/components/ui';
import { bahtText } from '@/lib/hr/baht-text';

// §J9 P5.2 — HR issues หนังสือรับรองการทำงาน/เงินเดือน on request. Pick company → employee →
// certificate type → generate a Thai PDF (react-pdf, lazy-loaded). Self-contained locale strings.
// The dropdown shows the employee's REAL full name (hr_employees.full_name), not the login name.
interface Company { id: string; name: string; name_en: string | null; address: string | null; phone: string | null }
interface EmployeeRow {
  profile_id: string;
  full_name: string | null;
  rate_satang: number;
  pay_type: string;
  start_date: string | null;
  profile: { display_name: string | null; username: string | null } | null;
  position: { name: string | null } | null;
  company: { name: string | null } | null;
}

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
function toThaiDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}
// legacy body format: "วันที่ 1 เดือน เมษายน พ.ศ. 2568"
function toThaiDateFormal(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `วันที่ ${d.getDate()} เดือน ${TH_MONTHS[d.getMonth()]} พ.ศ. ${d.getFullYear() + 543}`;
}
const nameOf = (e: EmployeeRow) => e.full_name || e.profile?.display_name || e.profile?.username || '—';

export default function HrCertificatesPage() {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'ออกหนังสือรับรอง', subtitle: 'หนังสือรับรองการทำงาน / เงินเดือน (ออกเป็น PDF)', company: 'บริษัท', employee: 'พนักงาน', pick: '—', certType: 'ประเภทหนังสือรับรอง', typeWork: 'หนังสือรับรองการทำงาน', typeSalary: 'หนังสือรับรองเงินเดือน', issuer: 'ผู้ลงนาม', issuerRole: 'ตำแหน่งผู้ลงนาม', issuerPh: 'ชื่อผู้มีอำนาจลงนาม', rolePh: 'เช่น ฝ่ายทรัพยากรบุคคล', generate: 'ออก PDF', loadFailed: 'โหลดไม่สำเร็จ', pickEmp: 'เลือกพนักงานก่อน', done: 'สร้าง PDF แล้ว', genFailed: 'สร้าง PDF ไม่สำเร็จ', fullTime: 'พนักงานประจำ', partTime: 'พนักงานพาร์ทไทม์', perMonth: 'เดือนละ', perDay: 'วันละ', perHour: 'ชั่วโมงละ' }
    : { title: 'Issue certificate', subtitle: 'Work / salary certificate (PDF)', company: 'Company', employee: 'Employee', pick: '—', certType: 'Certificate type', typeWork: 'Work certificate', typeSalary: 'Salary certificate', issuer: 'Signatory', issuerRole: 'Signatory title', issuerPh: 'Authorized signatory name', rolePh: 'e.g. Human Resources', generate: 'Generate PDF', loadFailed: 'Load failed', pickEmp: 'Pick an employee first', done: 'PDF created', genFailed: 'PDF generation failed', fullTime: 'Full-time employee', partTime: 'Part-time employee', perMonth: 'เดือนละ', perDay: 'วันละ', perHour: 'ชั่วโมงละ' };

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [profileId, setProfileId] = useState('');
  const [certType, setCertType] = useState<'work' | 'salary'>('work');
  const [issuerName, setIssuerName] = useState('');
  const [issuerRole, setIssuerRole] = useState('ฝ่ายทรัพยากรบุคคล');
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

  const generate = async () => {
    const emp = employees.find((e) => e.profile_id === profileId);
    const company = companies.find((c) => c.id === companyId);
    if (!emp || !company) { toast({ type: 'warning', title: L.pickEmp }); return; }
    const withSalary = certType === 'salary';
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
        company_name_en: company.name_en,
        company_address: company.address,
        company_phone: company.phone,
        employee_name: nameOf(emp),
        position_name: emp.position?.name ?? null,
        start_date_label: emp.start_date ? toThaiDateFormal(emp.start_date) : null,
        employment_type_label: emp.pay_type === 'monthly' ? L.fullTime : L.partTime,
        with_salary: withSalary,
        salary_period_word: emp.pay_type === 'daily' ? L.perDay : emp.pay_type === 'hourly' ? L.perHour : L.perMonth,
        salary_number: withSalary
          ? (emp.rate_satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : null,
        salary_words: withSalary ? bahtText(emp.rate_satang) : null,
        issuer_name: issuerName.trim() || '—',
        issuer_role: issuerRole.trim() || 'ฝ่ายทรัพยากรบุคคล',
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
      <PageHeader title={L.title} subtitle={L.subtitle} />

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.company}
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="control mt-1">
              <option value="">{L.pick}</option>
              {companies.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </label>
          <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.employee}
            <select value={profileId} onChange={(e) => setProfileId(e.target.value)} disabled={!companyId || loadingEmp} className="control mt-1">
              <option value="">{L.pick}</option>
              {employees.map((e) => (<option key={e.profile_id} value={e.profile_id}>{nameOf(e)}</option>))}
            </select>
          </label>
        </div>

        <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.certType}
          <select value={certType} onChange={(e) => setCertType(e.target.value as 'work' | 'salary')} className="control mt-1">
            <option value="work">{L.typeWork}</option>
            <option value="salary">{L.typeSalary}</option>
          </select>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.issuer}
            <input type="text" value={issuerName} onChange={(e) => setIssuerName(e.target.value)} placeholder={L.issuerPh} className="control mt-1" />
          </label>
          <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.issuerRole}
            <input type="text" value={issuerRole} onChange={(e) => setIssuerRole(e.target.value)} placeholder={L.rolePh} className="control mt-1" />
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
