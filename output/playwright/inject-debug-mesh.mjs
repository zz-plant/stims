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

    const sourceMesh = runtime.toy.scene.children?.[0]?.children?.[0];
    if (!sourceMesh?.clone) {
      return;
    }

    const mesh = sourceMesh.clone();
    mesh.material = sourceMesh.material.clone();
    mesh.material.color.setHex(0xff2aa1);
    mesh.material.opacity = 1;
    mesh.material.transparent = false;
    mesh.position.z = 2;
    mesh.scale.set(0.6, 0.6, 1);
    mesh.userData.codexDebug = true;
    runtime.toy.scene.add(mesh);
    runtime.toy.render();
  });

  await page.waitForTimeout(100);
  await page.screenshot({ path: 'output/playwright/milkdrop-debug-mesh.png' });
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
