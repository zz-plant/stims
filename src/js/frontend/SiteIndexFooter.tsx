/**
 * The site index every page ends with: the visualizer, /presets/, the learn
 * pages, and every topic and author hub. index.html carries the same footer
 * inside #app for the raw HTML (generate-seo writes it from the same
 * sections), and React replaces it with this one on mount.
 *
 * It replaces a one-pixel, `inert` nav: crawlers read its links and nobody
 * could see or follow them.
 */
import { Fragment } from 'react';
import { SITE_INDEX_SECTIONS } from '../../../functions/shared/site-index.ts';
import styles from '../../css/SiteIndexFooter.module.css';

export function SiteIndexFooter() {
  return (
    <footer className={styles.root} data-site-index>
      {SITE_INDEX_SECTIONS.map((section) => (
        <Fragment key={section.heading}>
          <h2 className={styles.heading}>{section.heading}</h2>
          <ul className={styles.links}>
            {section.links.map((link) => (
              <li key={link.href}>
                <a href={link.href}>{link.label}</a>
              </li>
            ))}
          </ul>
        </Fragment>
      ))}
    </footer>
  );
}
