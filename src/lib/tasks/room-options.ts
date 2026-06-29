// ตัวเลือกที่ใช้ร่วมกันระหว่าง "ฟอร์มสร้างห้อง" และ "หน้าตั้งค่าห้อง"
// แยกมาไว้ที่เดียวเพื่อกันค่า/ป้ายเพี้ยนกันสองจุด (DRY)

export const ICON_OPTIONS = [
  { value: 'clipboard-list', label: 'รายการงาน' },
  { value: 'wrench', label: 'ซ่อม' },
  { value: 'wallet', label: 'บัญชี/การเงิน' },
  { value: 'sparkles', label: 'ความสะอาด' },
  { value: 'megaphone', label: 'การตลาด' },
  { value: 'package', label: 'สต๊อก/คลัง' },
  { value: 'utensils', label: 'ครัว/อาหาร' },
  { value: 'calendar-days', label: 'ปฏิทิน' },
];

export const COLOR_OPTIONS = [
  { value: 'indigo', label: 'น้ำเงินม่วง' },
  { value: 'rose', label: 'ชมพู' },
  { value: 'amber', label: 'ส้มเหลือง' },
  { value: 'green', label: 'เขียว' },
  { value: 'sky', label: 'ฟ้า' },
  { value: 'violet', label: 'ม่วง' },
  { value: 'red', label: 'แดง' },
  { value: 'teal', label: 'เขียวน้ำทะเล' },
];

export const ASSIGN_MODE_OPTIONS = [
  { value: 'manual', label: 'เจ้าของเลือกผู้รับผิดชอบเอง (เจ้าของ→พนักงาน)' },
  { value: 'claim', label: 'เปิดให้กลุ่มเป้าหมายมารับงาน (เช่น แจ้งซ่อม→ช่าง)' },
  { value: 'all', label: 'มอบหมายทุกคนในกลุ่มเป้าหมาย' },
];

export const RESPONSE_TYPE_OPTIONS = [
  { value: 'submit', label: 'ทำ + ส่งงาน' },
  { value: 'acknowledge', label: 'กดรับทราบ' },
  { value: 'notify', label: 'แจ้งเพื่อทราบ' },
];
