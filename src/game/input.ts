export interface DriveInput {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
}

type Hotkey = (key: string, event: KeyboardEvent) => void;

const GAME_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
]);

export class InputManager {
  private keys = new Set<string>();
  private enabled = true;
  private hotkey: Hotkey;

  constructor(hotkey: Hotkey) {
    this.hotkey = hotkey;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.keys.clear();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (GAME_KEYS.has(event.code)) {
      if (this.enabled) event.preventDefault();
      this.keys.add(event.code);
    }
    if (event.repeat) return;
    this.hotkey(event.code, event);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (GAME_KEYS.has(event.code)) event.preventDefault();
    this.keys.delete(event.code);
  };

  clear = (): void => {
    this.keys.clear();
  };

  read(): DriveInput {
    if (!this.enabled) return { throttle: 0, brake: 0, steer: 0, handbrake: false };
    const forward = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    const back = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    return {
      throttle: forward ? 1 : 0,
      brake: back ? 1 : 0,
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      handbrake: this.keys.has('Space'),
    };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clear);
  }
}
