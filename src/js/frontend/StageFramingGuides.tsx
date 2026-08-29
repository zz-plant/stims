import styles from '../../css/StageFramingGuides.module.css';

export type FramingRatio = 'off' | '16:9' | '9:16' | '1:1' | '4:5';

type StageFramingGuidesProps = {
  ratio: FramingRatio;
};

export function StageFramingGuides({ ratio }: StageFramingGuidesProps) {
  if (ratio === 'off') return null;

  let width = '100%';
  let height = '100%';

  switch (ratio) {
    case '9:16':
      // 9:16 vertical
      width = 'min(100%, calc(100vh * 9 / 16))';
      height = '100vh';
      break;
    case '1:1':
      // 1:1 square
      width = 'min(100vw, 100vh)';
      height = 'min(100vw, 100vh)';
      break;
    case '4:5':
      // 4:5 vertical
      width = 'min(100%, calc(100vh * 4 / 5))';
      height = '100vh';
      break;
    case '16:9':
      // 16:9 landscape
      width = '100vw';
      height = 'min(100%, calc(100vw * 9 / 16))';
      break;
  }

  return (
    <div className={styles.container} aria-hidden="true">
      <div className={styles.guideFrame} style={{ width, height }}>
        <span className={styles.ratioLabel}>{ratio} Guide</span>
      </div>
    </div>
  );
}
