import { createAudioSystem, SFX_IDS } from './index';
import type { SfxId } from './types';

// Dev audition page (audio-test.html). Not part of the game build.
const audio = createAudioSystem();
audio.setListener({ x: 0, y: 1.7, z: 0 }, { x: 0, y: 0, z: -1 });

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('audio-test: #app missing');

const status = document.createElement('p');
status.id = 'status';
status.textContent = 'Click a button. Sounds pre-render on first click.';

const controls = document.createElement('div');
controls.className = 'controls';

const addButton = (label: string, onClick: () => void, cls = ''): HTMLButtonElement => {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener('click', () => {
    void audio.resume();
    onClick();
  });
  return b;
};

controls.append(
  addButton('Start ambience', () => audio.startAmbience(), 'wide'),
  addButton('Stop all', () => audio.stopAll(), 'wide'),
  addButton('Positional test (left, 8 m)', () => audio.play('arc_fire', { pos: { x: -8, y: 1.7, z: 0 } }), 'wide'),
  addButton('Positional test (right, 8 m)', () => audio.play('arc_fire', { pos: { x: 8, y: 1.7, z: 0 } }), 'wide'),
  addButton('Voice flood (40 footsteps)', () => {
    for (let i = 0; i < 40; i++) audio.play('footstep', { pos: { x: (i % 8) - 4, y: 0, z: -10 - i * 0.3 } });
  }, 'wide'),
);

const intensity = document.createElement('label');
intensity.className = 'slider';
intensity.textContent = 'Combat intensity ';
const intensityInput = document.createElement('input');
intensityInput.type = 'range';
intensityInput.min = '0';
intensityInput.max = '1';
intensityInput.step = '0.01';
intensityInput.value = '0';
intensityInput.addEventListener('input', () => audio.setIntensity(Number(intensityInput.value)));
intensity.append(intensityInput);

const master = document.createElement('label');
master.className = 'slider';
master.textContent = 'Master ';
const masterInput = document.createElement('input');
masterInput.type = 'range';
masterInput.min = '0';
masterInput.max = '1';
masterInput.step = '0.01';
masterInput.value = '0.8';
masterInput.addEventListener('input', () => audio.setVolumes(Number(masterInput.value), 0.9, 0.7));
master.append(masterInput);

const grid = document.createElement('div');
grid.className = 'grid';
for (const id of SFX_IDS) {
  grid.append(addButton(id, () => audio.play(id as SfxId)));
}

root.append(status, controls, intensity, master, grid);
