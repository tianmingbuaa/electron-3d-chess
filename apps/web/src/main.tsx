import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root container is missing');

const rootElement = document.documentElement;
if (/Mac|iPhone|iPad/.test(navigator.platform)) rootElement.classList.add('is-mac');

createRoot(container).render(<App />);
