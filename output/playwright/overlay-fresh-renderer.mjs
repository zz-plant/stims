import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu'],
  });
  const page = await browser.newPage({
    viewport: { width: 1200, height: 873 },
  });

  await page.goto(
    'http://127.0.0.1:4175/milkdrop/?experience=milkdrop&agent=true&audio=demo&preset=100-square&renderer=webgpu&corpus=certification',
    { waitUntil: 'networkidle' },
  );
  await page.waitForTimeout(1200);

  await page.evaluate(async () => {
    const runtime = window.__milkdropRuntimeDebug?.getRuntime?.();
    if (!runtime) {
      return;
    }

    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = 360;
    overlayCanvas.height = 360;
    Object.assign(overlayCanvas.style, {
      position: 'fixed',
      left: '24px',
      bottom: '24px',
      width: '180px',
      height: '180px',
      zIndex: '9999',
      border: '2px solid #ff2aa1',
      background: '#000',
    });
    document.body.appendChild(overlayCanvas);

    const { initRenderer } = await import('/assets/js/core/renderer-setup.ts');
    const result = await initRenderer(overlayCanvas, {
      antialias: true,
      alpha: false,
      renderScale: 1,
      maxPixelRatio: 1,
    });
    if (!result) {
      return;
    }

    result.renderer.render(runtime.toy.scene, runtime.toy.camera);
  });

  await page.waitForTimeout(150);
  await page.screenshot({
    path: 'output/playwright/milkdrop-overlay-fresh-renderer.png',
  });
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
