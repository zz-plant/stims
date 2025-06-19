import React, { useEffect, useState } from 'react';
import ToyCard, { ToyInfo } from './ToyCard';

export default function ToyList() {
  const [toys, setToys] = useState<ToyInfo[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetch('assets/data/toys.json')
      .then((res) => res.json())
      .then((data) => setToys(data));
  }, []);

  const filtered = toys.filter(
    (t) =>
      t.title.toLowerCase().includes(query.toLowerCase()) ||
      t.description.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <>
      <div id="search-container">
        <input
          id="search-bar"
          type="text"
          placeholder="Search toys..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <main id="toy-list" className="webtoy-container">
        {filtered.map((toy) => (
          <ToyCard key={toy.slug} toy={toy} />
        ))}
      </main>
    </>
  );
}
