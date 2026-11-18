import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('The editor root element is missing.');
if (new URLSearchParams(location.search).get('view') === 'overlay') {
  void import('./text/OverlayPage.tsx').then(({ renderOverlayPage }) =>
    renderOverlayPage(),
  );
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
