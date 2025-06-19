import React from 'react';
import { createRoot } from 'react-dom/client';
import Layout from './components/Layout';
import ToyList from './components/ToyList';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <Layout>
        <ToyList />
      </Layout>
    </React.StrictMode>
  );
}
