import * as THREE from 'three';
import type { GameEvent } from '../sim/types';
import type { LevelDef } from '../content/levelTypes';
import type { Settings } from '../ui/types';
import type { RenderFrame } from './types';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { AssetLibrary } from './assets';
import { Atmosphere } from './atmosphere';
import { EnemiesView } from './enemies';
import { Fx } from './fx';
import { LevelView } from './level';
import { Viewmodel } from './viewmodel';

const DEFAULT_SETTINGS: Settings = {
  mouseSensitivity: 1,
  invertY: false,
  fov: 90,
  masterVolume: 1,
  sfxVolume: 1,
  ambienceVolume: 1,
  cameraBob: 1,
  screenShake: 1,
  flashIntensity: 1,
  renderScale: 1,
  showDebug: false,
};

const OVERLAY_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const OVERLAY_FRAG = /* glsl */ `
uniform float uAmount; uniform vec3 uColor; varying vec2 vUv;
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p * vec2(0.9, 1.0));
  float v = 0.1 + 0.9 * smoothstep(0.3, 1.25, r);
  gl_FragColor = vec4(uColor, clamp(uAmount * 0.75 * v, 0.0, 0.6));
}`;

export class GameRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.08, 700);
  private assets = new AssetLibrary();
  private atmosphere: Atmosphere;
  private level: LevelView;
  private enemies: EnemiesView;
  private fx: Fx;
  private viewmodel: Viewmodel | null = null;
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private width = 1280;
  private height = 720;
  private overlayScene = new THREE.Scene();
  private overlayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private overlayMat: THREE.ShaderMaterial;
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private loaded = false;
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector2();
  private lastFov = 90;
  private env: THREE.Texture;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x1c1410, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const pm = new THREE.PMREMGenerator(this.renderer);
    this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.4;
    this.atmosphere = new Atmosphere(this.scene);
    this.fx = new Fx(this.assets);
    this.level = new LevelView(this.assets, this.fx);
    this.enemies = new EnemiesView(this.assets);
    this.scene.add(this.level.group, this.enemies.group, this.fx.group);
    this.fx.setMuzzleProvider((w) => {
      if (!this.viewmodel) return this.camera.position.clone();
      this.viewmodel.muzzleCameraSpace(w, this.tmpV);
      return this.camera.localToWorld(this.tmpV.clone());
    });

    this.overlayMat = new THREE.ShaderMaterial({
      uniforms: { uAmount: { value: 0 }, uColor: { value: new THREE.Color(0xff2010) } },
      vertexShader: OVERLAY_VERT,
      fragmentShader: OVERLAY_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.overlayMat);
    quad.frustumCulled = false;
    this.overlayScene.add(quad);

    this.camera.rotation.order = 'YXZ';
    this.resize(canvas.clientWidth || 1280, canvas.clientHeight || 720);
  }

  /** Loads all models/textures. Never rejects: failed assets fall back to placeholders. */
  async load(onProgress: (f: number, label: string) => void): Promise<void> {
    await this.assets.loadAll(onProgress);
    this.viewmodel = new Viewmodel(this.assets, this.env);
    this.viewmodel.setAspect(this.width / this.height);
    this.loaded = true;
    onProgress(1, 'ready');
  }

  buildLevel(level: LevelDef): void {
    this.level.build(level);
    this.fx.reset();
  }

  resetRun(): void {
    this.fx.reset();
    this.enemies.reset();
  }

  applySettings(s: Settings): void {
    this.settings = { ...s };
    this.applyPixelRatio();
  }

  private applyPixelRatio(): void {
    const base = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(base * Math.max(0.35, Math.min(1, this.settings.renderScale)));
    this.renderer.setSize(this.width, this.height, true);
  }

  resize(w: number, h: number): void {
    this.width = Math.max(1, Math.floor(w));
    this.height = Math.max(1, Math.floor(h));
    this.applyPixelRatio();
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.viewmodel?.setAspect(this.width / this.height);
  }

  handleEvents(events: readonly GameEvent[]): void {
    for (const e of events) this.fx.handleEvent(e);
  }

  /** Converts a horizontal FOV in degrees (at the current aspect) to the vertical FOV three.js wants. */
  private vfov(hdeg: number): number {
    const h = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(hdeg, 40, 130));
    const a = Math.max(this.camera.aspect, 1);
    return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / a));
  }

  render(frame: RenderFrame, dt: number): void {
    const r = this.renderer;
    r.info.reset();
    const cam = this.camera;
    const c = frame.camera;

    // --- camera (+ shake)
    const shake = Math.max(0, c.shake) * this.settings.screenShake;
    const t = frame.time;
    let sx = 0, sy = 0, sr = 0;
    if (shake > 0.001) {
      sx = (Math.sin(t * 61.3) + Math.sin(t * 37.1 + 1.3)) * 0.5 * shake * 0.035;
      sy = (Math.sin(t * 53.7 + 0.7) + Math.sin(t * 29.9)) * 0.5 * shake * 0.035;
      sr = Math.sin(t * 47.1) * shake * 0.018;
    }
    cam.position.set(c.pos.x, c.pos.y, c.pos.z);
    this.euler.set(c.pitch + sy, c.yaw + sx, c.roll + sr, 'YXZ');
    cam.quaternion.setFromEuler(this.euler);
    const hf = c.fov > 1 ? c.fov : this.settings.fov;
    const vf = this.vfov(hf);
    if (Math.abs(vf - this.lastFov) > 0.01) {
      cam.fov = vf;
      cam.updateProjectionMatrix();
      this.lastFov = vf;
    }
    cam.updateMatrixWorld(true);

    const pixelScale = r.getDrawingBufferSize(this.tmpV2).y / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));

    // --- world systems
    this.atmosphere.update(dt, t, cam.position, pixelScale);
    this.enemies.update(frame.enemies, dt, t, cam);
    this.fx.update(frame, dt, cam, pixelScale, this.settings);
    this.level.update(frame, dt, cam.position);
    this.fx.assignLights();

    // --- viewmodel
    const vm = this.viewmodel;
    if (vm) vm.update(frame.viewmodel, dt, this.settings);

    // --- two-pass render
    r.clear(true, true, true);
    r.render(this.scene, cam);
    if (vm) {
      r.clearDepth();
      r.render(vm.scene, vm.camera);
    }
    const amt = frame.flash.amount * (0.35 + 0.65 * this.settings.flashIntensity);
    if (amt > 0.004) {
      this.overlayMat.uniforms.uAmount.value = amt;
      this.overlayMat.uniforms.uColor.value.setHex(frame.flash.color);
      r.clearDepth();
      r.render(this.overlayScene, this.overlayCam);
    }
  }

  stats(): { drawCalls: number; triangles: number } {
    return { drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
  }

  /** Dev helpers. */
  get debug() {
    return { renderer: this.renderer, scene: this.scene, camera: this.camera, assets: this.assets, loaded: this.loaded, viewmodel: this.viewmodel };
  }

  dispose(): void {
    this.fx.dispose();
    this.renderer.dispose();
  }

  get domElement(): HTMLCanvasElement {
    return this.canvas;
  }
}

export type { RenderFrame } from './types';
