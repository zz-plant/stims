import { useEffect, useRef, useState } from 'react';
import type { MilkdropPresetRenderPreview } from '../milkdrop/preset-preview.ts';
import type { PresetCatalogEntry } from './contracts.ts';
import { PresetArtwork } from './PresetArtwork.tsx';

export type { PresetArtwork as PresetArtworkType } from './PresetArtwork.tsx';

export function SkeletonPresetCard() {
  return (
    <div className="stims-shell__starter-card stims-shell__skeleton--card stims-shell__skeleton">
      <div
        className="stims-shell__preset-art stims-shell__skeleton"
        style={{ minHeight: 164 }}
      />
      <span
        className="stims-shell__starter-label stims-shell__skeleton stims-shell__skeleton--text stims-shell__skeleton--text-sm"
        style={{ height: 14, width: '40%' }}
      />
      <strong
        className="stims-shell__skeleton stims-shell__skeleton--text stims-shell__skeleton--text-md"
        style={{ height: 18 }}
      />
      <span
        className="stims-shell__meta-copy stims-shell__skeleton stims-shell__skeleton--text stims-shell__skeleton--text-sm"
        style={{ height: 14, width: '70%' }}
      />
    </div>
  );
}

export function PresetShelfSection({
  entries,
  summary,
  title,
  titleAction,
  onSelect,
  onQueue,
  presetPreviews,
  onVisible,
}: {
  entries: Array<{
    entry: PresetCatalogEntry;
    label: string;
    summary: string;
  }>;
  summary: string;
  title: string;
  titleAction?: { label: string; onClick: () => void };
  onSelect: (presetId: string) => void;
  onQueue?: (presetId: string) => void;
  presetPreviews: Record<string, MilkdropPresetRenderPreview>;
  onVisible?: () => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const [hasTriggered, setHasTriggered] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queuedByLongPressRef = useRef(false);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!onVisible || hasTriggered) {
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      setHasTriggered(true);
      onVisible();
      return;
    }
    const section = sectionRef.current;
    if (!section) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setHasTriggered(true);
          onVisible();
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [onVisible, hasTriggered]);

  if (entries.length === 0) {
    return null;
  }

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };
  const sectionId = `stims-shelf-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;

  return (
    <section
      ref={sectionRef}
      className="stims-shell__starter-section"
      aria-labelledby={sectionId}
    >
      <div className="stims-shell__section-heading">
        <h2 id={sectionId} className="stims-shell__section-label">
          {title}
        </h2>
        {titleAction ? (
          <button
            type="button"
            className="cta-button ghost stims-shell__section-action"
            onClick={titleAction.onClick}
          >
            {titleAction.label}
          </button>
        ) : null}
        <p className="stims-shell__meta-copy">{summary}</p>
      </div>
      <div className="stims-shell__starter-grid">
        {entries.map(({ entry, label, summary: cardSummary }) => (
          <button
            key={`${title}-${entry.id}`}
            type="button"
            className="stims-shell__starter-card"
            onPointerDown={(event) => {
              if (!onQueue || event.pointerType !== 'touch') return;
              queuedByLongPressRef.current = false;
              longPressTimerRef.current = setTimeout(() => {
                queuedByLongPressRef.current = true;
                onQueue(entry.id);
              }, 550);
            }}
            onPointerMove={clearLongPress}
            onPointerCancel={clearLongPress}
            onPointerUp={clearLongPress}
            onClick={(event) => {
              if (queuedByLongPressRef.current) {
                queuedByLongPressRef.current = false;
                event.preventDefault();
                return;
              }
              onSelect(entry.id);
            }}
          >
            <PresetArtwork
              entry={entry}
              preview={presetPreviews[entry.id] ?? null}
            />
            <span className="stims-shell__starter-label">{label}</span>
            <strong>{entry.title}</strong>
            <span className="stims-shell__meta-copy">{cardSummary}</span>
            {onQueue ? (
              <span className="stims-shell__meta-copy">
                Long-press to queue
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </section>
  );
}
