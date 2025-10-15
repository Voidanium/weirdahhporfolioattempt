import * as THREE from 'three';
import {
  Scene,
  Color,
  PerspectiveCamera,
  WebGLRenderer,
  BufferGeometry,
  BufferAttribute,
  Points,
  Vector2,
  Raycaster,
  Plane,
  Vector3,
  Clock,
  MeshPhysicalMaterial,
  PMREMGenerator,
  PointLight,
  MathUtils,
  ACESFilmicToneMapping,
  Layers,
  PointsMaterial,
  ShaderMaterial,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// --- TOP GLB MODULE ---
// This module manages the separate GLB model that appears in the header
const topGLBState = {
  scene: null,
  camera: null,
  renderer: null,
  model: null,
  headerEl: null,
  canvasEl: null,
  config: { fit: 'height', fitAmount: 0.55 },
  scrollGetter: () => 0,
  headerSpin: 0,
};

async function loadTopGLB(mainScene, mainCamera, { url, initialScale = 1, playAnimations = true }) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  topGLBState.scene = new Scene();
  topGLBState.camera = new PerspectiveCamera(60, 1, 0.1, 1000);
  topGLBState.camera.position.z = 5;
  topGLBState.model = gltf.scene;
  topGLBState.model.scale.set(initialScale, initialScale, initialScale);
  topGLBState.scene.add(topGLBState.model);
  topGLBState.scene.environment = mainScene.environment;
}

function setTopGLBMaterial(material) {
  if (!topGLBState.model) return;
  topGLBState.model.traverse(n => { if (n.isMesh) { n.material = material; } });
}

function setTopGLBScrollProgressGetter(getter) {
  topGLBState.scrollGetter = getter;
}

function topGLBUseHeaderCanvas(headerId, config = {}) {
  topGLBState.headerEl = document.getElementById(headerId);
  if (!topGLBState.headerEl) return;
  topGLBState.config = { ...topGLBState.config, ...config };
  topGLBState.canvasEl = document.createElement('canvas');
  topGLBState.canvasEl.id = 'header-canvas';
  topGLBState.headerEl.prepend(topGLBState.canvasEl);
  topGLBState.renderer = new WebGLRenderer({ canvas: topGLBState.canvasEl, alpha: true, antialias: true });
  topGLBState.renderer.toneMapping = ACESFilmicToneMapping;
}

function setTopGLBHeaderSpin(spin) {
  topGLBState.headerSpin = spin;
}

function updateTopGLBHeaderCanvasLayout() {
  if (!topGLBState.renderer || !topGLBState.headerEl) return;
  const rect = topGLBState.headerEl.getBoundingClientRect();
  topGLBState.renderer.setSize(rect.width, rect.height);
  topGLBState.camera.aspect = rect.width / rect.height;

  const fit = topGLBState.config.fit;
  const fitAmount = topGLBState.config.fitAmount;
  if (fit === 'height') {
    const fov = topGLBState.camera.fov * (Math.PI / 180);
    const h = 2 * Math.tan(fov / 2) * topGLBState.camera.position.z;
    const reqScale = (rect.height * fitAmount) / h;
    topGLBState.model.scale.set(reqScale, reqScale, reqScale);
  } else { /* fit: 'width' */
    const reqScale = (rect.width * fitAmount) / topGLBState.camera.aspect;
    topGLBState.model.scale.set(reqScale, reqScale, reqScale);
  }
  topGLBState.camera.updateProjectionMatrix();
}

function updateTopGLB({ showAt, fullAt }) {
  if (!topGLBState.model) return;
  const scroll = topGLBState.scrollGetter();
  const progress = Math.min(scroll / fullAt, 1.0);
  const opacity = Math.max(0, (scroll - showAt) / (fullAt - showAt));
  topGLBState.model.visible = (opacity > 0);
  if (topGLBState.model.visible) {
    topGLBState.model.rotation.y = topGLBState.headerSpin * performance.now() / 1000;
  }
  if (topGLBState.renderer) {
    topGLBState.canvasEl.style.opacity = opacity;
  }
}

function renderTopGLBHeaderCanvas() {
  if (!topGLBState.renderer || !topGLBState.model || !topGLBState.model.visible) return;
  topGLBState.renderer.render(topGLBState.scene, topGLBState.camera);
}

// --- DOM & THREE.JS SETUP ---
const scene = new Scene();
const camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const DPR = Math.min(window.devicePixelRatio || 1, 2);
const renderer = new WebGLRenderer({ canvas: document.querySelector('#bg'), antialias: true });
renderer.setPixelRatio(DPR);
renderer.setSize(window.innerWidth, window.innerHeight);
camera.position.setZ(12);
renderer.toneMapping = ACESFilmicToneMapping;

// --- POST-PROCESSING (BLOOM) ---
// This pass renders the scene as usual.
const renderScene = new RenderPass(scene, camera);

// This is the bloom pass, which creates the glow effect.
// Parameters are: resolution, strength, radius, threshold.
const bloomPass = new UnrealBloomPass(
  new Vector2(window.innerWidth, window.innerHeight), 
  1.5,  // strength
  0.8, // radius 
  0.85  // threshold
);

renderer.toneMappingExposure = 1.2;
bloomPass.threshold = 0;
bloomPass.strength = 2.0;
bloomPass.radius = 1.0;

// The bloomComposer runs the bloom effect on a separate texture.
// It renders the scene, then applies the bloomPass.
const bloomComposer = new EffectComposer(renderer);
bloomComposer.renderToScreen = false; // We don't draw this to the screen directly.
bloomComposer.addPass(renderScene);
bloomComposer.addPass(bloomPass);

// The finalPass uses a custom shader to combine the original scene
// with the bloom texture created by the bloomComposer.
const finalPass = new ShaderPass(
  new ShaderMaterial({
    uniforms: {
      baseTexture: { value: null },
      bloomTexture: { value: bloomComposer.renderTarget2.texture } // The bloom result.
    },
    vertexShader: document.getElementById('vertexshader').textContent,
    fragmentShader: document.getElementById('fragmentshader').textContent,
    defines: {}
  }), "baseTexture"
);
finalPass.needsSwap = true;

// The finalComposer renders the final image to the screen.
const finalComposer = new EffectComposer(renderer);
finalComposer.addPass(renderScene); // First, the original scene.
finalComposer.addPass(finalPass); 

// --- LIGHTING ---
const worldLight = new PointLight(0xffffff, 30, 50);
scene.add(worldLight);

// --- PARTICLES (SIMPLE) ---
const particleCount = 1500;
const particlesGeo = new THREE.BufferGeometry();
const positions = new Float32Array(particleCount * 3);
for (let i = 0; i < particleCount; i++) {
  const i3 = i * 3;
  const r = 5 + Math.random() * 10;
  const t = Math.random() * Math.PI * 2;
  const p = Math.acos(2 * Math.random() - 1);
  positions[i3] = r * Math.sin(p) * Math.cos(t);
  positions[i3 + 1] = r * Math.sin(p) * Math.sin(t);
  positions[i3 + 2] = r * Math.cos(p);
}
particlesGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

const particleMaterial = new PointsMaterial({
  color: 0xffffff,
  size: 0.1,
  sizeAttenuation: true,
  blending: THREE.AdditiveBlending,
  transparent: true
});

const nebula = new THREE.Points(particlesGeo, particleMaterial);
scene.add(nebula);

// --- MOUSE & SCROLL ---
const mouse = new Vector2();
window.addEventListener('mousemove',(e)=>{mouse.x=(e.clientX/window.innerWidth)*2-1;mouse.y=-(e.clientY/window.innerHeight)*2+1;});
let scrollProgress = 0;
window.addEventListener('scroll', () => {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    if (h > 0) { scrollProgress = window.scrollY / h; }
});

// --- PARTICLE MORPH TARGETS ---
const camState1=new Vector3(0,0,15),camState2=new Vector3(14,-3,8),camState3=new Vector3(0,0,18);
const formation1=new Float32Array(positions),formation2=new Float32Array(particleCount*3),formation3=new Float32Array(particleCount*3);
const beltIR=7,beltOR=15,beltT=2.5,beltTilt=Math.PI/4;for(let i=0;i<particleCount;i++){const i3=i*3,a=Math.random()*Math.PI*2,r=Math.sqrt(Math.random()*(beltOR**2-beltIR**2)+beltIR**2);let x=r*Math.cos(a),z=r*Math.sin(a),y=(Math.random()-.5)*beltT;formation2[i3]=x;formation2[i3+1]=y*Math.cos(beltTilt)-z*Math.sin(beltTilt);formation2[i3+2]=y*Math.sin(beltTilt)+z*Math.cos(beltTilt);};
const sphereR=10;for(let i=0;i<particleCount;i++){const i3=i*3,t=Math.random()*Math.PI*2,p=Math.acos(2*Math.random()-1);formation3[i3]=sphereR*Math.sin(p)*Math.cos(t);formation3[i3+1]=sphereR*Math.sin(p)*Math.sin(t);formation3[i3+2]=sphereR*Math.cos(p);};

// --- ASSET LOADING & SCENE SETUP ---
let worldCrystal;
const rgbeLoader = new RGBELoader();
const pmremGenerator = new PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

rgbeLoader.load('./textures/venice_sunset_1k.hdr', (texture) => {
  const envMap = pmremGenerator.fromEquirectangular(texture).texture;
  pmremGenerator.dispose();
  scene.background = new Color(0x000000);
  scene.environment = envMap;
  scene.environmentIntensity = 0.1;

  const crystalMat = new MeshPhysicalMaterial({metalness:0,roughness:0.05,transmission:1,ior:2.418,thickness:4,specularIntensity:1.0,color:new Color(0xffffff),dispersion:1.5,transparent:true});

  const loader = new GLTFLoader();
  loader.load('./voidanium.glb', async (gltf) => {
    worldCrystal = gltf.scene;
    worldCrystal.traverse(n=>{if(n.isMesh){
      n.material = crystalMat;
      n.frustumCulled = false;
    }});
    scene.add(worldCrystal);
    worldCrystal.position.set(0,0,0);
    worldCrystal.scale.set(25,25,25);

    const metalMat = new MeshPhysicalMaterial({
      metalness: 1.0,
      roughness: 0.22,
      color: new Color(0xb0b3b7),
      envMapIntensity: 1.35,
      clearcoat: 0.5,
      clearcoatRoughness: 0.25,
      iridescence: 0.15,
      iridescenceIOR: 1.3,
      iridescenceThicknessRange: [60, 140]
    });

    await loadTopGLB(scene, camera, { url: './voidaniumTOP.glb', initialScale: 1, playAnimations: true });

    setTopGLBMaterial(metalMat);
    setTopGLBScrollProgressGetter(() => scrollProgress);
    topGLBUseHeaderCanvas('header', { fit: 'height', fitAmount: 0.55, envMap });
    setTopGLBHeaderSpin(0.18);
  });
});

// --- ANIMATION LOOP ---
const clock = new Clock();
const raycaster=new Raycaster(),intersection=new Vector3(),plane=new Plane(new Vector3(0,0,1),0);

function animate() {
  requestAnimationFrame(animate);
  const elapsedTime = clock.getElapsedTime();
  const animProgress = Math.min(scrollProgress / 0.2, 1.0);

  const pInterp = (scrollProgress < .5) ? scrollProgress * 2 : (scrollProgress - .5) * 2;
  const camSrc = (scrollProgress < .5) ? camState1 : camState2;
  const camDst = (scrollProgress < .5) ? camState2 : camState3;
  const pSrc = (scrollProgress < .5) ? formation1 : formation2;
  const pDst = (scrollProgress < .5) ? formation2 : formation3;
  camera.position.lerpVectors(camSrc, camDst, pInterp);
  camera.lookAt(0,0,0);

  if (worldCrystal) {
    worldCrystal.traverse(n => { if(n.isMesh) n.material.opacity = 1 - animProgress });
    worldCrystal.visible = (animProgress < 1.0);
    worldCrystal.rotation.y = 0.3 * elapsedTime;
  }

  const posAttr=particlesGeo.attributes.position;for(let i=0;i<particleCount;i++){const i3=i*3;const tX=MathUtils.lerp(pSrc[i3],pDst[i3],pInterp),tY=MathUtils.lerp(pSrc[i3+1],pDst[i3+1],pInterp),tZ=MathUtils.lerp(pSrc[i3+2],pDst[i3+2],pInterp);posAttr.array[i3]=MathUtils.lerp(posAttr.array[i3],tX,.07);posAttr.array[i3+1]=MathUtils.lerp(posAttr.array[i3+1],tY,.07);posAttr.array[i3+2]=MathUtils.lerp(posAttr.array[i3+2],tZ,.07);}posAttr.needsUpdate=true;nebula.rotation.y=-.05*elapsedTime;
  
  raycaster.setFromCamera(mouse,camera);if(raycaster.ray.intersectPlane(plane,intersection)){const f=40,r=4;for(let i=0;i-d/r));posAttr.array[i3]+=v.x;posAttr.array[i3+1]+=v.y;posAttr.array[i3+2]+=v.z;}}}

  updateTopGLB({ showAt: 0.01, fullAt: 0.12 });
  updateTopGLBHeaderCanvasLayout();

  bloomComposer.render();
  finalComposer.render();

  renderTopGLBHeaderCanvas();
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(DPR);

  bloomComposer.setSize(window.innerWidth, window.innerHeight);
  finalComposer.setSize(window.innerWidth, window.innerHeight);
  
  updateTopGLBHeaderCanvasLayout(); // Also resize the header canvas
});
