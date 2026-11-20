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

const LIGHTING_CLASSES = [
  'Speedlights',
  'Strobes',
  'Continuous Light',
  'Modifiers',
  'Triggers'
];

function isLensCategory(category) {
  return /lens/i.test(category || '');
}

function isLightingCategory(category) {
  return /^lighting$/i.test(String(category || '').trim());
}

function normalizeFromList(value, list) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = list.find(c => c.toLowerCase() === trimmed.toLowerCase());
  return match || null;
}

function normalizeLensClass(value) {
  return normalizeFromList(value, LENS_CLASSES);
}

function normalizeLightingClass(value) {
  return normalizeFromList(value, LIGHTING_CLASSES);
}

function classesForCategory(category) {
  if (isLensCategory(category)) return LENS_CLASSES;
  if (isLightingCategory(category)) return LIGHTING_CLASSES;
  return null;
}

function lensClassForCategory(category, lensClass) {
  const list = classesForCategory(category);
  if (!list) return null;
  return normalizeFromList(lensClass, list);
}

module.exports = {
  LENS_CLASSES,
  LIGHTING_CLASSES,
  isLensCategory,
  isLightingCategory,
  classesForCategory,
  normalizeLensClass,
  normalizeLightingClass,
  lensClassForCategory
};
