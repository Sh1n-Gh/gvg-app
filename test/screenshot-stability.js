// Used only by the before/after screenshot harnesses.
async function waitForScreenshotStability(page) {
  await page.addStyleTag({ content: `
    *, *::before, *::after {
      animation: none !important;
      transition: none !important;
      scroll-behavior: auto !important;
    }
  ` });
  await page.waitForLoadState('networkidle', { timeout: 7000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(img => img.decode().catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

module.exports = { waitForScreenshotStability };
