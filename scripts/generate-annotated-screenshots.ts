import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const INPUT_DIR = './screenshots/aesthetic-audit';
const ARTIFACT_DIR =
  '/Users/kanav/.gemini/antigravity/brain/3e6b08b7-a7e1-4aa9-856c-243fca4c8e15';

type Annotation = {
  num: number;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  badgePos?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
};

function renderSvgOverlay(
  width: number,
  height: number,
  annotations: Annotation[],
): string {
  const itemsSvg = annotations
    .map((a) => {
      let badgeX = a.x - 14;
      let badgeY = a.y - 14;
      if (a.badgePos === 'top-right') {
        badgeX = a.x + a.w - 14;
      } else if (a.badgePos === 'bottom-left') {
        badgeY = a.y + a.h - 14;
      } else if (a.badgePos === 'bottom-right') {
        badgeX = a.x + a.w - 14;
        badgeY = a.y + a.h - 14;
      }

      return `
        <!-- Box highlight -->
        <rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" 
              fill="rgba(239, 68, 68, 0.15)" stroke="#ef4444" stroke-width="3" stroke-dasharray="6,4" rx="8" />
        
        <!-- Badge circle -->
        <circle cx="${badgeX + 14}" cy="${badgeY + 14}" r="16" fill="#ef4444" stroke="#ffffff" stroke-width="2" />
        <text x="${badgeX + 14}" y="${badgeY + 20}" font-family="system-ui, sans-serif" font-size="16" font-weight="bold" fill="#ffffff" text-anchor="middle">${a.num}</text>
      `;
    })
    .join('\n');

  return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .callout-box { font-family: system-ui, -apple-system, sans-serif; }
      </style>
      ${itemsSvg}
    </svg>
  `;
}

async function annotateImage(
  inputFilename: string,
  outputFilename: string,
  annotations: Annotation[],
  width = 1440,
  height = 900,
) {
  const inputPath = path.join(INPUT_DIR, inputFilename);
  const outputPath = path.join(ARTIFACT_DIR, outputFilename);

  const svgBuffer = Buffer.from(renderSvgOverlay(width, height, annotations));

  await sharp(inputPath)
    .composite([{ input: svgBuffer, top: 0, left: 0 }])
    .toFile(outputPath);

  console.log(`Saved annotated screenshot: ${outputPath}`);
}

async function main() {
  await mkdir(ARTIFACT_DIR, { recursive: true });

  // 1. Desktop Home / Launch Panel Annotations
  await annotateImage('01-desktop-home.png', 'annotated_01_home_launch.png', [
    {
      num: 1,
      x: 450,
      y: 35,
      w: 540,
      h: 70,
      label: 'Header pill rainbow glow line misalignment',
      badgePos: 'top-left',
    },
    {
      num: 2,
      x: 120,
      y: 170,
      w: 220,
      h: 75,
      label:
        'Editorial Serif font title clashes with cyberpunk visualizer theme',
      badgePos: 'top-left',
    },
    {
      num: 3,
      x: 145,
      y: 415,
      w: 105,
      h: 70,
      label: 'Blank gray card thumbnail placeholder',
      badgePos: 'top-left',
    },
    {
      num: 4,
      x: 770,
      y: 270,
      w: 110,
      h: 55,
      label: 'Disabled green-gray LOAD button with poor contrast',
      badgePos: 'top-right',
    },
    {
      num: 5,
      x: 40,
      y: 520,
      w: 1360,
      h: 340,
      label: 'Unused bottom void space in viewport',
      badgePos: 'top-left',
    },
  ]);

  // 2. Browse Sheet Annotations
  await annotateImage(
    '02-desktop-browse.png',
    'annotated_02_browse_sheet.png',
    [
      {
        num: 1,
        x: 870,
        y: 20,
        w: 540,
        h: 120,
        label: 'Redundant double title headers & close buttons',
        badgePos: 'top-left',
      },
      {
        num: 2,
        x: 1230,
        y: 275,
        w: 170,
        h: 50,
        label: 'Abruptly truncated collection tag filter pills',
        badgePos: 'top-right',
      },
      {
        num: 3,
        x: 935,
        y: 480,
        w: 105,
        h: 250,
        label: 'Wireframe placeholder rectangles instead of artwork',
        badgePos: 'top-left',
      },
      {
        num: 4,
        x: 863,
        y: 0,
        w: 10,
        h: 900,
        label: 'Rigid 1px cyan line without glass backdrop blur',
        badgePos: 'top-left',
      },
    ],
  );

  // 3. Settings Sheet Annotations
  await annotateImage(
    '03-desktop-settings.png',
    'annotated_03_settings_sheet.png',
    [
      {
        num: 1,
        x: 890,
        y: 160,
        w: 500,
        h: 150,
        label: 'Dense plain text stats wall without visual card formatting',
        badgePos: 'top-left',
      },
      {
        num: 2,
        x: 890,
        y: 355,
        w: 500,
        h: 55,
        label: 'Stock browser select dropdown lacks glass design tokens',
        badgePos: 'top-right',
      },
      {
        num: 3,
        x: 900,
        y: 580,
        w: 40,
        h: 170,
        label: 'Native unstyled browser HTML checkboxes',
        badgePos: 'top-left',
      },
    ],
  );

  // 4. Editor Panel Annotations
  await annotateImage(
    '04-desktop-editor.png',
    'annotated_04_editor_panel.png',
    [
      {
        num: 1,
        x: 880,
        y: 195,
        w: 520,
        h: 120,
        label: 'Cluttered 8-button grid lacking visual hierarchy',
        badgePos: 'top-left',
      },
      {
        num: 2,
        x: 925,
        y: 380,
        w: 190,
        h: 460,
        label: 'Flat slider tracks without audio-reactive gradient fill',
        badgePos: 'top-left',
      },
      {
        num: 3,
        x: 1160,
        y: 390,
        w: 240,
        h: 450,
        label:
          'Font family clash: Serif variable names vs sans-serif descriptions',
        badgePos: 'top-right',
      },
    ],
  );

  // 5. Stage Fallback Badge Annotations
  await annotateImage('05-desktop-live.png', 'annotated_05_stage_badges.png', [
    {
      num: 1,
      x: 850,
      y: 10,
      w: 580,
      h: 100,
      label:
        'Duplicate WebGL warning badge rendered in both header and top-right corner',
      badgePos: 'top-left',
    },
  ]);

  console.log('All annotated screenshots generated successfully!');
}

main().catch(console.error);
