// Display formatting for preset names, shared by the OG middleware (which
// writes <title>/og:description) and the OG card renderer, so a shared link's
// text and its image name the preset the same way.

// preset-meta stores titles as they appear in the corpus, which is mostly
// "Author - Name". Repeating the author in a byline underneath reads as a data
// leak, so strip the prefix when the byline will carry it. Slug-derived titles
// additionally arrive as "Eos - Ether - Posession - Phat - Edit"; collapse
// those runs so the result reads as a name rather than a delimiter chain.
export function presentTitle(title: string, author?: string): string {
  let display = title.trim();
  if (author) {
    const prefix = author.trim().toLowerCase();
    const lower = display.toLowerCase();
    for (const sep of [' - ', ' – ', ' — ', ': ']) {
      if (lower.startsWith(prefix + sep)) {
        display = display.slice(prefix.length + sep.length).trim();
        break;
      }
    }
  }
  const parts = display.split(' - ');
  if (parts.length > 2) display = parts.join(' ');
  return display || title.trim();
}
