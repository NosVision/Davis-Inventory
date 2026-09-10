// Change the version whenever the agreement text or policy changes.
export const DEPOSIT_TERMS_VERSION = '2026-09-10';

export function hasAcceptedDepositTerms(body: Record<string, unknown>): boolean {
  return body.termsAccepted === true && body.termsVersion === DEPOSIT_TERMS_VERSION &&
    (body.termsLocale === 'th' || body.termsLocale === 'en');
}

export const DEPOSIT_TERMS = {
  th: {
    title: 'เงื่อนไขการฝากและเบิกเหล้า',
    items: [
      'ระยะเวลาฝาก 30 วัน กรุณาตรวจสอบวันครบกำหนดและวันเวลาสิ้นสุดการเบิกในรายการฝากของท่าน',
      'งดเบิกเหล้าเพื่อดื่มในร้านทุกวันศุกร์และวันเสาร์ ในวันดังกล่าวสามารถเบิกกลับบ้านได้ หากรายการฝากยังไม่สิ้นสุดสิทธิ์การเบิก',
      'เบิกได้ถึงเวลา 04:00 น. ของวันถัดจากวันครบกำหนด เป็นช่วงต่อเนื่องจากคืนสุดท้ายที่เบิกได้ ไม่รวมรอบเปิดร้านช่วงเย็นของวันนั้น',
      'หากวันครบกำหนดตรงวันศุกร์หรือวันเสาร์ จะเลื่อนให้เบิกได้ในวันอาทิตย์ และสิ้นสุดสิทธิ์การเบิกเวลา 04:00 น. ของวันจันทร์',
      'ต้องรับเหล้าให้เรียบร้อยก่อนสิ้นสุดสิทธิ์การเบิก การส่งคำขอเบิกก่อนหมดเวลาไม่ถือเป็นการต่ออายุหรือจองสิทธิ์เพื่อรับเหล้าในภายหลัง',
      'เมื่อพ้นวันเวลาสิ้นสุดสิทธิ์การเบิกแล้ว ทางร้านขอสงวนสิทธิ์ไม่คืนเหล้าที่ฝาก และไม่คืนเงินหรือชดเชยมูลค่าเหล้าที่ฝาก ไม่ว่ากรณีใด ๆ ทั้งสิ้น',
    ],
    accept: 'ข้าพเจ้าได้อ่าน เข้าใจ และยอมรับเงื่อนไขข้างต้น รวมถึงวันงดเบิก เวลาสิ้นสุดสิทธิ์ และเงื่อนไขการไม่คืนเหล้าหรือคืนเงินเมื่อพ้นกำหนดแล้ว',
    error: 'กรุณาอ่านและยอมรับเงื่อนไขการฝากและเบิกเหล้าก่อนส่งคำขอ',
  },
  en: {
    title: 'Bottle Storage and Collection Terms',
    items: [
      'The storage period is 30 days. Please check your deposit record for the expiry date and final collection deadline.',
      'Withdrawals for in-store consumption are unavailable every Friday and Saturday. Take-home collection remains available on these days, provided your collection entitlement has not expired.',
      'Collection is allowed until 4:00 a.m. on the day after the expiry date. This covers the early hours following the final eligible night. It does not include the evening opening on that date.',
      'If the expiry date falls on a Friday or Saturday, the final eligible day will be extended to Sunday. Your collection entitlement will end at 4:00 a.m. on Monday.',
      'You must collect your bottle before the final deadline. Submitting a request before the deadline does not extend the storage period or reserve the right to collect your bottle later.',
      'Once the final collection deadline has passed, the venue reserves the right not to return the stored bottle. No refunds or compensation for its value will be provided under any circumstances.',
    ],
    accept: 'I have read, understood, and agree to the terms above, including the restricted days, final collection deadline, and the no-return and no-refund conditions after the deadline.',
    error: 'Please read and accept the Bottle Storage and Collection Terms before submitting.',
  },
} as const;
