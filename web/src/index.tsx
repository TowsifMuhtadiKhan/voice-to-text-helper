import React from 'react';
import { createRoot } from 'react-dom/client';
import { WebApp } from './WebApp';
import './styles.css';

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(<WebApp />);
}
