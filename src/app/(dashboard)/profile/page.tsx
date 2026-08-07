import { redirect } from 'next/navigation';

/**
 * /profile used to be a second, separate profile screen: the avatar menu opened it, while the
 * /me hub opened /me/profile — two pages showing different halves of the same person. They are
 * merged at /me/profile now (tabs: ข้อมูลส่วนตัว | การตั้งค่าบัญชี); this keeps every old link,
 * bookmark and PWA shortcut working.
 */
export default function ProfileRedirectPage() {
  redirect('/me/profile');
}
