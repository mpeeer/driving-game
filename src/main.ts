import './styles.css';
import { Game } from './core/game';

const canvas = document.getElementById('gl') as HTMLCanvasElement | null;
const ui = document.getElementById('ui') as HTMLElement | null;

declare global {
  interface Window {
    __RAILBOUND__?: Game;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character] ?? character;
  });
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
    <div class="screen screen-sheet grid place-items-center p-6">
      <div class="panel w-full max-w-lg p-7">
        <div class="data-label">Boot failure / WebGL</div>
        <h1 class="headline mt-3 text-4xl uppercase text-paper">Railbound could not start</h1>
        <p class="mt-3 text-sm leading-relaxed text-muted-foreground">
          This game needs WebGL 2 and a reasonably modern browser. Try Chrome, Edge or Firefox with hardware acceleration enabled.
        </p>
        <pre class="mt-5 overflow-auto border border-border bg-ink p-3 font-mono text-xs leading-relaxed text-danger">${escapeHtml(String(err))}</pre>
      </div>
    </div>
  `;
}
