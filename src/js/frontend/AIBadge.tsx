import styles from '../../css/AIBadge.module.css';

/**
 * Small "AI" marker for a control that sends something to a model when its
 * own label cannot say so. A label that already says "AI" ("Refine with AI",
 * "Let AI pick one") is the marker and takes no badge. Neither does anything
 * answered on this device from shipped data (By look, the compass).
 *
 * `title` names what is sent and that it needs a connection: a visitor
 * deciding whether a feature works offline should know before trying it.
 */
export function AIBadge({ title }: { title: string }) {
  return (
    <span className={styles.badge} title={title}>
      AI
    </span>
  );
}
