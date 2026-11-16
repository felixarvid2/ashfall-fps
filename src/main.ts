import './styles/ui.css';
import { Game, parseDevParams } from './game/game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;
const errorBox = document.getElementById('boot-error') as HTMLElement;

function showError(err: unknown): void {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  errorBox.style.display = 'flex';
  errorBox.style.whiteSpace = 'pre-wrap';
  errorBox.textContent = `ASHFALL: SLAGWIRE failed to start\n\n${msg}`;
}

const dev = parseDevParams(window.location.search);
const game = new Game(canvas, uiRoot, dev);
if (dev.active) (window as unknown as { __ashfall: Game }).__ashfall = game;
game.boot().catch(showError);
window.addEventListener('unhandledrejection', (e) => console.error('[ashfall] unhandled rejection', e.reason));
