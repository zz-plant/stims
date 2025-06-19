import React from 'react';
import { createRoot } from 'react-dom/client';
import Layout from './components/Layout';
import ToyDetails from './components/ToyDetails';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <Layout>
        <ToyDetails />
      </Layout>
    </React.StrictMode>
  );
}
