import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import {
  BookmarkPlus,
  Box,
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileCode,
  FolderGit2,
  GitBranch,
  Glasses,
  Loader2,
  Mic,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Terminal,
  Upload,
  Volume2,
  Wand2,
} from 'lucide-react';
import type { Course, SmartNoteCard } from '../types';
import { useAccessibility } from './AccessibilityContext';
import { Google3DModelViewer } from './Google3DModelViewer';
import { TiltCard3D } from './TiltCard3D';
import {
  THREE_SCENE_PRESETS,
  type ThreeScenePresetId,
  VisualThreeScene,
} from './VisualThreeScene';

type LabSection = 'code' | 'three' | 'google3d' | 'github';
type CodeLanguage = 'html' | 'javascript' | 'python';

interface VisualStep {
  stepNumber: number;
  title: string;
  stateSummary: string;
  visualAnalogy: string;
  lineRange: string;
}

interface CodeAssistResult {
  title: string;
  plainEnglishSummary: string;
  visualSteps: VisualStep[];
  suggestedCode: string;
  antigravityCodexPrompt: string;
  speakableWalkthrough: string;
}

interface GitHubFileEntry {
  path: string;
  size: number;
  is3DModel: boolean;
  isCode: boolean;
}

interface VisualLabViewProps {
  courses: Course[];
  onSaveSmartNote: (note: Omit<SmartNoteCard, 'id' | 'createdAt'>) => Promise<string | void>;
}

const CODE_TEMPLATES: Record<
  ThreeScenePresetId,
  { label: string; language: CodeLanguage; filename: string; code: string }
> = {
  'neural-network': {
    label: 'Neural Net Visualizer (HTML)',
    language: 'html',
    filename: 'neural_net_visual.html',
    code: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 16px; }
    .panel { max-width: 560px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 16px; border: 1px solid #334155; }
    label { display: flex; justify-content: space-between; font-size: 13px; margin: 10px 0 4px; }
    input[type="range"] { width: 100%; accent-color: #38bdf8; }
    .out { margin-top: 14px; padding: 12px; border-radius: 8px; background: #0f172a; font-family: monospace; font-size: 14px; }
    .bar-wrap { height: 14px; background: #334155; border-radius: 999px; overflow: hidden; margin-top: 8px; }
    .bar { height: 100%; background: linear-gradient(90deg, #38bdf8, #10b981); transition: width 0.2s; }
  </style>
</head>
<body>
  <main class="panel">
    <h1 style="font-size:16px;margin:0 0 8px;">Single Neuron Forward Pass</h1>
    <p style="font-size:12px;color:#cbd5e1;margin:0 0 12px;">Move inputs to watch the ReLU & Sigmoid output update visually.</p>
    <label for="x1">Input x1 <span id="x1v">0.8</span></label>
    <input id="x1" type="range" min="-2" max="2" step="0.1" value="0.8" />
    <label for="x2">Input x2 <span id="x2v">0.5</span></label>
    <input id="x2" type="range" min="-2" max="2" step="0.1" value="0.5" />
    <div class="out" aria-live="polite">
      <div id="calc">z = 0.8*0.8 + 0.5*1.2 - 0.2</div>
      <div class="bar-wrap"><div id="bar" class="bar" style="width:65%"></div></div>
    </div>
  </main>
  <script>
    const x1El = document.getElementById('x1');
    const x2El = document.getElementById('x2');
    function update() {
      const x1 = parseFloat(x1El.value);
      const x2 = parseFloat(x2El.value);
      document.getElementById('x1v').textContent = x1.toFixed(1);
      document.getElementById('x2v').textContent = x2.toFixed(1);
      const z = x1 * 0.8 + x2 * 1.2 - 0.2;
      const prob = 1 / (1 + Math.exp(-z));
      document.getElementById('calc').textContent = 'z = ' + z.toFixed(2) + ' -> sigmoid(z) = ' + (prob * 100).toFixed(1) + '%';
      document.getElementById('bar').style.width = (prob * 100).toFixed(1) + '%';
      console.log('Forward pass z=' + z.toFixed(2) + ', prob=' + prob.toFixed(3));
    }
    x1El.addEventListener('input', update);
    x2El.addEventListener('input', update);
    update();
  </script>
</body>
</html>`,
  },
  'gradient-descent': {
    label: 'Gradient Descent Canvas (HTML)',
    language: 'html',
    filename: 'gradient_descent.html',
    code: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 14px; }
    canvas { width: 100%; max-width: 520px; height: 220px; background: #1e293b; border-radius: 10px; display: block; margin: 0 auto; border: 1px solid #334155; }
    .controls { max-width: 520px; margin: 10px auto 0; display: flex; gap: 8px; align-items: center; justify-content: space-between; font-size: 13px; }
    button { background: #2563eb; color: #fff; border: 0; border-radius: 6px; padding: 8px 12px; cursor: pointer; font-weight: 600; }
  </style>
</head>
<body>
  <canvas id="cv" width="520" height="220" aria-label="Loss parabola J(w) = w squared"></canvas>
  <div class="controls">
    <span id="status" aria-live="polite">w = -3.80, loss = 14.44</span>
    <button id="stepBtn" type="button">Take Gradient Step</button>
  </div>
  <script>
    const cv = document.getElementById('cv');
    const ctx = cv.getContext('2d');
    let w = -3.8;
    const lr = 0.25;
    function draw() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let px = 0; px <= cv.width; px += 4) {
        const wx = ((px / cv.width) * 8) - 4;
        const loss = wx * wx;
        const py = cv.height - 24 - (loss / 16) * (cv.height - 44);
        if (px === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      const bx = ((w + 4) / 8) * cv.width;
      const by = cv.height - 24 - ((w * w) / 16) * (cv.height - 44);
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(bx, by, 8, 0, Math.PI * 2);
      ctx.fill();
      document.getElementById('status').textContent = 'w = ' + w.toFixed(2) + ', loss = ' + (w * w).toFixed(2);
    }
    document.getElementById('stepBtn').addEventListener('click', () => {
      const grad = 2 * w;
      w = w - lr * grad;
      console.log('Gradient=' + grad.toFixed(2) + ', new w=' + w.toFixed(2));
      draw();
    });
    draw();
  </script>
</body>
</html>`,
  },
  transformer: {
    label: 'Python Self-Attention Trace',
    language: 'python',
    filename: 'self_attention_demo.py',
    code: `import math

def dot(a, b):
    return sum(x * y for x, y in zip(a, b))

tokens = ["AI", "helps", "visual", "learners"]
queries = [[1.0, 0.2], [0.4, 0.9], [0.8, 0.7], [0.9, 0.6]]
keys    = [[1.0, 0.1], [0.3, 0.8], [0.9, 0.5], [0.8, 0.7]]

d_k = len(keys[0])
q_visual = queries[2]  # query vector for "visual"

scores = [dot(q_visual, k) / math.sqrt(d_k) for k in keys]
exp_scores = [math.exp(s) for s in scores]
total = sum(exp_scores)
attention_weights = [round(e / total, 3) for e in exp_scores]

for word, weight in zip(tokens, attention_weights):
    print(f"{word}: {weight}")`,
  },
  'binary-tree': {
    label: 'Binary Search Tree (JS)',
    language: 'javascript',
    filename: 'binary_search_tree.js',
    code: `class TreeNode {
  constructor(value) {
    this.value = value;
    this.left = null;
    this.right = null;
  }
}

function insert(root, value) {
  if (!root) return new TreeNode(value);
  if (value < root.value) root.left = insert(root.left, value);
  else root.right = insert(root.right, value);
  return root;
}

let root = null;
[50, 30, 70, 20, 40, 60, 80].forEach((n) => {
  root = insert(root, n);
});

console.log('Root:', root.value);
console.log('Left subtree root:', root.left.value);
console.log('Right subtree root:', root.right.value);`,
  },
};

function buildQuickProceduralGlb(presetId: ThreeScenePresetId): Promise<string> {
  return new Promise((resolve, reject) => {
    const group = new THREE.Group();
    const matA = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.35, metalness: 0.3 });
    const matB = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.32, metalness: 0.4 });
    const matC = new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.32, metalness: 0.35 });

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.4, 0.14, 32),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 }),
    );
    group.add(base);

    if (presetId === 'binary-tree') {
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.35, 24, 24), matB);
      top.position.set(0, 2.2, 0);
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 24), matA);
      l.position.set(-1.1, 1.2, 0);
      const r = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 24), matC);
      r.position.set(1.1, 1.2, 0);
      group.add(top, l, r);
    } else if (presetId === 'transformer') {
      [-1.2, -0.4, 0.4, 1.2].forEach((x, idx) => {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.1 + idx * 0.2, 0.45), idx % 2 === 0 ? matA : matB);
        box.position.set(x, 0.7 + idx * 0.1, 0);
        group.add(box);
      });
    } else {
      [-1.3, 0, 1.3].forEach((x, idx) => {
        const m = idx === 0 ? matA : idx === 1 ? matB : matC;
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 24), m);
        sphere.position.set(x, 1.2, 0);
        group.add(sphere);
        const torus = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.06, 12, 24), matB);
        torus.position.set(x, 1.2, 0);
        torus.rotation.x = Math.PI * 0.35;
        group.add(torus);
      });
    }

    const exporter = new GLTFExporter();
    exporter.parse(
      group,
      (res) => {
        if (res instanceof ArrayBuffer) {
          const blob = new Blob([res], { type: 'model/gltf-binary' });
          resolve(URL.createObjectURL(blob));
        } else {
          reject(new Error('Unexpected GLTF format'));
        }
      },
      (err) => reject(err),
      { binary: true },
    );
  });
}

function buildHtmlPreviewDoc(language: CodeLanguage, code: string): string {
  const bridgeScript = `<script>
(function() {
  var origLog = console.log;
  var origErr = console.error;
  console.log = function() {
    var msg = Array.prototype.slice.call(arguments).map(function(a) {
      return typeof a === 'object' ? JSON.stringify(a) : String(a);
    }).join(' ');
    window.parent.postMessage({ source: 'studytrack-preview', level: 'log', message: msg }, '*');
    origLog.apply(console, arguments);
  };
  console.error = function() {
    var msg = Array.prototype.slice.call(arguments).join(' ');
    window.parent.postMessage({ source: 'studytrack-preview', level: 'error', message: msg }, '*');
    origErr.apply(console, arguments);
  };
  window.onerror = function(msg, src, line) {
    window.parent.postMessage({ source: 'studytrack-preview', level: 'error', message: msg + ' (line ' + line + ')' }, '*');
  };
})();
</script>`;

  if (language === 'javascript') {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:16px;margin:0;}pre{background:#1e293b;padding:12px;border-radius:8px;overflow:auto;}</style>${bridgeScript}</head>
<body>
  <h2 style="font-size:14px;margin:0 0 8px;">JavaScript Visual Console Output</h2>
  <pre id="out">Running...</pre>
  <script>
    const outEl = document.getElementById('out');
    const lines = [];
    const prevLog = console.log;
    console.log = (...args) => {
      lines.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
      outEl.textContent = lines.join('\\n') || '(no console output)';
      prevLog(...args);
    };
    try {
      ${code}
      if (lines.length === 0) outEl.textContent = 'Executed cleanly with 0 console logs.';
    } catch (err) {
      outEl.textContent = 'Error: ' + (err && err.message ? err.message : String(err));
      console.error(err && err.message ? err.message : String(err));
    }
  </script>
</body>
</html>`;
  }

  if (/<head[\s>]/i.test(code)) {
    return code.replace(/<head([\s>])/i, `<head$1${bridgeScript}`);
  }
  return `${bridgeScript}\n${code}`;
}

export function VisualLabView({ courses, onSaveSmartNote }: VisualLabViewProps) {
  const { announce, speak, sciFiMode } = useAccessibility();

  const labContainerRef = useRef<HTMLDivElement | null>(null);
  const [section, setSection] = useState<LabSection>('code');
  const [presetId, setPresetId] = useState<ThreeScenePresetId>('neural-network');

  // Code Editor state
  const [language, setLanguage] = useState<CodeLanguage>('html');
  const [filename, setFilename] = useState('neural_net_visual.html');
  const [code, setCode] = useState(CODE_TEMPLATES['neural-network'].code);
  const [promptInput, setPromptInput] = useState('');
  const [previewNonce, setPreviewNonce] = useState(1);
  const [consoleLogs, setConsoleLogs] = useState<Array<{ level: string; message: string }>>([]);
  const [assistLoading, setAssistLoading] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [assistResult, setAssistResult] = useState<CodeAssistResult | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [savedCodeNote, setSavedCodeNote] = useState(false);
  const [tabIndentMode, setTabIndentMode] = useState(false);

  // Voice Dictation into prompt + Voice-to-Note
  const [dictatingPrompt, setDictatingPrompt] = useState(false);
  const [recordingNote, setRecordingNote] = useState(false);
  const [savingVoiceNote, setSavingVoiceNote] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  // Google 3D Model Viewer state
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [glbTitle, setGlbTitle] = useState('Neural Network 3D Model');
  const [glbDescription, setGlbDescription] = useState(
    'Interactive 3D & AR visual model exported from StudyTrack Visual Lab.',
  );
  const [glbSourceLabel, setGlbSourceLabel] = useState('Procedural GLB');
  const [generatingGlb, setGeneratingGlb] = useState(false);
  const createdBlobUrlsRef = useRef<string[]>([]);

  // GitHub Explorer & Gist state
  const [repoInput, setRepoInput] = useState('mrdoob/three.js');
  const [githubToken, setGithubToken] = useState('');
  const [repoInfo, setRepoInfo] = useState<{
    owner: string;
    repo: string;
    branch: string;
    files: GitHubFileEntry[];
  } | null>(null);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubFilter, setGithubFilter] = useState<'all' | 'models' | 'code'>('all');
  const [githubError, setGithubError] = useState<string | null>(null);
  const [gistUrl, setGistUrl] = useState<string | null>(null);
  const [publishingGist, setPublishingGist] = useState(false);

  const registerBlobUrl = useCallback((url: string) => {
    createdBlobUrlsRef.current.push(url);
    return url;
  }, []);

  useEffect(() => {
    // Generate an initial procedural .glb so Google <model-viewer> works out-of-the-box
    let active = true;
    buildQuickProceduralGlb('neural-network')
      .then((url) => {
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        registerBlobUrl(url);
        setGlbUrl(url);
      })
      .catch(() => {});

    return () => {
      active = false;
      createdBlobUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      createdBlobUrlsRef.current = [];
      recognitionRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [registerBlobUrl]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const payload = event.data as { source?: string; level?: string; message?: string } | null;
      if (payload?.source === 'studytrack-preview' && payload.message) {
        setConsoleLogs((prev) => [
          ...prev.slice(-19),
          { level: payload.level || 'log', message: payload.message || '' },
        ]);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const previewSrcDoc = useMemo(() => {
    if (language === 'python') return '';
    return buildHtmlPreviewDoc(language, code);
  }, [code, language, previewNonce]);

  const handleLoadPresetTemplate = (id: ThreeScenePresetId) => {
    const tpl = CODE_TEMPLATES[id];
    setPresetId(id);
    setLanguage(tpl.language);
    setFilename(tpl.filename);
    setCode(tpl.code);
    setConsoleLogs([]);
    setPreviewNonce((n) => n + 1);
    setSection('code');
    announce(`Loaded ${tpl.label} into Code Editor.`);
  };

  const runCodeAssist = async (
    action: 'explain' | 'debug' | 'visual_trace' | 'generate' | 'refactor' | 'antigravity_prompt',
  ) => {
    setAssistLoading(true);
    setAssistError(null);
    announce(`Running AI visual code assistant: ${action.replace('_', ' ')}`);
    try {
      const resp = await fetch('/api/code/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          language,
          prompt: promptInput,
          action,
          githubContext: repoInfo ? `${repoInfo.owner}/${repoInfo.repo}@${repoInfo.branch}` : '',
        }),
      });
      const data = (await resp.json()) as CodeAssistResult & { error?: string };
      if (!resp.ok) throw new Error(data.error || 'AI Code Assistant failed.');

      setAssistResult(data);
      if ((action === 'generate' || action === 'debug' || action === 'refactor') && data.suggestedCode) {
        setCode(data.suggestedCode);
        setPreviewNonce((n) => n + 1);
      }
      announce(`Ready: ${data.title}. ${data.plainEnglishSummary}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Code assistant request failed.';
      setAssistError(msg);
      announce(msg);
    } finally {
      setAssistLoading(false);
    }
  };

  const handleVoicePromptDictation = () => {
    if (dictatingPrompt && recognitionRef.current) {
      recognitionRef.current.stop();
      setDictatingPrompt(false);
      return;
    }

    const SpeechRec =
      (
        window as unknown as {
          SpeechRecognition?: new () => {
            continuous: boolean;
            interimResults: boolean;
            lang: string;
            onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
            onerror: (() => void) | null;
            onend: (() => void) | null;
            start: () => void;
            stop: () => void;
          };
          webkitSpeechRecognition?: new () => {
            continuous: boolean;
            interimResults: boolean;
            lang: string;
            onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
            onerror: (() => void) | null;
            onend: (() => void) | null;
            start: () => void;
            stop: () => void;
          };
        }
      ).SpeechRecognition ||
      (
        window as unknown as {
          webkitSpeechRecognition?: new () => {
            continuous: boolean;
            interimResults: boolean;
            lang: string;
            onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
            onerror: (() => void) | null;
            onend: (() => void) | null;
            start: () => void;
            stop: () => void;
          };
        }
      ).webkitSpeechRecognition;

    if (!SpeechRec) {
      setVoiceStatus('Live browser speech recognition is unavailable; use Voice-to-Note recording instead.');
      return;
    }

    const rec = new SpeechRec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e) => {
      const parts: string[] = [];
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res && res[0]) parts.push(res[0].transcript);
      }
      setPromptInput(parts.join(' ').trim());
    };
    rec.onerror = () => setDictatingPrompt(false);
    rec.onend = () => setDictatingPrompt(false);
    recognitionRef.current = rec;
    rec.start();
    setDictatingPrompt(true);
    setVoiceStatus('Listening for your coding prompt...');
  };

  const handleToggleLabVoiceNote = async () => {
    if (recordingNote && recorderRef.current) {
      recorderRef.current.stop();
      setRecordingNote(false);
      return;
    }

    setVoiceStatus(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        if (!blob.size) return;
        setSavingVoiceNote(true);
        try {
          const fd = new FormData();
          fd.append('audio', blob, 'lab_voice_note.webm');
          fd.append('courseCode', 'AUTO');
          fd.append('courses', JSON.stringify(courses.map((c) => ({ code: c.code, title: c.title }))));
          const resp = await fetch('/api/voice-memo/transcribe', { method: 'POST', body: fd });
          const data = (await resp.json()) as {
            error?: string;
            transcript?: string;
            smartCard?: Omit<SmartNoteCard, 'id' | 'createdAt'>;
          };
          if (!resp.ok || !data.smartCard) throw new Error(data.error || 'Transcription failed.');
          await onSaveSmartNote(data.smartCard);
          setVoiceStatus(`Saved Voice-to-Note "${data.smartCard.title}" to Smart Notes.`);
          if (!promptInput.trim() && data.transcript) {
            setPromptInput(data.transcript);
          }
          announce(`Saved voice note ${data.smartCard.title}`);
        } catch (err) {
          setVoiceStatus(err instanceof Error ? err.message : 'Voice-to-Note failed.');
        } finally {
          setSavingVoiceNote(false);
        }
      };
      rec.start(250);
      setRecordingNote(true);
      setVoiceStatus('Recording Voice-to-Note... Click Stop when finished.');
    } catch (err) {
      setVoiceStatus(err instanceof Error ? err.message : 'Could not access microphone.');
    }
  };

  const handleSaveCodeAsSmartNote = async () => {
    setSavedCodeNote(false);
    await onSaveSmartNote({
      courseCode: courses[0]?.code || 'GENERAL',
      title: filename || 'Visual Lab Code Snippet',
      cardType: 'code',
      colorTag: 'slate',
      pinned: false,
      content: code,
      codeLanguage: language,
      codeSettings: {
        theme: 'dark',
        showLineNumbers: true,
        wordWrap: false,
        fontSize: 'md',
      },
      checklistItems: [],
      keywords: ['visual-lab', language, 'code-snippet'],
      reminderAt: '',
      sourceLabel: 'Visual Code Lab',
      flashcardHint: assistResult?.plainEnglishSummary || '',
    });
    setSavedCodeNote(true);
    announce('Saved code snippet to Library Smart Notes.');
    window.setTimeout(() => setSavedCodeNote(false), 3000);
  };

  const handleFetchGitHubTree = async () => {
    setGithubLoading(true);
    setGithubError(null);
    try {
      const resp = await fetch('/api/github/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: repoInput, githubToken }),
      });
      const data = (await resp.json()) as {
        owner: string;
        repo: string;
        branch: string;
        files: GitHubFileEntry[];
        error?: string;
      };
      if (!resp.ok) throw new Error(data.error || 'Could not load GitHub repository.');
      setRepoInfo(data);
      announce(`Loaded ${data.files.length} code and 3D files from ${data.owner}/${data.repo}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'GitHub repository fetch failed.';
      setGithubError(msg);
      announce(msg);
    } finally {
      setGithubLoading(false);
    }
  };

  const handleOpenGitHubFile = async (file: GitHubFileEntry) => {
    if (!repoInfo) return;
    setGithubLoading(true);
    setGithubError(null);
    try {
      const resp = await fetch('/api/github/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          branch: repoInfo.branch,
          path: file.path,
          githubToken,
        }),
      });
      const data = (await resp.json()) as {
        isBinary?: boolean;
        base64?: string;
        mimeType?: string;
        content?: string;
        path?: string;
        error?: string;
      };
      if (!resp.ok) throw new Error(data.error || 'Could not load file.');

      if (data.isBinary && data.base64) {
        const bin = atob(data.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: data.mimeType || 'model/gltf-binary' });
        const url = registerBlobUrl(URL.createObjectURL(blob));
        setGlbUrl(url);
        setGlbTitle(file.path.split('/').pop() || file.path);
        setGlbDescription(`3D GLB model loaded from GitHub (${repoInfo.owner}/${repoInfo.repo}).`);
        setGlbSourceLabel('GitHub .GLB');
        setSection('google3d');
        announce(`Loaded 3D model ${file.path} into Google 3D Viewer.`);
      } else if (typeof data.content === 'string') {
        const lower = file.path.toLowerCase();
        const nextLang: CodeLanguage = lower.endsWith('.py')
          ? 'python'
          : lower.endsWith('.html') || lower.endsWith('.htm')
            ? 'html'
            : 'javascript';
        setLanguage(nextLang);
        setFilename(file.path.split('/').pop() || 'github_file');
        setCode(data.content);
        setPreviewNonce((n) => n + 1);
        setSection('code');
        announce(`Loaded ${file.path} into Visual Code Editor.`);
      }
    } catch (err) {
      setGithubError(err instanceof Error ? err.message : 'Could not open GitHub file.');
    } finally {
      setGithubLoading(false);
    }
  };

  const handlePublishGist = async () => {
    setPublishingGist(true);
    setGithubError(null);
    setGistUrl(null);
    try {
      const resp = await fetch('/api/github/gist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          githubToken,
          filename,
          content: code,
          description: `StudyTrack AI Visual Lab: ${filename}`,
          isPublic: false,
        }),
      });
      const data = (await resp.json()) as { url?: string; error?: string };
      if (!resp.ok || !data.url) throw new Error(data.error || 'Could not publish Gist.');
      setGistUrl(data.url);
      announce('Published private GitHub Gist.');
    } catch (err) {
      setGithubError(err instanceof Error ? err.message : 'GitHub Gist failed.');
    } finally {
      setPublishingGist(false);
    }
  };

  const handleGenerateGlbFromPreset = async () => {
    setGeneratingGlb(true);
    try {
      const url = registerBlobUrl(await buildQuickProceduralGlb(presetId));
      const spec = THREE_SCENE_PRESETS.find((p) => p.id === presetId) || THREE_SCENE_PRESETS[0];
      setGlbUrl(url);
      setGlbTitle(spec.title);
      setGlbDescription(spec.shortDesc);
      setGlbSourceLabel('Procedural .GLB');
      announce(`Generated .GLB model for ${spec.title} in Google 3D Viewer.`);
    } finally {
      setGeneratingGlb(false);
    }
  };

  const filteredGithubFiles = useMemo(() => {
    if (!repoInfo) return [];
    return repoInfo.files.filter((f) => {
      if (githubFilter === 'models') return f.is3DModel;
      if (githubFilter === 'code') return f.isCode;
      return true;
    });
  }, [githubFilter, repoInfo]);

  const tabItems: Array<{ id: LabSection; label: string; icon: typeof Code2 }> = [
    { id: 'code', label: 'Code & Live Preview', icon: Code2 },
    { id: 'three', label: '3D / WebXR VR & AR', icon: Glasses },
    { id: 'google3d', label: 'Google 3D & .GLB AR', icon: Box },
    { id: 'github', label: 'GitHub & Antigravity/Codex', icon: FolderGit2 },
  ];

  useEffect(() => {
    if (!sciFiMode || !labContainerRef.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = gsap.context(() => {
      const panels = labContainerRef.current?.querySelectorAll('.scifi-lab-panel');
      if (panels && panels.length > 0) {
        gsap.fromTo(
          panels,
          { opacity: 0, y: 14, scale: 0.99 },
          { opacity: 1, y: 0, scale: 1, duration: 0.38, stagger: 0.06, ease: 'power2.out' },
        );
      }
    }, labContainerRef);

    return () => ctx.revert();
  }, [section, sciFiMode]);

  return (
    <div ref={labContainerRef} className="space-y-6">
      {/* Section Header */}
      <div className="scifi-lab-panel glass-surface gold-border rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="gold-foil-badge px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase rounded">
              Sci-Fi Visual Studio
            </span>
            <span className="text-[11px] font-semibold text-cyan-700 dark:text-cyan-300">
              WCAG 2.1 AA · 3D / AR / VR · GitHub
            </span>
          </div>
          <h1 className="text-xl font-bold neon-gradient-text">
            Visual Code, GitHub &amp; 3D / AR / VR Studio
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Built for visual learners: write or import GitHub code with live previews &amp; step-by-step diagrams,
            explore AI concepts in 3D/VR/AR &amp; Google &lt;model-viewer&gt;, and navigate hands-free with WCAG TalkBack &amp; Voice Input.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Visual Lab Workspaces"
          className="flex flex-wrap items-center gap-2"
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault();
              const idx = tabItems.findIndex((t) => t.id === section);
              const nextIdx =
                (idx + (e.key === 'ArrowRight' ? 1 : -1) + tabItems.length) % tabItems.length;
              setSection(tabItems[nextIdx].id);
              announce(`Switched to ${tabItems[nextIdx].label}`);
            }
          }}
        >
          {tabItems.map((tab) => {
            const Icon = tab.icon;
            const active = section === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setSection(tab.id);
                  announce(`Opened ${tab.label}`);
                }}
                className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors ${
                  active
                    ? 'bg-blue-700 text-white border-blue-700'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* SECTION 1: CODE EDITOR & LIVE VISUAL PREVIEW */}
      {section === 'code' && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
                  Language
                  <select
                    aria-label="Code language"
                    value={language}
                    onChange={(e) => {
                      const next = e.target.value as CodeLanguage;
                      setLanguage(next);
                      setPreviewNonce((n) => n + 1);
                    }}
                    className="bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-900"
                  >
                    <option value="html">HTML / CSS / JS (Live Canvas)</option>
                    <option value="javascript">JavaScript (Console)</option>
                    <option value="python">Python (Visual Trace)</option>
                  </select>
                </label>

                <label className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
                  Starter Template
                  <select
                    aria-label="Load visual learning code template"
                    value={presetId}
                    onChange={(e) => handleLoadPresetTemplate(e.target.value as ThreeScenePresetId)}
                    className="bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-900"
                  >
                    {(Object.keys(CODE_TEMPLATES) as ThreeScenePresetId[]).map((key) => (
                      <option key={key} value={key}>
                        {CODE_TEMPLATES[key].label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleToggleLabVoiceNote()}
                  disabled={savingVoiceNote}
                  aria-pressed={recordingNote}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg ${
                    recordingNote
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-slate-100 text-slate-800 hover:bg-slate-200 border border-slate-300'
                  }`}
                >
                  {savingVoiceNote ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : recordingNote ? (
                    <Square className="w-3.5 h-3.5 fill-current" />
                  ) : (
                    <Mic className="w-3.5 h-3.5" />
                  )}
                  {savingVoiceNote ? 'Saving Voice Note...' : recordingNote ? 'Stop Voice-to-Note' : 'Voice-to-Note'}
                </button>

                <button
                  type="button"
                  onClick={() => void handleSaveCodeAsSmartNote()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-700 text-white hover:bg-emerald-800 rounded-lg"
                >
                  {savedCodeNote ? <Check className="w-3.5 h-3.5" /> : <BookmarkPlus className="w-3.5 h-3.5" />}
                  {savedCodeNote ? 'Saved to Smart Notes' : 'Save Code Note'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setConsoleLogs([]);
                    setPreviewNonce((n) => n + 1);
                    if (language === 'python') {
                      void runCodeAssist('visual_trace');
                    } else {
                      announce('Refreshed live visual preview.');
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-700 text-white hover:bg-blue-800 rounded-lg"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  {language === 'python' ? 'Run Visual Trace' : 'Run Live Preview'}
                </button>
              </div>
            </div>

            {/* AI / Antigravity / Codex Prompt Input + Voice Dictation */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 flex items-center gap-2 bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5">
                <Sparkles className="w-4 h-4 text-blue-700 shrink-0" />
                <input
                  type="text"
                  aria-label="Describe code to generate, debug, or hand off to Antigravity or Codex"
                  value={promptInput}
                  onChange={(e) => setPromptInput(e.target.value)}
                  placeholder="Ask AI or dictate by voice (e.g., 'Build an interactive binary search visualizer with accessible controls')"
                  className="flex-1 bg-transparent text-xs text-slate-900 placeholder:text-slate-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleVoicePromptDictation}
                  aria-pressed={dictatingPrompt}
                  aria-label={dictatingPrompt ? 'Stop voice prompt dictation' : 'Dictate coding prompt by voice'}
                  className={`p-1.5 rounded-md transition-colors ${
                    dictatingPrompt ? 'bg-red-600 text-white' : 'text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <Mic className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={assistLoading}
                  onClick={() => void runCodeAssist('visual_trace')}
                  className="px-2.5 py-1.5 text-xs font-medium bg-slate-900 text-white hover:bg-slate-800 rounded-lg disabled:opacity-60"
                >
                  Visual Trace
                </button>
                <button
                  type="button"
                  disabled={assistLoading}
                  onClick={() => void runCodeAssist('explain')}
                  className="px-2.5 py-1.5 text-xs font-medium bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100 rounded-lg disabled:opacity-60"
                >
                  Explain
                </button>
                <button
                  type="button"
                  disabled={assistLoading}
                  onClick={() => void runCodeAssist('debug')}
                  className="px-2.5 py-1.5 text-xs font-medium bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100 rounded-lg disabled:opacity-60"
                >
                  Debug &amp; WCAG Fix
                </button>
                <button
                  type="button"
                  disabled={assistLoading}
                  onClick={() => void runCodeAssist('generate')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-indigo-700 text-white hover:bg-indigo-800 rounded-lg disabled:opacity-60"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  Generate
                </button>
                <button
                  type="button"
                  disabled={assistLoading}
                  onClick={() => void runCodeAssist('antigravity_prompt')}
                  className="px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-300 text-slate-800 hover:bg-slate-100 rounded-lg disabled:opacity-60"
                >
                  Antigravity / Codex Spec
                </button>
              </div>
            </div>

            {voiceStatus && (
              <p className="text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">
                {voiceStatus}
              </p>
            )}
            {assistError && (
              <p className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                {assistError}
              </p>
            )}
          </div>

          {/* Split Editor + Live Preview */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Code Editor Pane */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
              <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-200">
                <div className="flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-blue-400" />
                  <input
                    type="text"
                    aria-label="Editor file name"
                    value={filename}
                    onChange={(e) => setFilename(e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-white w-44"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTabIndentMode((v) => !v)}
                    aria-pressed={tabIndentMode}
                    className={`px-2 py-1 rounded text-[11px] font-medium ${
                      tabIndentMode ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    Tab Indents: {tabIndentMode ? 'On' : 'Tab Moves Focus (WCAG)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const snippet = code.slice(0, 1400);
                      void speak(`Reading ${filename}, ${language} code: ${snippet}`, { hd: false });
                    }}
                    aria-label="Read code aloud with TalkBack"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px]"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    Read Code
                  </button>
                </div>
              </div>

              <label htmlFor="visual-code-editor" className="sr-only">
                Interactive Code Editor
              </label>
              <textarea
                id="visual-code-editor"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.currentTarget.blur();
                    announce('Exited code editor focus.');
                  } else if (e.key === 'Tab' && tabIndentMode) {
                    e.preventDefault();
                    const el = e.currentTarget;
                    const start = el.selectionStart;
                    const end = el.selectionEnd;
                    const next = `${code.slice(0, start)}  ${code.slice(end)}`;
                    setCode(next);
                    window.requestAnimationFrame(() => {
                      el.selectionStart = el.selectionEnd = start + 2;
                    });
                  }
                }}
                spellCheck={false}
                className="w-full h-[380px] p-4 bg-slate-950 text-slate-100 font-mono text-xs leading-relaxed resize-y focus:outline-none"
              />

              <div className="bg-slate-900 border-t border-slate-800 px-4 py-2 flex items-center justify-between text-[11px] text-slate-400">
                <span>Press Escape to exit editor focus cleanly (WCAG 2.1.2 No Keyboard Trap)</span>
                <span className="tabular-nums">{code.split('\n').length} lines</span>
              </div>
            </div>

            {/* Live Preview & Console / Visual Trace Pane */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
              <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                  <Terminal className="w-4 h-4 text-blue-700" />
                  {language === 'python' ? 'Python Visual Execution Preview' : 'Live Visual Sandbox Preview'}
                </div>
                {language !== 'python' && (
                  <button
                    type="button"
                    onClick={() => {
                      setConsoleLogs([]);
                      setPreviewNonce((n) => n + 1);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-white border border-slate-300 rounded-md hover:bg-slate-100"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Reload
                  </button>
                )}
              </div>

              {language !== 'python' ? (
                <>
                  <iframe
                    key={previewNonce}
                    title="Live code visual preview"
                    sandbox="allow-scripts"
                    srcDoc={previewSrcDoc}
                    className="w-full h-[310px] bg-slate-900 border-0"
                  />
                  <div className="flex-1 bg-slate-950 text-slate-200 p-3 font-mono text-[11px] border-t border-slate-800 max-h-[110px] overflow-y-auto">
                    <div className="text-slate-400 mb-1">Console Output:</div>
                    {consoleLogs.length === 0 ? (
                      <div className="text-slate-500">Interact with your preview above to inspect live logs.</div>
                    ) : (
                      consoleLogs.map((entry, idx) => (
                        <div
                          key={idx}
                          className={entry.level === 'error' ? 'text-rose-400' : 'text-emerald-300'}
                        >
                          &gt; {entry.message}
                        </div>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <div className="p-5 flex-1 flex flex-col justify-center bg-slate-50 space-y-3">
                  <p className="text-sm font-semibold text-slate-900">
                    Python Visual Execution Storyboard
                  </p>
                  <p className="text-xs text-slate-600">
                    Click &ldquo;Run Visual Trace&rdquo; above to see step-by-step variable memory flow, plain-English
                    visual analogies, and TalkBack voice walkthroughs for your Python code.
                  </p>
                  <button
                    type="button"
                    disabled={assistLoading}
                    onClick={() => void runCodeAssist('visual_trace')}
                    className="self-start inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-blue-700 text-white hover:bg-blue-800 rounded-lg"
                  >
                    {assistLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    Trace Python Visually
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Visual Code Storyboard & Antigravity/Codex Output */}
          {assistLoading && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 flex items-center gap-2.5 text-sm text-slate-600">
              <Loader2 className="w-4 h-4 animate-spin text-blue-700" />
              Building visual step-by-step trace &amp; Antigravity/Codex bundle...
            </div>
          )}

          {assistResult && !assistLoading && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">{assistResult.title}</h2>
                  <p className="text-sm text-slate-700 mt-1">{assistResult.plainEnglishSummary}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void speak(assistResult.speakableWalkthrough, { hd: true })}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-blue-700 text-white hover:bg-blue-800 rounded-lg shrink-0"
                >
                  <Volume2 className="w-4 h-4" />
                  TalkBack Walkthrough
                </button>
              </div>

              {assistResult.visualSteps.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {assistResult.visualSteps.map((step) => (
                    <TiltCard3D key={step.stepNumber} goldAccent={step.stepNumber === 1} className="p-4">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="gold-foil-badge px-2 py-0.5 text-[11px] font-bold rounded">
                            Step {step.stepNumber} · {step.title}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500">{step.lineRange}</span>
                        </div>
                        <p className="text-xs text-slate-800 font-semibold pt-1">{step.stateSummary}</p>
                        <p className="text-xs text-slate-600 leading-relaxed">{step.visualAnalogy}</p>
                      </div>
                    </TiltCard3D>
                  ))}
                </div>
              )}

              {assistResult.antigravityCodexPrompt && (
                <div className="border border-indigo-200 bg-indigo-50/50 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-indigo-900">
                      Antigravity / Codex / GitHub Agent Prompt Bundle
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(assistResult.antigravityCodexPrompt);
                        setCopiedPrompt(true);
                        announce('Copied Antigravity and Codex prompt bundle.');
                        window.setTimeout(() => setCopiedPrompt(false), 2500);
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-white border border-indigo-200 text-indigo-900 hover:bg-indigo-100 rounded-md"
                    >
                      {copiedPrompt ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedPrompt ? 'Copied' : 'Copy Bundle'}
                    </button>
                  </div>
                  <pre className="text-xs font-mono text-slate-800 whitespace-pre-wrap leading-relaxed">
                    {assistResult.antigravityCodexPrompt}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SECTION 2: THREE.JS 3D / WEBXR VR & AR */}
      {section === 'three' && (
        <VisualThreeScene
          presetId={presetId}
          onChangePreset={setPresetId}
          onExportToGoogleViewer={(url, title, desc) => {
            registerBlobUrl(url);
            setGlbUrl(url);
            setGlbTitle(title);
            setGlbDescription(desc);
            setGlbSourceLabel('Exported from 3D Lab');
            setSection('google3d');
            announce(`Exported ${title} as .GLB and opened Google 3D Viewer.`);
          }}
          onLoadCodeTemplate={handleLoadPresetTemplate}
        />
      )}

      {/* SECTION 3: GOOGLE <model-viewer> 3D & AR (.GLB / .GLTF) */}
      {section === 'google3d' && (
        <Google3DModelViewer
          modelUrl={glbUrl}
          modelTitle={glbTitle}
          modelDescription={glbDescription}
          sourceLabel={glbSourceLabel}
          generatingGlb={generatingGlb}
          onGenerateFromThreeScene={() => void handleGenerateGlbFromPreset()}
          onUploadLocalGlb={(file) => {
            const url = registerBlobUrl(URL.createObjectURL(file));
            setGlbUrl(url);
            setGlbTitle(file.name);
            setGlbDescription(`Custom local 3D asset (${(file.size / 1024).toFixed(1)} KB).`);
            setGlbSourceLabel('Local Upload');
            announce(`Loaded ${file.name} into Google 3D Viewer.`);
          }}
        />
      )}

      {/* SECTION 4: GITHUB REPOSITORY & ANTIGRAVITY / CODEX */}
      {section === 'github' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                GitHub Code &amp; .GLB 3D Asset Explorer
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                Load any public repository (or pass an optional in-session GitHub Personal Access Token for private repos &amp; Gists).
                Click a code file to open it in the Visual Editor, or click a <code>.glb</code> / <code>.gltf</code> asset to launch it in Google 3D &amp; AR Viewer.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                aria-label="GitHub repository owner and name or URL"
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                placeholder="owner/repo (e.g. mrdoob/three.js)"
                className="sm:col-span-2 bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900"
              />
              <button
                type="button"
                disabled={githubLoading}
                onClick={() => void handleFetchGitHubTree()}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 rounded-lg disabled:opacity-60"
              >
                {githubLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5" />}
                Browse Repo
              </button>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <input
                type="password"
                aria-label="Optional session-only GitHub Personal Access Token"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                placeholder="Optional GitHub PAT (in-memory only for private repos or Gist export)"
                className="flex-1 bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900"
              />
              <div className="flex items-center gap-1">
                {(['all', 'models', 'code'] as const).map((filterKey) => (
                  <button
                    key={filterKey}
                    type="button"
                    onClick={() => setGithubFilter(filterKey)}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border ${
                      githubFilter === filterKey
                        ? 'bg-blue-700 text-white border-blue-700'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {filterKey === 'all' ? 'All' : filterKey === 'models' ? '3D (.GLB)' : 'Code'}
                  </button>
                ))}
              </div>
            </div>

            {githubError && (
              <p className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {githubError}
              </p>
            )}

            {repoInfo ? (
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-[340px] overflow-y-auto">
                <div className="px-3 py-2 bg-slate-50 text-xs font-semibold text-slate-700 sticky top-0">
                  {repoInfo.owner}/{repoInfo.repo} ({repoInfo.branch}) · {filteredGithubFiles.length} matching files
                </div>
                {filteredGithubFiles.map((file) => (
                  <div
                    key={file.path}
                    className="px-3 py-2 flex items-center justify-between gap-2 text-xs hover:bg-slate-50"
                  >
                    <span className="font-mono text-slate-800 truncate">{file.path}</span>
                    <button
                      type="button"
                      onClick={() => void handleOpenGitHubFile(file)}
                      className={`px-2.5 py-1 rounded-md font-medium shrink-0 ${
                        file.is3DModel
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                          : 'bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100'
                      }`}
                    >
                      {file.is3DModel ? 'View in 3D / AR' : 'Open in Editor'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="border border-dashed border-slate-300 rounded-lg p-6 text-center text-xs text-slate-500">
                Click &ldquo;Browse Repo&rdquo; above (e.g. <code>mrdoob/three.js</code> or <code>KhronosGroup/glTF-Sample-Assets</code>) to import code or <code>.glb</code> models directly.
              </div>
            )}
          </div>

          {/* Right column: Gist Push & Antigravity / Codex Handoff */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h2 className="text-base font-bold text-slate-900">
              Export to GitHub, Antigravity &amp; Codex
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Push your active editor file as a private GitHub Gist, download it locally, or generate an Antigravity / Codex task bundle ready for agent execution.
            </p>

            <div className="space-y-2">
              <button
                type="button"
                disabled={publishingGist}
                onClick={() => void handlePublishGist()}
                className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 rounded-lg disabled:opacity-60"
              >
                {publishingGist ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                Push Active File to GitHub Gist
              </button>

              <button
                type="button"
                onClick={() => {
                  const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = filename || 'studytrack_code.txt';
                  a.click();
                  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
                }}
                className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-medium bg-white border border-slate-300 text-slate-800 hover:bg-slate-100 rounded-lg"
              >
                <Download className="w-3.5 h-3.5" />
                Download {filename}
              </button>

              <button
                type="button"
                disabled={assistLoading}
                onClick={() => {
                  setSection('code');
                  void runCodeAssist('antigravity_prompt');
                }}
                className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold bg-indigo-700 text-white hover:bg-indigo-800 rounded-lg"
              >
                <Send className="w-3.5 h-3.5" />
                Build Antigravity / Codex Spec
              </button>
            </div>

            {gistUrl && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 space-y-1">
                <div className="font-semibold">GitHub Gist Created</div>
                <a
                  href={gistUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline font-medium break-all"
                >
                  {gistUrl}
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
