import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import {
  Box,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Glasses,
  Loader2,
  RotateCcw,
  Volume2,
} from 'lucide-react';
import { useAccessibility } from './AccessibilityContext';

export type ThreeScenePresetId =
  | 'neural-network'
  | 'transformer'
  | 'binary-tree'
  | 'gradient-descent';

interface SceneModuleMetadata {
  id: string;
  label: string;
  role: string;
  explanation: string;
}

interface PresetSpec {
  id: ThreeScenePresetId;
  title: string;
  shortDesc: string;
  modules: SceneModuleMetadata[];
}

export const THREE_SCENE_PRESETS: PresetSpec[] = [
  {
    id: 'neural-network',
    title: 'Neural Network & Backprop',
    shortDesc: 'Input features pass through weighted synapses into hidden & output layers.',
    modules: [
      {
        id: 'input-layer',
        label: 'Input Layer (x1, x2, x3)',
        role: 'Feature Ingestion',
        explanation:
          'Raw features enter the three cyan input nodes. Each node passes a normalized numeric scalar forward along weighted connections.',
      },
      {
        id: 'hidden-layer',
        label: 'Hidden Layer (ReLU Core)',
        role: 'Non-Linear Transformation',
        explanation:
          'Hidden amber rings sum weighted inputs plus bias, then apply ReLU activation so the network can learn non-linear patterns.',
      },
      {
        id: 'output-layer',
        label: 'Output Node (Prediction)',
        role: 'Classification / Loss',
        explanation:
          'The emerald output node computes the final probability prediction and sends gradient error signals backward during backpropagation.',
      },
    ],
  },
  {
    id: 'transformer',
    title: 'Transformer Self-Attention',
    shortDesc: 'Tokens attend across context bridges via Query, Key, and Value vectors.',
    modules: [
      {
        id: 'token-towers',
        label: 'Token Embedding Towers',
        role: 'Sequential Embeddings',
        explanation:
          'Each vertical prism represents a word token embedded with positional encoding so order is preserved in 3D space.',
      },
      {
        id: 'attention-bridges',
        label: 'Multi-Head Attention Arcs',
        role: 'Context Weighting',
        explanation:
          'Curved glowing arcs show attention weights linking related tokens—like how a pronoun attends directly back to its noun.',
      },
      {
        id: 'qkv-core',
        label: 'Q · K^T Softmax Matrix',
        role: 'Scaled Dot-Product',
        explanation:
          'The central slate-and-blue core blends Value vectors weighted by Query-Key similarity scores.',
      },
    ],
  },
  {
    id: 'binary-tree',
    title: 'Binary Search Tree',
    shortDesc: 'Ordered parent-child branches cut search time down to O(log n).',
    modules: [
      {
        id: 'root-node',
        label: 'Root Node (Pivot = 50)',
        role: 'Entry Comparison',
        explanation:
          'Every search starts at the top gold-accented root node. Values smaller branch left; larger values branch right.',
      },
      {
        id: 'left-subtree',
        label: 'Left Subtree (< 50)',
        role: 'Lower Half Partition',
        explanation:
          'The left cyan branch stores all keys strictly less than 50, immediately eliminating half the dataset in one step.',
      },
      {
        id: 'right-subtree',
        label: 'Right Subtree (> 50)',
        role: 'Upper Half Partition',
        explanation:
          'The right emerald branch holds keys greater than 50, allowing balanced recursive traversal.',
      },
    ],
  },
  {
    id: 'gradient-descent',
    title: 'Gradient Descent Valley',
    shortDesc: 'Optimizer steps downhill along the steepest negative slope toward min loss.',
    modules: [
      {
        id: 'loss-surface',
        label: '3D Loss Landscape J(w1, w2)',
        role: 'Error Surface',
        explanation:
          'Height represents training error. High ridges mean poor weights; deep blue basins represent low prediction error.',
      },
      {
        id: 'optimizer-ball',
        label: 'Optimizer Stepper (theta)',
        role: 'Weight Update',
        explanation:
          'The bright amber sphere moves opposite the gradient vector scaled by learning rate alpha until it settles in the valley.',
      },
      {
        id: 'global-minimum',
        label: 'Global Minimum Basin',
        role: 'Optimal Convergence',
        explanation:
          'The emerald target beacon marks the lowest loss point where model weights achieve best accuracy.',
      },
    ],
  },
];

interface VisualThreeSceneProps {
  presetId: ThreeScenePresetId;
  onChangePreset: (id: ThreeScenePresetId) => void;
  onExportToGoogleViewer: (glbUrl: string, title: string, description: string) => void;
  onLoadCodeTemplate?: (presetId: ThreeScenePresetId) => void;
}

function detectSoftwareWebGL(): boolean {
  try {
    const testCanvas = document.createElement('canvas');
    const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      const renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
      return /swiftshader|llvmpipe|softpipe|software/i.test(renderer);
    }
    return false;
  } catch {
    return true;
  }
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(128, 128, 10, 128, 128, 124);
    grad.addColorStop(0, 'rgba(15, 23, 42, 0.42)');
    grad.addColorStop(0.6, 'rgba(15, 23, 42, 0.14)');
    grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createCompositeNode(
  colorHex: number,
  emissiveHex: number,
  radius: number,
  moduleId: string,
): THREE.Group {
  const group = new THREE.Group();
  group.userData.moduleId = moduleId;

  const coreMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: emissiveHex,
    emissiveIntensity: 0.25,
    roughness: 0.32,
    metalness: 0.25,
  });
  const core = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 24), coreMat);
  core.castShadow = true;
  core.receiveShadow = true;
  core.userData.moduleId = moduleId;
  group.add(core);

  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.4,
    metalness: 0.72,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.28, radius * 0.12, 12, 32), ringMat);
  ring.rotation.x = Math.PI * 0.35;
  ring.userData.moduleId = moduleId;
  group.add(ring);

  return group;
}

function createSynapseCylinder(
  start: THREE.Vector3,
  end: THREE.Vector3,
  colorHex: number,
  moduleId: string,
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(end, start);
  const len = dir.length();
  const geom = new THREE.CylinderGeometry(0.035, 0.035, len, 10);
  const mat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.45,
    metalness: 0.3,
    transparent: true,
    opacity: 0.85,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.userData.moduleId = moduleId;
  return mesh;
}

function buildLearningModel(presetId: ThreeScenePresetId): {
  heroGroup: THREE.Group;
  animatedParts: { pulseOrb?: THREE.Mesh; presetId: ThreeScenePresetId };
} {
  const heroGroup = new THREE.Group();
  const animatedParts: { pulseOrb?: THREE.Mesh; presetId: ThreeScenePresetId } = { presetId };

  // Grounding pedestal base
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.72,
    metalness: 0.2,
  });
  const baseMesh = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.14, 48), baseMat);
  baseMesh.position.y = 0.07;
  baseMesh.receiveShadow = true;
  heroGroup.add(baseMesh);

  if (presetId === 'neural-network') {
    const inputs = [-1.3, 0, 1.3].map((z) => new THREE.Vector3(-2.1, 1.6 + (z === 0 ? 0.35 : 0), z));
    const hiddens = [-1.5, -0.5, 0.5, 1.5].map(
      (z, idx) => new THREE.Vector3(0, 1.35 + (idx % 2 === 0 ? 0.6 : 0), z),
    );
    const outputs = [-0.65, 0.65].map((z) => new THREE.Vector3(2.1, 1.75, z));

    inputs.forEach((pos) => {
      const node = createCompositeNode(0x0284c7, 0x0369a1, 0.3, 'input-layer');
      node.position.copy(pos);
      heroGroup.add(node);
    });
    hiddens.forEach((pos) => {
      const node = createCompositeNode(0xd97706, 0xb45309, 0.32, 'hidden-layer');
      node.position.copy(pos);
      heroGroup.add(node);
    });
    outputs.forEach((pos) => {
      const node = createCompositeNode(0x059669, 0x047857, 0.34, 'output-layer');
      node.position.copy(pos);
      heroGroup.add(node);
    });

    inputs.forEach((iPos) => {
      hiddens.forEach((hPos) => {
        heroGroup.add(createSynapseCylinder(iPos, hPos, 0x64748b, 'hidden-layer'));
      });
    });
    hiddens.forEach((hPos) => {
      outputs.forEach((oPos) => {
        heroGroup.add(createSynapseCylinder(hPos, oPos, 0x38bdf8, 'output-layer'));
      });
    });

    const pulse = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 16, 16),
      new THREE.MeshStandardMaterial({
        color: 0xfef08a,
        emissive: 0xfacc15,
        emissiveIntensity: 0.9,
        roughness: 0.25,
      }),
    );
    pulse.position.set(-2.1, 1.95, 0);
    heroGroup.add(pulse);
    animatedParts.pulseOrb = pulse;
  } else if (presetId === 'transformer') {
    const tokenXs = [-2.1, -0.7, 0.7, 2.1];
    tokenXs.forEach((x, idx) => {
      const towerHeight = 1.4 + (idx % 2) * 0.45;
      const tower = new THREE.Mesh(
        new THREE.BoxGeometry(0.65, towerHeight, 0.65),
        new THREE.MeshStandardMaterial({
          color: idx === 1 ? 0x2563eb : 0x334155,
          roughness: 0.38,
          metalness: 0.4,
        }),
      );
      tower.position.set(x, 0.14 + towerHeight / 2, 0.85);
      tower.castShadow = true;
      tower.userData.moduleId = 'token-towers';
      heroGroup.add(tower);

      const cap = createCompositeNode(0x0ea5e9, 0x0284c7, 0.22, 'token-towers');
      cap.position.set(x, 0.32 + towerHeight, 0.85);
      heroGroup.add(cap);
    });

    // Attention arc bridges
    const arcPairs: Array<[number, number, number]> = [
      [-2.1, 0.7, 2.9],
      [-0.7, 2.1, 3.2],
      [-2.1, 2.1, 3.55],
    ];
    arcPairs.forEach(([x1, x2, apex]) => {
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(x1, 1.95, 0.85),
        new THREE.Vector3((x1 + x2) / 2, apex, 0.1),
        new THREE.Vector3(x2, 1.95, 0.85),
      );
      const tubeGeom = new THREE.TubeGeometry(curve, 28, 0.055, 10, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xd97706,
        emissiveIntensity: 0.45,
        roughness: 0.3,
        metalness: 0.4,
      });
      const arc = new THREE.Mesh(tubeGeom, tubeMat);
      arc.userData.moduleId = 'attention-bridges';
      heroGroup.add(arc);
    });

    // Central QKV Softmax Matrix Cube
    const matrixGroup = new THREE.Group();
    matrixGroup.userData.moduleId = 'qkv-core';
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const cell = new THREE.Mesh(
          new THREE.BoxGeometry(0.45, 0.45, 0.45),
          new THREE.MeshStandardMaterial({
            color: r === c ? 0x10b981 : 0x1d4ed8,
            roughness: 0.34,
            metalness: 0.5,
          }),
        );
        cell.position.set((c - 1) * 0.55, 1.15 + (r - 1) * 0.55, -1.1);
        cell.userData.moduleId = 'qkv-core';
        matrixGroup.add(cell);
      }
    }
    heroGroup.add(matrixGroup);
  } else if (presetId === 'binary-tree') {
    const rootPos = new THREE.Vector3(0, 3.1, 0);
    const leftPos = new THREE.Vector3(-1.45, 2.0, 0);
    const rightPos = new THREE.Vector3(1.45, 2.0, 0);
    const llPos = new THREE.Vector3(-2.2, 0.9, 0.4);
    const lrPos = new THREE.Vector3(-0.75, 0.9, -0.4);
    const rlPos = new THREE.Vector3(0.75, 0.9, -0.4);
    const rrPos = new THREE.Vector3(2.2, 0.9, 0.4);

    const rootNode = createCompositeNode(0xf59e0b, 0xd97706, 0.36, 'root-node');
    rootNode.position.copy(rootPos);
    heroGroup.add(rootNode);

    [leftPos, llPos, lrPos].forEach((p, idx) => {
      const n = createCompositeNode(0x0284c7, 0x0369a1, idx === 0 ? 0.3 : 0.24, 'left-subtree');
      n.position.copy(p);
      heroGroup.add(n);
    });

    [rightPos, rlPos, rrPos].forEach((p, idx) => {
      const n = createCompositeNode(0x10b981, 0x047857, idx === 0 ? 0.3 : 0.24, 'right-subtree');
      n.position.copy(p);
      heroGroup.add(n);
    });

    heroGroup.add(createSynapseCylinder(rootPos, leftPos, 0x38bdf8, 'left-subtree'));
    heroGroup.add(createSynapseCylinder(leftPos, llPos, 0x38bdf8, 'left-subtree'));
    heroGroup.add(createSynapseCylinder(leftPos, lrPos, 0x38bdf8, 'left-subtree'));
    heroGroup.add(createSynapseCylinder(rootPos, rightPos, 0x34d399, 'right-subtree'));
    heroGroup.add(createSynapseCylinder(rightPos, rlPos, 0x34d399, 'right-subtree'));
    heroGroup.add(createSynapseCylinder(rightPos, rrPos, 0x34d399, 'right-subtree'));
  } else {
    // Gradient Descent 3D Loss Surface
    const segs = 40;
    const planeGeom = new THREE.PlaneGeometry(5.2, 5.2, segs, segs);
    planeGeom.rotateX(-Math.PI / 2);

    const posAttr = planeGeom.attributes.position;
    const colors: number[] = [];
    const lowColor = new THREE.Color(0x0ea5e9);
    const midColor = new THREE.Color(0x6366f1);
    const highColor = new THREE.Color(0xf97316);

    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      const y =
        1.15 +
        0.24 * (x * x + z * z) -
        0.75 * Math.exp(-((x - 0.85) ** 2 + (z - 0.65) ** 2) * 1.1) +
        0.45 * Math.sin(x * 1.4) * Math.cos(z * 1.4);
      const clampedY = Math.max(0.28, y);
      posAttr.setY(i, clampedY);

      const t = Math.min(1, Math.max(0, (clampedY - 0.45) / 2.2));
      const c = t < 0.5 ? lowColor.clone().lerp(midColor, t * 2) : midColor.clone().lerp(highColor, (t - 0.5) * 2);
      colors.push(c.r, c.g, c.b);
    }
    planeGeom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    planeGeom.computeVertexNormals();

    const surfaceMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.48,
      metalness: 0.15,
      side: THREE.DoubleSide,
    });
    const surfaceMesh = new THREE.Mesh(planeGeom, surfaceMat);
    surfaceMesh.receiveShadow = true;
    surfaceMesh.userData.moduleId = 'loss-surface';
    heroGroup.add(surfaceMesh);

    const minBeacon = createCompositeNode(0x10b981, 0x059669, 0.22, 'global-minimum');
    minBeacon.position.set(0.85, 0.72, 0.65);
    heroGroup.add(minBeacon);

    const optBall = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 24, 24),
      new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        emissive: 0xd97706,
        emissiveIntensity: 0.45,
        roughness: 0.25,
        metalness: 0.4,
      }),
    );
    optBall.position.set(-1.3, 1.9, -1.1);
    optBall.userData.moduleId = 'optimizer-ball';
    heroGroup.add(optBall);
    animatedParts.pulseOrb = optBall;
  }

  return { heroGroup, animatedParts };
}

export function VisualThreeScene({
  presetId,
  onChangePreset,
  onExportToGoogleViewer,
  onLoadCodeTemplate,
}: VisualThreeSceneProps) {
  const { announce, speak } = useAccessibility();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const heroGroupRef = useRef<THREE.Group | null>(null);
  const resetCameraRef = useRef<(() => void) | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  const [selectedModuleIndex, setSelectedModuleIndex] = useState(0);
  const [vrSupported, setVrSupported] = useState(false);
  const [arSupported, setArSupported] = useState(false);
  const [xrError, setXrError] = useState<string | null>(null);
  const [exportingGlb, setExportingGlb] = useState(false);

  const preset =
    THREE_SCENE_PRESETS.find((p) => p.id === presetId) || THREE_SCENE_PRESETS[0];
  const selectedModule = preset.modules[selectedModuleIndex] || preset.modules[0];

  useEffect(() => {
    setSelectedModuleIndex(0);
  }, [presetId]);

  useEffect(() => {
    let active = true;
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr?.isSessionSupported) return;
    xr.isSessionSupported('immersive-vr')
      .then((ok) => {
        if (active) setVrSupported(ok);
      })
      .catch(() => {});
    xr.isSessionSupported('immersive-ar')
      .then((ok) => {
        if (active) setArSupported(ok);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const width = container.clientWidth || 640;
    const height = container.clientHeight || 420;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    scene.fog = new THREE.FogExp2(0x0f172a, 0.045);

    const camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 80);
    const defaultCamPos = new THREE.Vector3(5.6, 4.1, 6.2);
    const defaultTarget = new THREE.Vector3(0, 1.4, 0);
    camera.position.copy(defaultCamPos);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSoftwareGl ? 1 : 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.xr.enabled = true;
    rendererRef.current = renderer;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmrem.dispose();

    // 3-Point studio lighting + contact shadow
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.9);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 2.2);
    keyLight.position.set(5, 8, 6);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.9);
    rimLight.position.set(-6, 4, -5);
    scene.add(rimLight);

    const grid = new THREE.GridHelper(16, 20, 0x334155, 0x1e293b);
    grid.position.y = 0.005;
    scene.add(grid);

    const shadowTex = createContactShadowTexture();
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(8.2, 8.2),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = 0.01;
    scene.add(shadowPlane);

    const { heroGroup, animatedParts } = buildLearningModel(presetId);
    heroGroupRef.current = heroGroup;
    scene.add(heroGroup);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.07;
    controls.minDistance = 3.2;
    controls.maxDistance = 14;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.target.copy(defaultTarget);
    controls.update();

    resetCameraRef.current = () => {
      camera.position.copy(defaultCamPos);
      controls.target.copy(defaultTarget);
      controls.update();
    };

    // Raycaster click-to-inspect
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent) => {
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (dist > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(heroGroup.children, true);
      for (const hit of hits) {
        const modId = hit.object.userData?.moduleId as string | undefined;
        if (modId) {
          const idx = preset.modules.findIndex((m) => m.id === modId);
          if (idx >= 0) {
            setSelectedModuleIndex(idx);
            announce(`${preset.modules[idx].label}: ${preset.modules[idx].role}`);
            break;
          }
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
    resizeObserver.observe(container);

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clock = new THREE.Clock();

    renderer.setAnimationLoop(() => {
      const t = clock.getElapsedTime();
      if (!prefersReducedMotion && animatedParts.pulseOrb) {
        if (animatedParts.presetId === 'neural-network') {
          const u = (t * 0.45) % 1;
          animatedParts.pulseOrb.position.set(-2.1 + u * 4.2, 1.75 + Math.sin(u * Math.PI) * 0.45, Math.sin(u * 4) * 0.45);
        } else if (animatedParts.presetId === 'gradient-descent') {
          const u = (Math.sin(t * 0.85) + 1) * 0.5;
          const x = -1.25 + u * 2.1;
          const z = -1.05 + u * 1.7;
          const y =
            1.15 +
            0.24 * (x * x + z * z) -
            0.75 * Math.exp(-((x - 0.85) ** 2 + (z - 0.65) ** 2) * 1.1) +
            0.45 * Math.sin(x * 1.4) * Math.cos(z * 1.4) +
            0.24;
          animatedParts.pulseOrb.position.set(x, Math.max(0.52, y), z);
        }
      }
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.setAnimationLoop(null);
      controls.dispose();
      envTarget.dispose();
      shadowTex.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => m?.dispose());
        }
      });
      renderer.dispose();
      rendererRef.current = null;
      heroGroupRef.current = null;
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [announce, preset.modules, presetId]);

  const handleLaunchXR = async (mode: 'immersive-vr' | 'immersive-ar') => {
    setXrError(null);
    try {
      const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
      const renderer = rendererRef.current;
      if (!xr || !renderer) {
        setXrError('WebXR device not detected on this browser. Orbit with mouse or keyboard.');
        return;
      }
      const session = await xr.requestSession(mode, {
        optionalFeatures: ['local-floor', 'bounded-floor'],
      });
      await renderer.xr.setSession(session);
      announce(`${mode === 'immersive-vr' ? 'VR' : 'AR'} session started.`);
    } catch (err) {
      setXrError(err instanceof Error ? err.message : 'Could not enter WebXR session.');
    }
  };

  const handleExportGlb = useCallback(
    (downloadOnly = false) => {
      const hero = heroGroupRef.current;
      if (!hero) return;
      setExportingGlb(true);
      const exporter = new GLTFExporter();
      exporter.parse(
        hero,
        (result) => {
          setExportingGlb(false);
          if (result instanceof ArrayBuffer) {
            const blob = new Blob([result], { type: 'model/gltf-binary' });
            const url = URL.createObjectURL(blob);
            if (downloadOnly) {
              const a = document.createElement('a');
              a.href = url;
              a.download = `${preset.id}.glb`;
              a.click();
              window.setTimeout(() => URL.revokeObjectURL(url), 4000);
            } else {
              onExportToGoogleViewer(url, preset.title, preset.shortDesc);
            }
          }
        },
        () => {
          setExportingGlb(false);
          setXrError('Could not export 3D model to GLB.');
        },
        { binary: true },
      );
    },
    [onExportToGoogleViewer, preset.id, preset.shortDesc, preset.title],
  );

  const stepModule = (delta: number) => {
    const next = (selectedModuleIndex + delta + preset.modules.length) % preset.modules.length;
    setSelectedModuleIndex(next);
    const mod = preset.modules[next];
    announce(`${mod.label}: ${mod.explanation}`);
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
      {/* Top Concept Switcher */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="3D Visual AI and CS Concepts"
          className="flex flex-wrap items-center gap-1.5"
        >
          {THREE_SCENE_PRESETS.map((p) => {
            const active = p.id === presetId;
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  onChangePreset(p.id);
                  announce(`Loaded 3D scene: ${p.title}`);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                {p.title}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => resetCameraRef.current?.()}
            aria-label="Reset 3D camera view"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 rounded-lg"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset View
          </button>

          <button
            type="button"
            disabled={exportingGlb}
            onClick={() => handleExportGlb(false)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg disabled:opacity-60"
          >
            {exportingGlb ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Box className="w-3.5 h-3.5" />}
            Open in Google 3D / AR
          </button>

          <button
            type="button"
            disabled={exportingGlb}
            onClick={() => handleExportGlb(true)}
            aria-label="Download scene as GLB file"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 rounded-lg"
          >
            <Download className="w-3.5 h-3.5" />
            .GLB
          </button>
        </div>
      </div>

      {/* Isolated WebGL Viewport (zero backdrop-blur overlays) */}
      <div className="relative h-[400px] sm:h-[440px] w-full bg-slate-950">
        <div
          ref={mountRef}
          tabIndex={0}
          role="application"
          aria-label={`Interactive 3D visualization of ${preset.title}. Drag to rotate, scroll to zoom, or use Left and Right Arrow keys on the module dock below.`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              stepModule(1);
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              stepModule(-1);
            }
          }}
          className="w-full h-full focus:outline-none"
        />

        {/* Compact XR Capabilities Strip */}
        <div className="absolute top-3 right-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleLaunchXR('immersive-vr')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border ${
              vrSupported
                ? 'bg-indigo-600 border-indigo-400 text-white hover:bg-indigo-500'
                : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
            title={
              vrSupported
                ? 'Enter WebXR Virtual Reality'
                : 'WebXR headset not connected; click Open in Google 3D / AR or view in 3D orbit'
            }
          >
            <Glasses className="w-3.5 h-3.5" />
            {vrSupported ? 'Enter VR' : 'VR Ready'}
          </button>

          <button
            type="button"
            onClick={() => void handleLaunchXR('immersive-ar')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border ${
              arSupported
                ? 'bg-emerald-600 border-emerald-400 text-white hover:bg-emerald-500'
                : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            {arSupported ? 'Enter AR' : 'WebXR AR'}
          </button>
        </div>
      </div>

      {/* Collapsible / Keyboard-Navigable Bottom Inspector Dock */}
      <div className="bg-slate-900 border-t border-slate-800 p-4 text-slate-100 space-y-3">
        {xrError && (
          <p className="text-xs text-amber-300 bg-slate-800 border border-amber-500/40 rounded-lg px-3 py-2">
            {xrError}
          </p>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => stepModule(-1)}
              aria-label="Inspect previous 3D component"
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-400">
                {selectedModule.role} ({selectedModuleIndex + 1}/{preset.modules.length})
              </p>
              <h3 className="text-sm font-bold text-white">{selectedModule.label}</h3>
            </div>
            <button
              type="button"
              onClick={() => stepModule(1)}
              aria-label="Inspect next 3D component"
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                void speak(`${selectedModule.label}. ${selectedModule.explanation}`, { hd: true })
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg"
            >
              <Volume2 className="w-3.5 h-3.5" />
              Read 3D Explanation
            </button>
            {onLoadCodeTemplate && (
              <button
                type="button"
                onClick={() => onLoadCodeTemplate(preset.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg"
              >
                Load Matching Code
              </button>
            )}
          </div>
        </div>

        <p className="text-sm text-slate-300 leading-relaxed">{selectedModule.explanation}</p>
      </div>
    </div>
  );
}
