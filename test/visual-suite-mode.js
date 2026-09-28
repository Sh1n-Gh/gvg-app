// P24.2h: select whole visual subtests, never individual comparisons.
const visualNames = new Set([
  'responsive before/after screenshots',
  'before/after pixel equality across four public tabs at 390/768/1440',
  'before/after Master responsive screenshots',
]);

exports.suiteTest = (context, name, ...args) => {
  const monitoring = process.env.VISUAL_SUITE_MODE === 'monitoring';
  if (visualNames.has(name) !== monitoring) return Promise.resolve();
  return context.test(name, ...args);
};
