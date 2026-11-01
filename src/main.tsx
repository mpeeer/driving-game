import { createRoot } from 'react-dom/client';
import './styles.css';
import { Game } from './game/game';
import { App } from './ui/App';

const canvas = document.getElementById('scene');
const uiRoot = document.getElementById('ui');

if (!(canvas instanceof HTMLCanvasElement) || !uiRoot) {
  throw new Error('Scene root is missing from index.html');
}

const game = new Game(canvas);
createRoot(uiRoot).render(<App api={game} />);
