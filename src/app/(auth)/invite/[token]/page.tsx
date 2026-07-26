'use client';

import { useParams } from 'next/navigation';
import { EmployeeSignupForm } from '@/components/auth/employee-signup-form';

// Register via an invitation link (ลิงก์เชิญ) — the SAME sign-up form as /register/[token]
// (owner ask 2026-07-27: identical UI), the only difference being that this link pre-binds the
// สิทธิ์ระบบ (role) + สาขา, shown as fixed badges. The (auth) layout provides the card shell.
export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';

  return <EmployeeSignupForm token={token} />;
}
