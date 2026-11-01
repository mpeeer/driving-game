import './styles.css';
import { Game } from './core/game';

const canvas = document.getElementById('gl') as HTMLCanvasElement | null;
const ui = document.getElementById('ui') as HTMLElement | null;

declare global {
  interface Window {
    __RAILBOUND__?: Game;
  }
}

if (!canvas || !ui) {
  throw new Error('Railbound: missing canvas or UI root');
}

try {
  if (!window.WebGLRenderingContext) {
    throw new Error('WebGL is not available in this browser.');
  }
  const game = new Game(canvas, ui);
  game.startFromMenu();
  window.__RAILBOUND__ = game;
} catch (err) {
  console.error('Railbound failed to start', err);
  ui.innerHTML = `
    <div class="fatal">
      <div class="brand-mark">RB</div>
      <h1>Railbound could not start</h1>
      <p>This game needs WebGL 2 and a reasonably modern browser. Try Chrome, Edge or Firefox with hardware acceleration enabled.</p>
      <pre>${String(err)}</pre>
    </div>
  `;
}
