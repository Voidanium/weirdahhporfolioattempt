import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const TOP_GLB_URL = './voidaniumTOP.glb';

const _topGLB = {
  object: null,
  mixer: null,
  ready: false,
  opacity: 0
};

let _scrollProgress = 0;
let _getScrollProgress = () => _scrollProgress; // override via setTopGLBScrollProgressGetter
const _clockForTop = new THREE.Clock();

function clamp01(x){ return Math.min(1, Math.max(0, x)); }
function smoothstep(t) { t = clamp01(t); return t * t * (3 - 2 * t); }

function attachInternalScrollIfNeeded() {
  if (window.__topGLBScrollBound) return;
  window.__topGLBScrollBound = true;
  window.addEventListener('scroll', () => {
    const doc = document.documentElement;
    const scrollTop = doc.scrollTop || document.body.scrollTop || 0;
    const max = Math.max(1, doc.scrollHeight - doc.clientHeight);
    _scrollProgress = clamp01(scrollTop / max);
  }, { passive: true });
}

function setOpacity(obj, opacity) {
  if (!obj) return;
  obj.traverse((n) => {
    if ((n.isMesh || n.isPoints) && n.material) {
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      mats.forEach((m) => {
        m.transparent = true;
        m.opacity = opacity;
        m.needsUpdate = true;
      });
    }
  });
}

export function setTopGLBScrollProgressGetter(fn) {
  if (typeof fn === 'function') _getScrollProgress = fn;
}

export async function loadTopGLB(sceneIgnored, cameraIgnored, opts = {}) {
  const {
    url = TOP_GLB_URL,
    useDraco = false,
    initialScale = 1,
    playAnimations = true
  } = opts;

  attachInternalScrollIfNeeded();

  const loader = new GLTFLoader();
  if (useDraco) {
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
    loader.setDRACOLoader(draco);
  }

  const gltf = await loader.loadAsync(url);
  const obj = gltf.scene || gltf.scenes?.[0];
  if (!obj) throw new Error('[TopGLB] GLB has no scene');

  obj.scale.setScalar(initialScale);

  // Make fade-able
  obj.traverse(c => {
    if ((c.isMesh || c.isPoints) && c.material) {
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      mats.forEach((m) => { m.transparent = true; m.depthWrite = false; m.opacity = 0; });
    }
  });

  let mixer = null;
  if (playAnimations && gltf.animations && gltf.animations.length) {
    mixer = new THREE.AnimationMixer(obj);
    gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
  }

  _topGLB.object = obj;
  _topGLB.mixer = mixer;
  _topGLB.ready = true;
  _topGLB.opacity = 0;

  return _topGLB.object;
}

export function updateTopGLB(options = {}) {
  if (!_topGLB.ready || !_topGLB.object) return;

  const delta = _clockForTop.getDelta();
  const {
    showAt = 0.01,
    fullAt = 0.12,
    lerpSpeed = 8
  } = options;

  const sp = clamp01(_getScrollProgress());
  let t = 0;
  if (sp <= showAt) t = 0;
  else if (sp >= fullAt) t = 1;
  else t = (sp - showAt) / Math.max(1e-6, (fullAt - showAt));

  const eased = smoothstep(t);
  const targetOpacity = eased;

  _topGLB.opacity += (targetOpacity - _topGLB.opacity) * Math.min(1, delta * lerpSpeed);
  setOpacity(_topGLB.object, _topGLB.opacity);

  if (_topGLB.mixer) _topGLB.mixer.update(delta);
}

/* --- Header Canvas Overlay (separate transparent canvas above DOM header) --- */

const _headerCanvas = {
  enabled: false,
  renderer: null,
  scene: null,
  camera: null,
  canvas: null,
  pivot: null,
  headerEl: null,
  fit: 'height',
  fitAmount: 0.9,
  offsetX: 0,
  offsetY: 0,
  zIndex: 2147483647,
  DPR: Math.min(window.devicePixelRatio || 1, 2),
  needsLayout: true
};

function _initHeaderCanvas(envMap) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true });
  renderer.setPixelRatio(_headerCanvas.DPR);

  const canvas = renderer.domElement;
  canvas.style.position = 'fixed';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = String(_headerCanvas.zIndex);
  document.body.appendChild(canvas);

  const scene = new THREE.Scene();
  if (envMap) scene.environment = envMap;
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(0, 1, 1);
  scene.add(dir);

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
  cam.position.set(0, 0, 10);

  const pivot = new THREE.Group();
  scene.add(pivot);

  _headerCanvas.renderer = renderer;
  _headerCanvas.canvas = canvas;
  _headerCanvas.scene = scene;
  _headerCanvas.camera = cam;
  _headerCanvas.pivot = pivot;

  window.addEventListener('resize', () => (_headerCanvas.needsLayout = true), { passive: true });
  window.addEventListener('scroll', () => (_headerCanvas.needsLayout = true), { passive: true });
}

export function topGLBUseHeaderCanvas(headerSelectorOrEl, options = {}) {
  if (!_topGLB?.object) {
    console.warn('[TopGLB] Load the top GLB first.');
    return;
  }

  let el = null;
  if (typeof headerSelectorOrEl === 'string') el = document.querySelector(headerSelectorOrEl);
  else if (headerSelectorOrEl && headerSelectorOrEl.nodeType === 1) el = headerSelectorOrEl;

  if (!el) {
    console.warn('[TopGLB] Header element not found:', headerSelectorOrEl);
    return;
  }

  if (!_headerCanvas.renderer) _initHeaderCanvas(options.envMap);

  _headerCanvas.headerEl = el;
  _headerCanvas.fit = options.fit || 'height';
  _headerCanvas.fitAmount = (options.fitAmount ?? 0.9);
  _headerCanvas.offsetX = options.offsetX || 0;
  _headerCanvas.offsetY = options.offsetY || 0;
  if (options.zIndex != null) {
    _headerCanvas.zIndex = options.zIndex;
    _headerCanvas.canvas.style.zIndex = String(options.zIndex);
  }

  const obj = _topGLB.object;
  if (obj.parent) obj.parent.remove(obj);

  obj.traverse((n) => {
    if ((n.isMesh || n.isPoints) && n.material) {
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      mats.forEach((m) => { m.depthTest = false; m.depthWrite = false; });
    }
    if (n.isMesh || n.isPoints) n.renderOrder = 999;
  });

  obj.position.set(0, 0, 0);
  _headerCanvas.pivot.add(obj);

  _headerCanvas.enabled = true;
  _headerCanvas.needsLayout = true;
}

export function updateTopGLBHeaderCanvasLayout() {
  if (!_headerCanvas.enabled || !_headerCanvas.headerEl || !_topGLB.object) return;

  const rect = _headerCanvas.headerEl.getBoundingClientRect();
  const canvas = _headerCanvas.canvas;

  const visible = rect.width > 0 && rect.height > 0;
  canvas.style.display = visible ? 'block' : 'none';
  if (!visible) return;

  canvas.style.left = rect.left + 'px';
  canvas.style.top = rect.top + 'px';
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';

  _headerCanvas.renderer.setSize(rect.width, rect.height, false);

  const cam = _headerCanvas.camera;
  cam.left = -rect.width / 2;
  cam.right = rect.width / 2;
  cam.top = rect.height / 2;
  cam.bottom = -rect.height / 2;
  cam.updateProjectionMatrix();

  _headerCanvas.pivot.position.set(_headerCanvas.offsetX, _headerCanvas.offsetY, 0);

  const box = new THREE.Box3().setFromObject(_topGLB.object);
  const size = new THREE.Vector3();
  box.getSize(size);

  let s = 1;
  if (_headerCanvas.fit === 'height' && size.y > 0) s = (rect.height * _headerCanvas.fitAmount) / size.y;
  else if (_headerCanvas.fit === 'width' && size.x > 0) s = (rect.width * _headerCanvas.fitAmount) / size.x;

  _headerCanvas.pivot.scale.setScalar(s);

  _headerCanvas.needsLayout = false;
}

// Slow spin support
const _headerSpin = { speed: 0, clock: new THREE.Clock() };

export function setTopGLBHeaderSpin(speed = 0.18) {
  _headerSpin.speed = speed;
  _headerSpin.clock.getDelta();
}

export function setTopGLBMaterial(material) {
  if (!_topGLB?.object || !material) return;
  _topGLB.object.traverse((n) => {
    if (n.isMesh) {
      n.material = material; // shared
      n.material.transparent = true;
      n.material.opacity = _topGLB.opacity;
      n.material.needsUpdate = true;
    }
  });
}

export function renderTopGLBHeaderCanvas() {
  if (!_headerCanvas.enabled) return;

  // apply slow spin
  const dt = _headerSpin.clock.getDelta();
  if (_headerSpin.speed && _headerCanvas.pivot) {
    _headerCanvas.pivot.rotation.y += dt * _headerSpin.speed;
  }

  _headerCanvas.renderer.render(_headerCanvas.scene, _headerCanvas.camera);
}
