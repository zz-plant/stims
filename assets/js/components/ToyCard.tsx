import React from 'react';
import { loadToy } from '../loader';

export interface ToyInfo {
  slug: string;
  title: string;
  description: string;
  module: string;
}

export default function ToyCard({ toy }: { toy: ToyInfo }) {
  const handleClick = () => {
    if (toy.module.endsWith('.js') || toy.module.endsWith('.ts')) {
      loadToy(toy.slug);
    } else {
      window.location.href = toy.module;
    }
  };

  return (
    <div className="webtoy-card" onClick={handleClick}>
      <h3>{toy.title}</h3>
      <p>{toy.description}</p>
    </div>
  );
}
