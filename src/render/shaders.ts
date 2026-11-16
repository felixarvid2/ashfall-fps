import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const NOISE = /* glsl */ `
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
`;

const FLAME_FRAG = /* glsl */ `
uniform float uTime; uniform float uIntensity; uniform vec3 uCoreColor; uniform vec3 uEdgeColor;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
${NOISE}
void main() {
  float n = vn(vec2(vUv.x * 7.0, vUv.y * 3.0 - uTime * 2.6)) * 0.65 + vn(vec2(vUv.x * 15.0 + 3.0, vUv.y * 6.0 - uTime * 4.1)) * 0.35;
  float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.1);
  float a = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.15) * (0.35 + 0.9 * n) * edge * uIntensity;
  a *= smoothstep(0.0, 0.04, vUv.y);
  vec3 col = mix(uCoreColor, uEdgeColor, clamp(vUv.y * 1.2 + (1.0 - n) * 0.3, 0.0, 1.0));
  gl_FragColor = vec4(col * 1.6, clamp(a, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const BEAM_FRAG = /* glsl */ `
uniform float uTime; uniform float uIntensity; uniform vec3 uColor;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
${NOISE}
void main() {
  float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
  float flow = 0.8 + 0.2 * sin(vUv.y * 40.0 - uTime * 6.0) + 0.1 * vn(vec2(vUv.x * 5.0, vUv.y * 30.0 - uTime * 3.0));
  float a = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 0.35) * edge * flow * uIntensity;
  gl_FragColor = vec4(uColor * 0.9, clamp(a, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function mk(frag: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uIntensity: { value: 1 }, ...uniforms },
    vertexShader: VERT,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

export function makeFlameMaterial(core = 0xfff0b0, edge = 0xff4a08): THREE.ShaderMaterial {
  return mk(FLAME_FRAG, { uCoreColor: { value: new THREE.Color(core) }, uEdgeColor: { value: new THREE.Color(edge) } });
}

export function makeBeamMaterial(color: number): THREE.ShaderMaterial {
  return mk(BEAM_FRAG, { uColor: { value: new THREE.Color(color) } });
}

/** Open, base-at-origin, unit-height cylinder (uv.y: 0 bottom -> 1 top). */
export function columnGeometry(radiusBottom: number, radiusTop: number, segs = 16, hsegs = 8): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(radiusTop, radiusBottom, 1, segs, hsegs, true).translate(0, 0.5, 0);
}

// Sky dome: smoky gradient lit orange from the horizon.
export function makeSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec3 vP;
      ${NOISE}
      void main(){
        vec3 d = normalize(vP);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 horizon = vec3(0.42, 0.17, 0.06);
        vec3 mid = vec3(0.10, 0.065, 0.05);
        vec3 top = vec3(0.025, 0.02, 0.022);
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.28, h));
        c = mix(c, top, smoothstep(0.2, 0.9, h));
        vec2 uv = d.xz / (d.y + 0.35) * 1.4;
        float sm = vn(uv * 1.3 + vec2(uTime * 0.01, 0.0)) * 0.6 + vn(uv * 3.1 - vec2(0.0, uTime * 0.015)) * 0.4;
        c *= 0.55 + 0.9 * sm;
        c += vec3(0.5, 0.18, 0.05) * pow(max(0.0, 1.0 - h * 3.2), 2.0) * (0.4 + 0.6 * sm);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}
