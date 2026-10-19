import React from 'react';
import { createRoot } from 'react-dom/client';
import { PopupApp } from './PopupApp';

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(<PopupApp />);
}
