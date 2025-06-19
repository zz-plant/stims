import React from 'react';
import DarkModeToggle from './DarkModeToggle';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="content">
      <header>
        <DarkModeToggle />
        <h1>Stim Webtoys Library</h1>
        <p>
          Explore a collection of interactive visual experiences to engage your
          senses and spark creativity.
        </p>
      </header>
      {children}
      <footer>
        <p>
          Curious about how these work?
          <a
            href="https://github.com/zz-plant/stims"
            target="_blank"
            rel="noopener noreferrer"
          >
            Check out our open-source project.
          </a>
        </p>
      </footer>
    </div>
  );
}
