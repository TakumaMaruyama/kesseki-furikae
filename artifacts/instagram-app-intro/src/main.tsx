import { createRoot } from 'react-dom/client';

import App from './App';

import './index.css';

declare global {
  interface Window {
    __replitBeginPortraitPlayback?: () => void;
  }
}

const root = createRoot(document.getElementById('root')!);
const renderVideo = () => root.render(<App />);

if (new URLSearchParams(window.location.search).get('export') === 'portrait') {
  window.__replitBeginPortraitPlayback = renderVideo;
} else {
  renderVideo();
}
