import type { SupabaseClient } from '@supabase/supabase-js';

interface LeaveConflict {
  id: string;
  from_date: string;
  to_date: string;
  status: 'pending' | 'approved';
  leave_type: { name_th: string } | null;
}

function displayDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${Number(year) + 543}`;
}

/** All leave types reserve the employee's dates, including requests awaiting approval. */
export async function checkLeaveOverlap(
  service: SupabaseClient,
  lookup: { profileId: string; fromDate: string; toDate: string; excludeLeaveId?: string },
) {
  let query = service.from('hr_leaves')
    .select('id, from_date, to_date, status, leave_type:hr_leave_types(name_th)')
    .eq('user_id', lookup.profileId)
    .in('status', ['pending', 'approved'])
    .lte('from_date', lookup.toDate)
    .gte('to_date', lookup.fromDate)
    .order('from_date');
  if (lookup.excludeLeaveId) query = query.neq('id', lookup.excludeLeaveId);
  const { data, error } = await query;
  if (error) throw new Error('ตรวจสอบใบลาซ้ำไม่สำเร็จ กรุณาลองใหม่');
  const conflicts = (data ?? []) as unknown as LeaveConflict[];
  if (!conflicts.length) return null;
  const details = conflicts.map(row => {
    const dates = row.from_date === row.to_date
      ? displayDate(row.from_date)
      : `${displayDate(row.from_date)}–${displayDate(row.to_date)}`;
    return `${row.leave_type?.name_th ?? 'ใบลา'} ${dates} (${row.status === 'approved' ? 'อนุมัติแล้ว' : 'รออนุมัติ'})`;
  });
  return {
    code: 'leave_overlap',
    error: `วันลาทับซ้อนกับใบลาเดิม: ${details.join(' · ')} กรุณายกเลิกใบเดิมหรือปรับวันที่ก่อนทำรายการอีกครั้ง`,
    conflicts,
  };
}
