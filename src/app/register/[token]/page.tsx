'use client';

import { useParams } from 'next/navigation';
import { EmployeeSignupForm } from '@/components/auth/employee-signup-form';

// Self-register via an HR registration link (ลิงก์สมัครเอง) — the shared sign-up form with NO
// pre-bound role: the account lands as "ยังไม่ระบุ" until HR verifies + assigns. The invite flow
// (/invite/[token]) renders the SAME form, just with the link's role + store fixed.
export default function HrRegisterPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 dark:bg-gray-900">
      <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700">
        <EmployeeSignupForm token={token} />
      </div>
    </div>
  );
}
