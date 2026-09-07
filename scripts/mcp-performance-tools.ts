/**
 * Performance tools — the live-coding half of the agent session surface.
 *
 * The original session tools model the visualiser as something to inspect and
 * adjust: set a field, screenshot it, compare. These four model it as an
 * instrument to play — pattern the audio, ride the visual params over time,
 * and listen to the result before deciding the next move.
 *
 * They drive `window.__stims_live` (src/js/frontend/live-performance.ts)
 * through `page.evaluate` rather than the `postMessage` path the midi tools
 * use, because evaluate awaits a real return value: a pattern with a syntax
 * error reports the error instead of failing silently.
 *
 * Registered from mcp-server.ts, which owns the session map — `getSession` is
 * injected rather than imported so this module stays free of that state.
 */

import { z } from 'zod';
import { asTextResponse, type createMcpServer } from './mcp-shared.ts';

type McpServer = ReturnType<typeof createMcpServer>;
type SessionLike = { page: import('playwright').Page } | null;

const NOT_INSTALLED =
  'The live-performance runtime is not on the page yet. It installs when the ' +
  'workspace mounts — load a preset first (start_agent_session or ' +
  'session_switch_preset), then retry.';

export function registerPerformanceTools(
  server: McpServer,
  getSession: (sessionId: string) => SessionLike,
) {
  // ── audio ──────────────────────────────────────────────────────────────

  server.registerTool(
    'session_play_pattern',
    {
      description:
        'Play a Strudel live-coding pattern as the session audio, and drive the visuals with it. This is how you play the instrument rather than just look at it: the pattern audio is teed into the same analyser the mic/file sources use, so bass/mid/treble reactivity follows what you wrote. Calling it again replaces the running pattern — that is the live-coding loop, so iterate freely. Strudel syntax, e.g. `stack(s("bd*4"), s("hh*8").gain(.4), note("<c2 eb2 g1>").s("sawtooth").lpf(600))`.',
      inputSchema: z.object({
        sessionId: z.string().describe('Session ID from start_agent_session.'),
        code: z
          .string()
          .describe(
            'Strudel pattern source. Multi-line is fine; no trailing semicolon needed.',
          ),
        cps: z
          .number()
          .positive()
          .optional()
          .describe(
            'Cycles per second (tempo). 0.5 ≈ 120bpm in 4/4. Omit to keep the current tempo.',
          ),
      }),
    },
    async ({ sessionId, code, cps }) => {
      const session = getSession(sessionId);
      if (!session) return asTextResponse('Session not found or expired.');

      try {
        const result = await session.page.evaluate(
          async ({ code: c, cps: k }) => {
            const live = window.__stims_live;
            if (!live?.playPattern) return { missing: true };
            try {
              const out = await live.playPattern(
                c,
                k === undefined ? undefined : { cps: k },
              );
              return { ok: true, ...out };
            } catch (error) {
              return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              };
            }
          },
          { code, cps },
        );

        if ('missing' in result && result.missing) {
          return asTextResponse(NOT_INSTALLED);
        }
        if (!('ok' in result) || !result.ok) {
          const message =
            'error' in result ? result.error : 'unknown evaluation failure';
          return asTextResponse(
            `Pattern failed to evaluate: ${message}\n\nThe previous pattern (if any) is still playing.`,
          );
        }
        return asTextResponse(
          [
            'Pattern playing.',
            'cps' in result && result.cps !== null
              ? `Tempo: ${result.cps} cps (~${Math.round(Number(result.cps) * 240)} bpm in 4/4).`
              : 'Tempo: unchanged.',
            'routed' in result && result.routed
              ? 'Audio is routed into the visualiser analyser.'
              : '',
            'Use session_listen to hear what it is actually doing, then session_capture_frame to see it.',
          ]
            .filter(Boolean)
            .join('\n'),
        );
      } catch (e) {
        return asTextResponse(`Error playing pattern: ${e}`);
      }
    },
  );

  server.registerTool(
    'session_hush',
    {
      description:
        'Stop all playing Strudel patterns (the audio side only — the visualiser keeps rendering). Use between pieces, or to drop out before starting a new pattern.',
      inputSchema: z.object({
        sessionId: z.string().describe('Session ID from start_agent_session.'),
      }),
    },
    async ({ sessionId }) => {
      const session = getSession(sessionId);
      if (!session) return asTextResponse('Session not found or expired.');

      try {
        const ok = await session.page.evaluate(() => {
          const live = window.__stims_live;
          if (!live?.hush) return false;
          live.hush();
          return true;
        });
        return asTextResponse(ok ? 'Patterns stopped.' : NOT_INSTALLED);
      } catch (e) {
        return asTextResponse(`Error stopping patterns: ${e}`);
      }
    },
  );

  // ── gesture ────────────────────────────────────────────────────────────

  server.registerTool(
    'session_ramp',
    {
      description:
        'Glide one or more MilkDrop targets to new values over a duration, as one gesture — the performing counterpart to session_midi_set, which jumps instantly. Ramping several targets in a single call moves them together (a build, a drop, a slow bloom) instead of as separate steps. The call returns when the gesture lands, so chaining calls sequences a performance. Values are in each target\'s own units, e.g. {"warp": 2.4, "zoom": 1.03}.',
      inputSchema: z.object({
        sessionId: z.string().describe('Session ID from start_agent_session.'),
        targets: z
          .record(z.string(), z.number())
          .describe(
            'Target field names to destination values, e.g. {"warp": 2.4, "decay": 0.98}. Moved together.',
          ),
        durationMs: z
          .number()
          .min(0)
          .max(60_000)
          .describe('Gesture length in ms. 2000-8000 reads as musical.'),
        curve: z
          .enum(['linear', 'sine', 'exp'])
          .optional()
          .describe(
            'sine (default) eases in and out like a hand on a fader; linear is mechanical; exp is back-loaded, good for gain-like targets.',
          ),
        from: z
          .record(z.string(), z.number())
          .optional()
          .describe(
            'Explicit start values. Defaults to the last value this runtime drove for each target.',
          ),
      }),
    },
    async ({ sessionId, targets, durationMs, curve, from }) => {
      const session = getSession(sessionId);
      if (!session) return asTextResponse('Session not found or expired.');

      try {
        const result = await session.page.evaluate(
          async (request) => {
            const live = window.__stims_live;
            if (!live?.ramp) return { missing: true };
            try {
              return { ok: true, ...(await live.ramp(request)) };
            } catch (error) {
              return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              };
            }
          },
          { targets, durationMs, curve, from },
        );

        if ('missing' in result && result.missing) {
          return asTextResponse(NOT_INSTALLED);
        }
        if (!('ok' in result) || !result.ok) {
          const message =
            'error' in result ? result.error : 'unknown ramp failure';
          return asTextResponse(`Ramp failed: ${message}`);
        }

        const landed =
          'final' in result
            ? Object.entries(result.final as Record<string, number>)
                .map(([k, v]) => `${k}=${v}`)
                .join(', ')
            : '';
        // Named per cause, not per flag. These two both mean "it did not
        // glide", but they are different faults with different fixes, and
        // reporting a starved frame loop as a hidden tab sends the reader
        // looking in the wrong place.
        const landing = 'landing' in result ? result.landing : null;
        const forced =
          landing === 'watchdog'
            ? '\nNote: the frame loop never ran (a hidden tab throttles it), so the values were landed by the watchdog rather than glided. The endpoint is correct; the motion was not smooth.'
            : landing === 'starved'
              ? '\nNote: the frame loop ran but its first frame arrived after the ramp window had already closed, so the values snapped to the endpoint rather than gliding. The endpoint is correct; the motion was not smooth. A longer durationMs, or less load on the main thread, would let it glide.'
              : '';
        return asTextResponse(
          `Ramped over ${durationMs}ms (${'curve' in result ? result.curve : 'sine'}, ${'steps' in result ? result.steps : 0} frames). Landed: ${landed}.${forced}`,
        );
      } catch (e) {
        return asTextResponse(`Error ramping: ${e}`);
      }
    },
  );

  // ── continuous movement ────────────────────────────────────────────────

  server.registerTool(
    'session_bind',
    {
      description:
        "Bind a target to a modulation source so it keeps moving on its own — an LFO, or the audio itself. This is the difference between an instrument and a remote control: session_ramp is a gesture you make, session_bind is movement that continues without you (and beat-synced movement is impossible any other way, since a call round-trip is far longer than a beat). Modulators are an OFFSET around the value ramps and sets leave behind, so a ramp can raise a parameter's resting point while the wobble continues around it. Several modulators may share a target; they sum. Example: bind warp to an LFO at 0.5 cycles for a slow breath, and bind zoom to bass with a short attack for a kick punch.",
      inputSchema: z.object({
        sessionId: z.string().describe('Session ID from start_agent_session.'),
        target: z
          .string()
          .describe('Field to modulate, e.g. "warp", "zoom", "decay".'),
        depth: z
          .number()
          .describe(
            "Excursion from the resting value, in the target's own units. Negative inverts. Start small — 0.1-0.3 for zoom, 0.5-2 for warp.",
          ),
        kind: z
          .enum(['lfo', 'audio'])
          .describe(
            'lfo = free-running shape; audio = follows the music through an envelope.',
          ),
        shape: z
          .enum(['sine', 'triangle', 'saw', 'square', 'random'])
          .optional()
          .describe(
            'LFO only. sine (default) breathes; saw ramps then resets; square alternates; random steps to a new level each cycle.',
          ),
        hz: z
          .number()
          .positive()
          .optional()
          .describe('LFO only. Absolute rate. Ignored when cycles is set.'),
        cycles: z
          .number()
          .positive()
          .optional()
          .describe(
            'LFO only, tempo-synced: 1 = once per Strudel cycle, 0.25 = once per four. Prefer this over hz so movement stays locked to the pattern.',
          ),
        phase: z
          .number()
          .optional()
          .describe('LFO only. Start phase 0-1; offset two LFOs to chase.'),
        band: z
          .enum(['rms', 'bass', 'mid', 'treble'])
          .optional()
          .describe('Audio only. Default bass.'),
        attack: z
          .number()
          .optional()
          .describe('Audio only, ms. Default 10 — low is snappy.'),
        release: z
          .number()
          .optional()
          .describe('Audio only, ms. Default 220 — high lets it hang.'),
        gain: z
          .number()
          .optional()
          .describe('Audio only. Scales the band before depth.'),
        min: z.number().optional().describe('Clamp the result.'),
        max: z.number().optional().describe('Clamp the result.'),
        id: z
          .string()
          .optional()
          .describe('Reuse an id to replace that modulator instead of adding.'),
      }),
    },
    async ({ sessionId, target, depth, kind, min, max, id, ...source }) => {
      const session = getSession(sessionId);
      if (!session) return asTextResponse('Session not found or expired.');

      try {
        const result = await session.page.evaluate(
          async ({ spec }) => {
            const live = window.__stims_live;
            if (!live?.bind) return { missing: true };
            try {
              const modulator = live.bind(
                spec as Parameters<typeof live.bind>[0],
              );
              // Give the loop a couple of frames before reporting health, so
              // a healthy rig is not described as stalled on its first tick.
              await new Promise((resolve) => setTimeout(resolve, 120));
              return {
                ok: true,
                id: modulator.id,
                count: live.listModulators().length,
                health: live.getModulationHealth(),
              };
            } catch (error) {
              return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              };
            }
          },
          {
            spec: {
              target,
              depth,
              min,
              max,
              id,
              source:
                kind === 'audio'
                  ? {
                      kind: 'audio',
                      band: source.band,
                      attack: source.attack,
                      release: source.release,
                      gain: source.gain,
                    }
                  : {
                      kind: 'lfo',
                      shape: source.shape,
                      hz: source.hz,
                      cycles: source.cycles,
                      phase: source.phase,
                    },
            },
          },
        );

        if ('missing' in result && result.missing) {
          return asTextResponse(NOT_INSTALLED);
        }
        if (!('ok' in result) || !result.ok) {
          const message =
            'error' in result ? result.error : 'unknown bind failure';
          return asTextResponse(`Bind failed: ${message}`);
        }
        const health = 'health' in result ? result.health : null;
        return asTextResponse(
          [
            `Bound ${target} to ${kind} (depth ${depth}) as ${'id' in result ? result.id : '?'}. ${'count' in result ? result.count : 0} modulator(s) active.`,
            kind === 'audio'
              ? 'Audio modulators need something playing — use session_play_pattern first, and session_listen to confirm it is audible.'
              : '',
            health?.stalled
              ? 'WARNING: the modulation loop is scheduled but not ticking. Modulation is frame-locked, and this page is not rendering frames (a hidden or backgrounded tab suspends requestAnimationFrame). The modulator is registered but nothing will move until the page renders again.'
              : '',
          ]
            .filter(Boolean)
            .join('\n'),
        );
      } catch (e) {
        return asTextResponse(`Error binding: ${e}`);
      }
    },
  );

  server.registerTool(
    'session_unbind',
    {
      description:
        'Remove modulators by id or by target, or all of them. The target is returned to its resting value rather than left frozen at whatever the last modulated frame happened to be — a stuck offset looks exactly like a broken preset. Call with neither id nor target to clear everything.',
      inputSchema: z.object({
        sessionId: z.string().describe('Session ID from start_agent_session.'),
        id: z.string().optional().describe('Modulator id from session_bind.'),
        target: z
          .string()
          .optional()
          .describe('Remove every modulator on this field.'),
      }),
    },
    async ({ sessionId, id, target }) => {
      const session = getSession(sessionId);
      if (!session) return asTextResponse('Session not found or expired.');

      try {
        const result = await session.page.evaluate(
          ({ id: i, target: t }) => {
            const live = window.__stims_live;
            if (!live?.unbind) return { missing: true };
            const removed =
              i === undefined && t === undefined
                ? live.unbindAll()
                : live.unbind({ id: i, target: t });
            return { ok: true, removed, remaining: live.listModulators() };
          },
          { id, target },
        );

        if ('missing' in result && result.missing) {
          return asTextResponse(NOT_INSTALLED);
        }
        const removed = ('removed' in result ? result.removed : []) ?? [];
        const remaining = ('remaining' in result ? result.remaining : []) ?? [];
        return asTextResponse(
          removed.length === 0
            ? 'Nothing matched — no modulators removed.'
            : `Removed ${removed.length} modulator(s): ${removed.join(', ')}. ${remaining.length} still active.`,
        );
      } catch (e) {
        return asTextResponse(`Error unbinding: ${e}`);
      }
    },
  );

  // ── vocabulary ─────────────────────────────────────────────────────────

  server.registerTool(
    'session_macro',
    {
      description:
        'Define, run, list, or delete a named macro — a saved sequence of the same verbs you perform by hand (ramp, set, wait, pattern, hush, bind, unbind). Use it to build a vocabulary for the piece you are playing ("drop", "bloom", "reset") and then call it by name instead of re-issuing the sequence. Macros persist across reloads. Steps run in order and ramps are awaited, so a macro is a timeline rather than a burst.',
      inputSchema: z.object({
        sessionId: z.string().describe('Session ID from start_agent_session.'),
        action: z.enum(['define', 'run', 'list', 'delete']),
        name: z
          .string()
          .optional()
          .describe('Macro name. Required for define, run, and delete.'),
        description: z.string().optional().describe('Optional, for define.'),
        steps: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe(
            'For define. Each step is one of: {"ramp":{"targets":{...},"durationMs":n,"curve":"sine"}}, {"set":{"warp":2}}, {"waitMs":n}, {"pattern":"s(\\"bd*4\\")","cps":0.5}, {"hush":true}, {"bind":{"target":"warp","depth":0.5,"source":{"kind":"lfo","cycles":1}}}, {"unbind":{"target":"warp"}}.',
          ),
        speed: z
          .number()
          .positive()
          .optional()
          .describe(
            'For run. Scales every duration — 2 runs it twice as fast. Default 1.',
          ),
      }),
    },
    async ({ sessionId, action, name, description, steps, speed }) => {
      const session = getSession(sessionId);
      if (!session) return asTextResponse('Session not found or expired.');
      if (action !== 'list' && !name) {
        return asTextResponse(`A macro name is required to ${action}.`);
      }

      try {
        const result = await session.page.evaluate(
          async (input) => {
            const live = window.__stims_live;
            if (!live?.defineMacro) return { missing: true };
            try {
              switch (input.action) {
                case 'define': {
                  const macro = live.defineMacro({
                    name: input.name as string,
                    description: input.description,
                    steps: (input.steps ?? []) as Parameters<
                      typeof live.defineMacro
                    >[0]['steps'],
                  });
                  return {
                    ok: true,
                    defined: macro.name,
                    steps: macro.steps.length,
                  };
                }
                case 'run':
                  return {
                    ok: true,
                    ran: await live.runMacro(input.name as string, {
                      speed: input.speed,
                    }),
                  };
                case 'delete':
                  return {
                    ok: true,
                    deleted: live.deleteMacro(input.name as string),
                  };
                default:
                  return { ok: true, macros: live.listMacros() };
              }
            } catch (error) {
              return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              };
            }
          },
          { action, name, description, steps, speed },
        );

        if ('missing' in result && result.missing) {
          return asTextResponse(NOT_INSTALLED);
        }
        if (!('ok' in result) || !result.ok) {
          const message =
            'error' in result ? result.error : 'unknown macro failure';
          return asTextResponse(`Macro ${action} failed: ${message}`);
        }
        if ('defined' in result) {
          return asTextResponse(
            `Defined macro "${result.defined}" with ${result.steps} step(s). Run it with action "run".`,
          );
        }
        if ('ran' in result) {
          const ran = result.ran as {
            name: string;
            stepsRun: number;
            elapsedMs: number;
          };
          return asTextResponse(
            `Ran "${ran.name}": ${ran.stepsRun} step(s) in ${ran.elapsedMs}ms.`,
          );
        }
        if ('deleted' in result) {
          return asTextResponse(
            result.deleted ? `Deleted "${name}".` : `No macro named "${name}".`,
          );
        }
        const macros = ('macros' in result ? result.macros : []) as Array<{
          name: string;
          description?: string;
          steps: unknown[];
        }>;
        return asTextResponse(
          macros.length === 0
            ? 'No macros defined yet.'
            : macros
                .map(
                  (m) =>
                    `${m.name} — ${m.steps.length} step(s)${m.description ? `: ${m.description}` : ''}`,
                )
                .join('\n'),
        );
      } catch (e) {
        return asTextResponse(`Error running macro ${action}: ${e}`);
      }
    },
  );

  server.registerTool(
    'session_scene',
    {
      description:
        'Save, recall, list, or delete a named scene — a snapshot of every target position plus the modulators running at the time. Recall ramps into the scene rather than snapping, because a scene change mid-performance is a transition (pass durationMs 0 for a hard cut). Modulators are restored before the ramp so the movement is already running as the parameters arrive. Scenes persist across reloads, so this is where a look you like gets kept.',
      inputSchema: z.object({
        sessionId: z.string().describe('Session ID from start_agent_session.'),
        action: z.enum(['save', 'recall', 'list', 'delete']),
        name: z
          .string()
          .optional()
          .describe('Scene name. Required for save, recall, and delete.'),
        description: z.string().optional().describe('Optional, for save.'),
        durationMs: z
          .number()
          .min(0)
          .max(60_000)
          .optional()
          .describe('For recall. Transition length, default 2000. 0 cuts.'),
        curve: z
          .enum(['linear', 'sine', 'exp'])
          .optional()
          .describe('For recall. Default sine.'),
      }),
    },
    async ({ sessionId, action, name, description, durationMs, curve }) => {
      const session = getSession(sessionId);
      if (!session) return asTextResponse('Session not found or expired.');
      if (action !== 'list' && !name) {
        return asTextResponse(`A scene name is required to ${action}.`);
      }

      try {
        const result = await session.page.evaluate(
          async (input) => {
            const live = window.__stims_live;
            if (!live?.saveScene) return { missing: true };
            try {
              switch (input.action) {
                case 'save':
                  return {
                    ok: true,
                    saved: live.saveScene(
                      input.name as string,
                      input.description,
                    ),
                  };
                case 'recall':
                  return {
                    ok: true,
                    recalled: await live.recallScene(input.name as string, {
                      durationMs: input.durationMs,
                      curve: input.curve,
                    }),
                  };
                case 'delete':
                  return {
                    ok: true,
                    deleted: live.deleteScene(input.name as string),
                  };
                default:
                  return { ok: true, scenes: live.listScenes() };
              }
            } catch (error) {
              return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              };
            }
          },
          { action, name, description, durationMs, curve },
        );

        if ('missing' in result && result.missing) {
          return asTextResponse(NOT_INSTALLED);
        }
        if (!('ok' in result) || !result.ok) {
          const message =
            'error' in result ? result.error : 'unknown scene failure';
          return asTextResponse(`Scene ${action} failed: ${message}`);
        }
        if ('saved' in result) {
          const saved = result.saved as {
            positions: Record<string, number>;
            modulators: unknown[];
          };
          const count = Object.keys(saved.positions).length;
          return asTextResponse(
            count === 0
              ? `Saved "${name}", but no target positions were captured — scenes snapshot what this runtime has driven, so set or ramp something first.`
              : `Saved scene "${name}": ${count} target(s), ${saved.modulators.length} modulator(s).`,
          );
        }
        if ('recalled' in result) {
          const recalled = result.recalled as {
            targets: string[];
            durationMs: number;
            modulators: number;
          };
          return asTextResponse(
            `Recalled "${name}" over ${recalled.durationMs}ms: ${recalled.targets.length} target(s), ${recalled.modulators} modulator(s) restored.`,
          );
        }
        if ('deleted' in result) {
          return asTextResponse(
            result.deleted ? `Deleted "${name}".` : `No scene named "${name}".`,
          );
        }
        const scenes = ('scenes' in result ? result.scenes : []) as Array<{
          name: string;
          description?: string;
          positions: Record<string, number>;
          modulators: unknown[];
        }>;
        return asTextResponse(
          scenes.length === 0
            ? 'No scenes saved yet.'
            : scenes
                .map(
                  (s) =>
                    `${s.name} — ${Object.keys(s.positions).length} target(s), ${s.modulators.length} modulator(s)${s.description ? `: ${s.description}` : ''}`,
                )
                .join('\n'),
        );
      } catch (e) {
        return asTextResponse(`Error running scene ${action}: ${e}`);
      }
    },
  );

  // ── ear ────────────────────────────────────────────────────────────────

  server.registerTool(
    'session_listen',
    {
      description:
        'Measure the live audio over a time window and return the signal envelope — RMS plus bass/mid/treble, a coarse tempo estimate, and current fps/backend. Use this to close the performance loop: after session_play_pattern, listen to confirm the pattern is actually audible and how hard it is hitting before you ramp visuals to match. Reads an AnalyserNode on the real audio graph, NOT the snapshot telemetry in __STIMS_AGENT_TELEMETRY__ (which freezes between engine emissions and so cannot tell silence from a stalled reading); the response states which source was used.',
      inputSchema: z.object({
        sessionId: z.string().describe('Session ID from start_agent_session.'),
        durationMs: z
          .number()
          .min(100)
          .max(30_000)
          .optional()
          .describe('Listening window, default 2000ms.'),
        intervalMs: z
          .number()
          .min(16)
          .max(1000)
          .optional()
          .describe('Sample period, default 50ms.'),
        includeSamples: z
          .boolean()
          .optional()
          .describe(
            'Include the full per-sample series. Default false — summary only, which is usually what you need.',
          ),
      }),
    },
    async ({ sessionId, durationMs, intervalMs, includeSamples }) => {
      const session = getSession(sessionId);
      if (!session) return asTextResponse('Session not found or expired.');

      try {
        const result = await session.page.evaluate(
          async (options) => {
            const live = window.__stims_live;
            if (!live?.listen) return { missing: true };
            try {
              return { ok: true, ...(await live.listen(options)) };
            } catch (error) {
              return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              };
            }
          },
          { durationMs, intervalMs },
        );

        if ('missing' in result && result.missing) {
          return asTextResponse(NOT_INSTALLED);
        }
        if (!('ok' in result) || !result.ok) {
          const message =
            'error' in result ? result.error : 'unknown listen failure';
          return asTextResponse(`Listen failed: ${message}`);
        }

        const data = result as unknown as {
          source: 'stream' | 'telemetry';
          durationMs: number;
          samples: Array<Record<string, number>>;
          rmsMin: number;
          rmsMax: number;
          rmsMean: number;
          estimatedBpm: number | null;
          fps: number;
          backend: string;
          presetId: string | null;
        };

        const round = (n: number) => Math.round(n * 1000) / 1000;
        const lines = [
          data.source === 'stream'
            ? `Measured ${data.durationMs}ms from the live audio graph (${data.samples.length} samples).`
            : `No audio stream attached — these are SNAPSHOT telemetry values, which freeze between engine emissions. Treat a flat reading as "unknown", not "silent". Start audio (session_play_pattern) for a real measurement.`,
          `RMS: mean ${round(data.rmsMean)}, min ${round(data.rmsMin)}, max ${round(data.rmsMax)}`,
          data.rmsMax < 0.001
            ? 'Effectively silent — nothing is reaching the analyser.'
            : '',
          data.estimatedBpm !== null
            ? `Estimated tempo: ~${data.estimatedBpm} bpm (coarse onset count, not a beat tracker).`
            : 'Tempo: not estimable from this window.',
          `Render: ${data.fps} fps on ${data.backend}${data.presetId ? `, preset ${data.presetId}` : ''}.`,
        ].filter(Boolean);

        if (includeSamples) {
          lines.push('', JSON.stringify(data.samples));
        }
        return asTextResponse(lines.join('\n'));
      } catch (e) {
        return asTextResponse(`Error listening: ${e}`);
      }
    },
  );
}
