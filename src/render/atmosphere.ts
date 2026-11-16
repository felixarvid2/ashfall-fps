import * as THREE from 'three';
import { ParticleSystem } from './particles';
import { makeGlowTexture } from './textures';
import { makeSkyMaterial } from './shaders';

/** Fog, lights, sky dome, ash/ember drift. */
export class Atmosphere {
  readonly sky: THREE.Mesh;
  readonly skyMat: THREE.ShaderMaterial;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: ParticleSystem;
  private spawnAcc = 0;
  private ashTex = makeGlowTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0.35)');
  private sunDir = new THREE.Vector3(-0.45, 0.78, 0.42).normalize();
  private tmp = new THREE.Vector3();
  private snap = new THREE.Matrix4();
  private snapInv = new THREE.Matrix4();

  constructor(scene: THREE.Scene) {
    scene.background = new THREE.Color(0x1c1410);
    scene.fog = new THREE.FogExp2(0x1c1410, 0.0185);

    this.skyMat = makeSkyMaterial();
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(450, 24, 16), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0x8a6a58, 0x3a2012, 1.7);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xd09a72, 2.8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1536, 1536);
    const c = this.sun.shadow.camera;
    c.left = c.bottom = -26;
    c.right = c.top = 26;
    c.near = 1;
    c.far = 140;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun, this.sun.target);

    this.ambient = new ParticleSystem(460, this.ashTex, { additive: true, drag: 0, smooth: true });
    scene.add(this.ambient.points);
  }

  update(dt: number, time: number, focus: THREE.Vector3, pixelScale: number): void {
    this.skyMat.uniforms.uTime.value = time;
    this.sky.position.copy(focus);

    // sun follows the player, snapped to shadow texels to avoid shimmer
    const size = 52 / this.sun.shadow.mapSize.x;
    this.snap.lookAt(this.sunDir, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    this.snapInv.copy(this.snap).invert();
    this.tmp.copy(focus).applyMatrix4(this.snapInv);
    this.tmp.x = Math.round(this.tmp.x / size) * size;
    this.tmp.y = Math.round(this.tmp.y / size) * size;
    this.tmp.applyMatrix4(this.snap);
    this.sun.target.position.copy(this.tmp);
    this.sun.position.copy(this.tmp).addScaledVector(this.sunDir, 70);
    this.sun.target.updateMatrixWorld();

    // drifting ash + embers
    this.ambient.setScale(pixelScale);
    this.spawnAcc += dt * 55;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      const r = 16;
      const x = focus.x + (Math.random() - 0.5) * 2 * r;
      const z = focus.z + (Math.random() - 0.5) * 2 * r;
      const y = focus.y + Math.random() * 9 - 1;
      if (Math.random() < 0.3) {
        // ember: rises and flickers
        this.ambient.emit(x, y, z, 0.7 + Math.random() * 0.6, 0.35 + Math.random() * 0.7, (Math.random() - 0.5) * 0.7, 5 + Math.random() * 4, 1, 0.38 + Math.random() * 0.2, 0.08, 0.9, 0.05, 0.035);
      } else {
        // ash: slow fall
        this.ambient.emit(x, y, z, 0.8 + Math.random() * 0.5, -0.25 - Math.random() * 0.25, (Math.random() - 0.5) * 0.5, 6 + Math.random() * 5, 0.55, 0.5, 0.46, 0.4, 0.06, 0.06);
      }
    }
    this.ambient.update(dt);
  }
}
