import { createRoot } from 'react-dom/client';
import './styles.css';
import { Game } from './game/game';
import { App } from './ui/App';
import { loadLocalFonts } from './ui/fonts';

const canvas = document.getElementById('scene');
const uiRoot = document.getElementById('ui');

if (!(canvas instanceof HTMLCanvasElement) || !uiRoot) {
  throw new Error('Scene root is missing from index.html');
}

const sceneCanvas: HTMLCanvasElement = canvas;
const uiElement: HTMLElement = uiRoot;

async function boot() {
  await loadLocalFonts();
  const game = new Game(sceneCanvas);
  createRoot(uiElement).render(<App api={game} />);
}

void boot();
