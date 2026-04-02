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
  await page.waitForTimeout(1500);

  const data = await page.evaluate(async () => {
    const resource = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => name.includes('/assets/js/core/toy-lifecycle.ts'));
    const { defaultToyLifecycle } = resource
      ? await import(resource)
      : await import('/assets/js/core/toy-lifecycle.ts');
    const active = defaultToyLifecycle.getActiveToy()?.ref;
    if (!active || typeof active !== 'object') {
      return { resource, active: null };
    }

    const toy = active;
    return {
      resource,
      rendererBackend: toy.rendererBackend ?? null,
      rendererType: toy.renderer?.constructor?.name ?? null,
      rendererInfo: toy.rendererInfo ?? null,
      sceneChildCount: toy.scene?.children?.length ?? null,
      sceneChildren:
        toy.scene?.children?.map((child) => ({
          type: child.type,
          visible: child.visible,
          renderOrder: child.renderOrder,
          childCount: child.children?.length ?? 0,
          materialOpacity: child.material?.opacity ?? null,
          position: child.position
            ? {
                x: child.position.x,
                y: child.position.y,
                z: child.position.z,
              }
            : null,
        })) ?? [],
      cameraPos: toy.camera
        ? {
            x: toy.camera.position.x,
            y: toy.camera.position.y,
            z: toy.camera.position.z,
          }
        : null,
    };
  });

  console.log(JSON.stringify(data, null, 2));
  await page.screenshot({ path: 'output/playwright/milkdrop-inspect.png' });
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
