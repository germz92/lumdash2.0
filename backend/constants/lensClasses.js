const LENS_CLASSES = [
  'Ultrawide',
  'Wide',
  'Standard Zoom',
  'Telephoto Zoom',
  'Super Telephoto Zoom',
  'Wide Prime',
  'Standard Prime',
  'Telephoto Prime',
  'Macro',
  'Fisheye',
  'Other'
];

function isLensCategory(category) {
  return /lens/i.test(category || '');
}

function normalizeLensClass(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = LENS_CLASSES.find(c => c.toLowerCase() === trimmed.toLowerCase());
  return match || null;
}

function lensClassForCategory(category, lensClass) {
  if (!isLensCategory(category)) return null;
  return normalizeLensClass(lensClass);
}

module.exports = {
  LENS_CLASSES,
  isLensCategory,
  normalizeLensClass,
  lensClassForCategory
};
