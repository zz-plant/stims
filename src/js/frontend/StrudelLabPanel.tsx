import { useEffect, useRef, useState } from 'react';
import styles from '../../css/StrudelLabPanel.module.css';
import {
  loadStrudelBridge,
  type StrudelBridge,
} from './strudel-audio-bridge.ts';
import { useWorkspace } from './workspace-context.tsx';

interface StrudelExample {
  label: string;
  code: string;
}

const EXAMPLES: StrudelExample[] = [
  {
    label: 'Four on the floor',
    code: `stack(
  s("bd*4").gain(1.1),
  s("[~ hh]*4"),
  note("<c2 eb2 f2 g1>").s("sawtooth").lpf(500)
)`,
  },
  {
    label: 'Breakbeat',
    code: `stack(
  s("bd sd [bd bd] sd"),
  s("hh*8").gain("[.3 .8]*4")
)`,
  },
  {
    label: 'Synth only (no samples)',
    code: `note("c3 [e3 g3] b2 [g3 c4]")
  .s("triangle")
  .lpf(800)
  .room(0.3)`,
  },
];

type LabStatus = 'idle' | 'loading' | 'playing' | 'stopped' | 'error';

const STATUS_TEXT: Record<LabStatus, string> = {
  idle: 'Write a pattern, then Play. Audio is teed into the analyser, so bass/mid/treble drive the preset.',
  loading: 'Loading the Strudel engine and drum samples…',
  playing: 'Playing — the visualizer is being driven by this pattern.',
  stopped: 'Stopped. Edit the pattern and Play again.',
  error: 'Pattern failed to evaluate.',
};

export function StrudelLabPanel() {
  const { ui, engine } = useWorkspace();
  const [open, setOpen] = useState(true);
  const [code, setCode] = useState(EXAMPLES[0]?.code ?? '');
  const [status, setStatus] = useState<LabStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const bridgeRef = useRef<StrudelBridge | null>(null);
  const visualizerStartedRef = useRef(false);

  useEffect(() => {
    return () => {
      bridgeRef.current?.hush();
    };
  }, []);

  const handlePlay = async () => {
    setErrorMessage(null);
    try {
      if (!bridgeRef.current) {
        setStatus('loading');
        bridgeRef.current = await loadStrudelBridge();
      }
      const bridge = bridgeRef.current;
      await bridge.evaluate(code);

      if (!visualizerStartedRef.current) {
        const nextRoute = { ...ui.routeState, audioSource: 'file' as const };
        ui.commitRoute(nextRoute);
        await engine.startAudioSource({
          source: 'file',
          stream: bridge.stream,
          launchState: nextRoute,
        });
        visualizerStartedRef.current = true;
      }
      setStatus('playing');
    } catch (error) {
      setStatus('error');
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to start Strudel.',
      );
    }
  };

  const handleStop = () => {
    bridgeRef.current?.hush();
    setStatus('stopped');
  };

  if (!open) {
    return (
      <button
        type="button"
        className={styles.reopenButton}
        onClick={() => setOpen(true)}
      >
        Strudel
      </button>
    );
  }

  return (
    <aside className={styles.panel} aria-label="Strudel pattern lab">
      <header className={styles.header}>
        <h2 className={styles.title}>Strudel × Stims</h2>
        <button
          type="button"
          className={styles.closeButton}
          onClick={() => setOpen(false)}
          aria-label="Collapse Strudel lab"
        >
          ×
        </button>
      </header>

      <div className={styles.examples}>
        {EXAMPLES.map((example) => (
          <button
            key={example.label}
            type="button"
            className={styles.exampleChip}
            onClick={() => setCode(example.code)}
          >
            {example.label}
          </button>
        ))}
      </div>

      <textarea
        className={styles.editor}
        value={code}
        onChange={(event) => setCode(event.target.value)}
        rows={9}
        spellCheck={false}
        aria-label="Strudel pattern code"
      />

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.playButton}
          onClick={() => void handlePlay()}
          disabled={status === 'loading'}
        >
          {status === 'playing' ? 'Update' : 'Play'}
        </button>
        <button
          type="button"
          className={styles.stopButton}
          onClick={handleStop}
          disabled={status !== 'playing'}
        >
          Stop
        </button>
      </div>

      <p className={styles.status} data-tone={status}>
        {errorMessage ?? STATUS_TEXT[status]}
      </p>
    </aside>
  );
}
