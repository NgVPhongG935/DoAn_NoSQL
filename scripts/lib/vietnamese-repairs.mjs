// These exact damaged values were audited in the live demo. Replacement bytes
// have already destroyed some accents, so do not guess repairs for other text.
export const vietnameseRepairs = new Map([
  ["HUIT, T\uFFFDn Ph\uFFFD, TP. H? Ch\uFFFD Minh", "HUIT, Tân Phú, TP. Hồ Chí Minh"],
  ["Landmark 81, B\uFFFDnh Th?nh, TP. H? Ch\uFFFD Minh", "Landmark 81, Bình Thạnh, TP. Hồ Chí Minh"],
  ["Ki?m th? t? d?ng gh\uFFFDp v\uFFFD tr? t\uFFFDi x?", "Kiểm thử tự động ghép vị trí tài xế"],
  ["D?n chuy?n ki?m th? d?i t\uFFFDi x?", "Dọn chuyến kiểm thử đổi tài xế"],
  ["Ki?m th? hai y\uFFFDu c?u d?t d?ng th?i", "Kiểm thử hai yêu cầu đặt đồng thời"],
  ["D?n chuy?n ki?m th? kh\uFFFDa t\uFFFDi x? BUSY", "Dọn chuyến kiểm thử khóa tài xế BUSY"],
]);

export function hasEncodingDamage(value) {
  return typeof value === "string" && (
    vietnameseRepairs.has(value)
    || /\uFFFD|\u00C3[\u0080-\u00BF\u0100-\u01FF\u2000-\u20FF]|\u00C2[\u0080-\u00BF]|\u00E1[\u00BA\u00BB]|\u00C4[\u0090\u0091\u2018\u2019]|\u00C6[\u00A0\u00A1\u00AF\u00B0\u00B1]|\u00EF\u00BF\u00BD/u.test(value)
  );
}

export function repairKnownVietnameseText(value) {
  return vietnameseRepairs.get(value) ?? value;
}
