import styles from '../../css/AIBadge.module.css';

/**
 * Small "AI" marker for discovery tools powered by a model or learned
 * embedding. The point is honest labelling: "By sound" / "By look" matching,
 * prompt-to-preset generation and tournament salvage are the only surfaces
 * that depend on a model at all, and a user deciding whether a feature will
 * work offline deserves to know which those are before they try.
 */
export function AIBadge({ label = 'AI' }: { label?: string }) {
  return (
    <span className={styles.badge} title="Powered by a model">
      {label}
    </span>
  );
}
