import { useEffect } from 'react';
import { loadFromQuery } from '../loader';

export default function ToyDetails() {
  useEffect(() => {
    loadFromQuery();
  }, []);
  return null;
}
