// A whole-cell TP-ID such as "TP-001".
export const TP_ID = /^TP-\d{3}$/;

// TP-IDs inside free text. The g flag makes this stateful, so use it only with matchAll.
export const TP_ID_IN_TEXT = /TP-\d{3}(?!\d)/g;

// tpReferences still accepts any digit count, unlike TP_ID and TP_ID_IN_TEXT.
// Kept as is to preserve behavior; aligning it is left to a separate change.
export const TP_REFERENCE_LOOSE = /(?<![A-Za-z0-9_./-])TP-\d+(?![A-Za-z0-9_-]|\.[A-Za-z0-9])/g;
