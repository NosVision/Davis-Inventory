// POS money helpers — เก็บเป็น "สตางค์" (integer) แปลงเป็นบาทตอนแสดงผลเท่านั้น

/** แสดงสตางค์เป็นบาท เช่น 12000 -> "120.00" */
export function formatBaht(satang: number): string {
  return (satang / 100).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** บาท -> สตางค์ (ปัดเป็นจำนวนเต็ม) */
export function bahtToSatang(baht: number): number {
  return Math.round(baht * 100);
}

/** ยอดต่อบรรทัด = ราคา/หน่วย × จำนวน (ปัดเป็นสตางค์เต็ม) */
export function lineTotalSatang(unitPriceSatang: number, qty: number): number {
  return Math.round(unitPriceSatang * qty);
}
