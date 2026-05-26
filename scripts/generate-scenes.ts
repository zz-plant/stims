#!/usr/bin/env bun
/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, no-empty */
/**
 * generate-scenes.ts — renders source.svg into scene-specific PNGs with variation.
 * Usage: bun run scripts/generate-scenes.ts [--dry-run]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { execSync } from "node:child_process";

const ASSETS_DIR = join(process.cwd(), "docs", "assets");
const SVG_PATH = join(ASSETS_DIR, "source.svg");
const PROJECT = basename(process.cwd());

type SceneSpec = {
  width: number; height: number; minBytes: number;
  bg: string; gradient?: boolean; center?: boolean; scale?: number;
};

const SCENES: Record<string, SceneSpec> = {
  badge:    { width: 240,  height: 96,   minBytes: 2_000,  bg: "#1a1a2e", scale: 0.8 },
  blur:     { width: 50,   height: 28,   minBytes: 300,    bg: "#1a1a2e", scale: 0.5 },
  card:     { width: 400,  height: 300,  minBytes: 8_000, bg: "#16213e", center: true, scale: 0.7 },
  circle:   { width: 540,  height: 540,  minBytes: 8_000, bg: "#0f3460", center: true, gradient: true },
  dark:     { width: 960,  height: 540,  minBytes: 10_000, bg: "#0a0a0a", gradient: true },
  demo:     { width: 720,  height: 405,  minBytes: 12_000, bg: "#1a1a2e", gradient: true },
  email:    { width: 600,  height: 200,  minBytes: 5_000, bg: "#16213e" },
  favicon:  { width: 64,   height: 64,   minBytes: 600,    bg: "#e94560", scale: 0.95 },
  github:   { width: 1280, height: 640,  minBytes: 15_000, bg: "#1a1a2e", gradient: true },
  header:   { width: 1920, height: 400,  minBytes: 12_000, bg: "#1a1a2e", gradient: true },
  mastodon: { width: 1200, height: 600,  minBytes: 15_000, bg: "#16213e", gradient: true },
  og:       { width: 1200, height: 675,  minBytes: 15_000, bg: "#1a1a2e", gradient: true },
  square:   { width: 1080, height: 1080, minBytes: 15_000, bg: "#0f3460", center: true, gradient: true },
  touch:    { width: 360,  height: 360,  minBytes: 8_000, bg: "#16213e", center: true },
  unfurl:   { width: 1200, height: 628,  minBytes: 15_000, bg: "#1a1a2e", gradient: true },
};

function hueFromProject(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash) + name.charCodeAt(i);
  return Math.abs(hash) % 360;
}

function rotateHex(hex: string, hue: number): string {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  const f = (hue / 360) * 0.25 + 0.875; // 0.875-1.125
  const nr = Math.min(255, Math.round(r * f));
  const ng = Math.min(255, Math.round(g * (1 + (hue % 40 - 20)/200)));
  const nb = Math.min(255, Math.round(b * (1 + ((hue + 120) % 40 - 20)/200)));
  return `#${nr.toString(16).padStart(2,'0')}${ng.toString(16).padStart(2,'0')}${nb.toString(16).padStart(2,'0')}`;
}

function buildOverlay(spec: SceneSpec, hue: number): string {
  const bg = rotateHex(spec.bg, hue);
  const { width, height, gradient } = spec;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`;
  svg += `<rect width="100%" height="100%" fill="${bg}"/>`;
  
  if (gradient) {
    svg += `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="rgba(255,255,255,0.04)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.12)"/>
    </linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`;
  }
  
  const fs = Math.max(10, Math.min(width, height) * 0.025);
  svg += `<text x="${width - 16}" y="${height - 12}" font-family="system-ui,sans-serif" font-size="${fs}" fill="rgba(255,255,255,0.12)" text-anchor="end">${PROJECT}</text>`;
  return svg + "</svg>";
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  
  if (!existsSync(SVG_PATH)) {
    console.error(`❌ No source.svg at ${SVG_PATH}`);
    process.exit(1);
  }
  
  const svgRaw = readFileSync(SVG_PATH, "utf-8");
  const innerMatch = svgRaw.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
  const innerSvg = innerMatch ? innerMatch[1] : svgRaw;  // Inner content only, no wrapper <svg>
  
  mkdirSync(ASSETS_DIR, { recursive: true });
  const hue = hueFromProject(PROJECT);
  
  let ok = 0, warn = 0, err = 0;
  
  for (const [scene, spec] of Object.entries(SCENES)) {
    const outPath = join(ASSETS_DIR, `${PROJECT}-${scene}.png`);
    const overlayPath = join(ASSETS_DIR, `_${scene}_overlay.svg`);
    const compPath = join(ASSETS_DIR, `_${scene}_comp.svg`);
    
    if (dryRun) { console.log(`  [dry] ${scene}: ${spec.width}×${spec.height} ${spec.bg}`); continue; }
    
    try {
      // 1. Build overlay SVG with per-project hue variation
      const overlay = buildOverlay(spec, hue);
      writeFileSync(overlayPath, overlay);
      
      // 2. Build composed SVG: overlay background + scaled source.svg content
      const scale = spec.scale ?? 0.8;
      const sw = Math.round(spec.width * scale);
      const sh = Math.round(spec.height * scale);
      const sx = spec.center ? Math.round((spec.width - sw) / 2) : Math.round(spec.width * 0.05);
      const sy = spec.center ? Math.round((spec.height - sh) / 2) : Math.round(spec.height * 0.05);
      
      // Render source content ON TOP of overlay
      const composed = overlay.replace("</svg>",
        `\n  <g transform="translate(${sx},${sy}) scale(${scale})">${innerSvg}</g>\n</svg>`);
      // Also add a subtle pattern for depth
      writeFileSync(compPath, composed);
      
      // 3. Render via rsvg-convert
      execSync(`rsvg-convert -w ${spec.width} -h ${spec.height} -o "${outPath}" "${compPath}"`,
        { stdio: "pipe", timeout: 10000 });
      
      // 4. Verify
      const sz = statSync(outPath).size;
      if (sz < spec.minBytes / 2) {
        console.log(`  ⚠️  ${scene}: ${sz}B (below ${spec.minBytes}B)`);
        warn++;
      } else {
        ok++;
      }
    } catch (e: any) {
      console.error(`  ❌ ${scene}: ${e.stderr || e.message}`);
      err++;
    } finally {
      try { execSync(`rm -f "${overlayPath}" "${compPath}"`); } catch {}
    }
  }
  
  console.log(`\n${dryRun ? "DRY RUN " : ""}✅ ${ok}  ⚠️ ${warn}  ❌ ${err}`);
  if (err > 0) process.exit(1);
}

main();
