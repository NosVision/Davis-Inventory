// ตัวเลือกที่ใช้ร่วมกันระหว่าง "ฟอร์มสร้างห้อง" และ "หน้าตั้งค่าห้อง"
// แยกมาไว้ที่เดียวเพื่อกันค่า/ป้ายเพี้ยนกันสองจุด (DRY)
// หมายเหตุ: ทุก value ของไอคอนต้องมีใน ICONS ที่ room-icon.tsx ด้วย

export interface RoomOption {
  value: string;
  label: string;
}

// ไอคอนห้องงาน — จัดกลุ่มคร่าว ๆ (งานทั่วไป / ซ่อมบำรุง / ความสะอาด / คลัง / เงิน / ครัว-บาร์ / คน / อื่น ๆ)
export const ICON_OPTIONS: RoomOption[] = [
  // งานทั่วไป
  { value: 'clipboard-list', label: 'รายการงาน' },
  { value: 'clipboard-check', label: 'เช็คลิสต์' },
  { value: 'list-checks', label: 'รายการเช็ค' },
  { value: 'file-text', label: 'เอกสาร' },
  { value: 'folder', label: 'โฟลเดอร์' },
  { value: 'bell', label: 'แจ้งเตือน' },
  { value: 'megaphone', label: 'ประกาศ/การตลาด' },
  { value: 'flag', label: 'ปักธง' },
  { value: 'star', label: 'ดาว' },
  { value: 'tag', label: 'ป้าย' },
  { value: 'calendar-days', label: 'ปฏิทิน' },
  { value: 'clock', label: 'เวลา' },
  { value: 'repeat', label: 'งานประจำ' },
  // ซ่อมบำรุง
  { value: 'wrench', label: 'ซ่อม' },
  { value: 'hammer', label: 'ค้อน/ช่าง' },
  { value: 'hard-hat', label: 'งานช่าง' },
  { value: 'plug', label: 'ปลั๊กไฟ' },
  { value: 'lightbulb', label: 'หลอดไฟ' },
  { value: 'zap', label: 'ไฟฟ้า' },
  { value: 'thermometer', label: 'อุณหภูมิ' },
  { value: 'snowflake', label: 'แอร์/ความเย็น' },
  { value: 'flame', label: 'แก๊ส/ไฟ' },
  { value: 'droplet', label: 'น้ำ/ประปา' },
  // ความสะอาด
  { value: 'sparkles', label: 'ความสะอาด' },
  { value: 'spray-can', label: 'ทำความสะอาด' },
  { value: 'trash-2', label: 'ขยะ' },
  { value: 'recycle', label: 'รีไซเคิล' },
  // คลัง/ขนส่ง
  { value: 'package', label: 'พัสดุ' },
  { value: 'boxes', label: 'สต๊อก/คลัง' },
  { value: 'warehouse', label: 'โกดัง' },
  { value: 'truck', label: 'ขนส่ง' },
  { value: 'shopping-cart', label: 'สั่งซื้อ' },
  // เงิน/บัญชี
  { value: 'wallet', label: 'กระเป๋าเงิน' },
  { value: 'credit-card', label: 'บัตร' },
  { value: 'banknote', label: 'เงินสด' },
  { value: 'coins', label: 'บัญชี/เหรียญ' },
  { value: 'calculator', label: 'คำนวณ' },
  { value: 'receipt', label: 'ใบเสร็จ' },
  // ครัว/บาร์
  { value: 'utensils', label: 'อาหาร' },
  { value: 'chef-hat', label: 'ครัว' },
  { value: 'soup', label: 'ซุป/ต้ม' },
  { value: 'coffee', label: 'กาแฟ' },
  { value: 'wine', label: 'ไวน์' },
  { value: 'beer', label: 'เบียร์' },
  { value: 'martini', label: 'ค็อกเทล/บาร์' },
  { value: 'cup-soda', label: 'น้ำอัดลม' },
  { value: 'cake-slice', label: 'ขนม/เค้ก' },
  // คน/บริการ
  { value: 'users', label: 'ทีมงาน' },
  { value: 'user-check', label: 'มอบหมาย' },
  { value: 'phone', label: 'โทรศัพท์' },
  { value: 'message-square', label: 'ข้อความ' },
  // ความปลอดภัย/เทค
  { value: 'shield-check', label: 'ความปลอดภัย' },
  { value: 'lock', label: 'ล็อก' },
  { value: 'key', label: 'กุญแจ' },
  { value: 'camera', label: 'กล้อง' },
  { value: 'siren', label: 'เหตุด่วน' },
  { value: 'monitor', label: 'คอมพิวเตอร์' },
  { value: 'printer', label: 'เครื่องพิมพ์' },
  { value: 'wifi', label: 'เน็ต/ไวไฟ' },
  // สถานที่/อื่น ๆ
  { value: 'home', label: 'บ้าน/สาขา' },
  { value: 'store', label: 'ร้าน' },
  { value: 'building-2', label: 'อาคาร' },
  { value: 'door-open', label: 'ประตู' },
  { value: 'map-pin', label: 'สถานที่' },
  { value: 'gift', label: 'ของขวัญ' },
  { value: 'ticket', label: 'ตั๋ว/บัตร' },
  { value: 'music', label: 'เพลง' },
  { value: 'leaf', label: 'สิ่งแวดล้อม' },
  { value: 'car', label: 'รถ' },
  { value: 'scissors', label: 'กรรไกร' },
  { value: 'palette', label: 'ตกแต่ง/สี' },
  { value: 'heart', label: 'หัวใจ' },
];

// สีห้องงาน — ต้องตรงกับคีย์ใน getRoomColor (colors.ts) เรียงแบบไล่โทน
export const COLOR_OPTIONS: RoomOption[] = [
  { value: 'rose', label: 'ชมพู' },
  { value: 'red', label: 'แดง' },
  { value: 'orange', label: 'ส้ม' },
  { value: 'amber', label: 'เหลืองอำพัน' },
  { value: 'green', label: 'เขียว' },
  { value: 'emerald', label: 'เขียวมรกต' },
  { value: 'teal', label: 'เขียวน้ำทะเล' },
  { value: 'cyan', label: 'ฟ้าคราม' },
  { value: 'sky', label: 'ฟ้า' },
  { value: 'blue', label: 'น้ำเงิน' },
  { value: 'indigo', label: 'น้ำเงินม่วง' },
  { value: 'violet', label: 'ม่วง' },
  { value: 'fuchsia', label: 'บานเย็น' },
];

// ค่าของ "วิธีมอบหมาย" เรียงตามลำดับที่ต้องการแสดง
// ป้าย (label) ทำ i18n ที่ component ผ่าน t('tasks.assignModeOption.<value>')
export const ASSIGN_MODE_VALUES = ['manual', 'claim', 'all'] as const;

// ค่าของ "โหมดตอบกลับเริ่มต้น" — ป้ายทำ i18n ผ่าน t('tasks.responseTypeOption.<value>')
export const RESPONSE_TYPE_VALUES = ['submit', 'acknowledge', 'notify'] as const;
