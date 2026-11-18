import '@google/model-viewer';
import { useRef, useState } from 'react';
import {
  Box,
  Download,
  RefreshCw,
  RotateCw,
  Smartphone,
  Upload,
  Volume2,
} from 'lucide-react';
import type { ModelViewerElement } from '../types/custom-elements';
import { useAccessibility } from './AccessibilityContext';

interface Google3DModelViewerProps {
  modelUrl: string | null;
  modelTitle: string;
  modelDescription: string;
  sourceLabel: string;
  generatingGlb: boolean;
  onGenerateFromThreeScene: () => void;
  onUploadLocalGlb: (file: File) => void;
}

export function Google3DModelViewer({
  modelUrl,
  modelTitle,
  modelDescription,
  sourceLabel,
  generatingGlb,
  onGenerateFromThreeScene,
  onUploadLocalGlb,
}: Google3DModelViewerProps) {
  const { speak, announce } = useAccessibility();
  const viewerRef = useRef<ModelViewerElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [arNotice, setArNotice] = useState<string | null>(null);

  const handleResetCamera = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.cameraOrbit = '35deg 68deg 105%';
    viewer.jumpCameraToGoal?.();
    announce('Google 3D viewer camera reset.');
  };

  const handleActivateAR = async () => {
    setArNotice(null);
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (viewer.canActivateAR && viewer.activateAR) {
      try {
        await viewer.activateAR();
        announce('Launching Augmented Reality view.');
        return;
      } catch (err) {
        setArNotice(err instanceof Error ? err.message : 'Could not open AR session.');
        return;
      }
    }
    setArNotice(
      'AR Scene Viewer / Quick Look activates automatically on supported mobile Android/iOS browsers or WebXR headsets. On desktop, drag to inspect in 3D or download the .GLB file.',
    );
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
      <div className="border-b border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3 bg-slate-50">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-slate-900">{modelTitle}</h3>
            <span className="px-2 py-0.5 text-[11px] font-medium bg-blue-50 text-blue-800 border border-blue-200 rounded">
              Google &lt;model-viewer&gt; · {sourceLabel}
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-0.5">{modelDescription}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".glb,.gltf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUploadLocalGlb(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 text-slate-800 hover:bg-slate-100 rounded-lg"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload .GLB / .GLTF
          </button>

          <button
            type="button"
            disabled={generatingGlb}
            onClick={onGenerateFromThreeScene}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-700 text-white hover:bg-blue-800 rounded-lg disabled:opacity-60"
          >
            <Box className="w-3.5 h-3.5" />
            {generatingGlb ? 'Exporting GLB...' : 'Sync 3D Lab Model'}
          </button>
        </div>
      </div>

      <div className="relative h-[380px] sm:h-[420px] w-full bg-slate-900">
        {modelUrl ? (
          <model-viewer
            ref={viewerRef}
            src={modelUrl}
            alt={`Interactive 3D and AR model of ${modelTitle}`}
            camera-controls
            auto-rotate={autoRotate ? true : undefined}
            shadow-intensity="1"
            exposure="1.05"
            ar
            ar-modes="webxr scene-viewer quick-look"
            touch-action="pan-y"
            style={{ width: '100%', height: '100%', display: 'block', backgroundColor: '#0f172a' }}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-slate-200 gap-3">
            <Box className="w-10 h-10 text-blue-400" />
            <p className="text-sm font-medium">
              Click &ldquo;Sync 3D Lab Model&rdquo; or upload a .GLB file to inspect it in Google 3D &amp; AR Viewer.
            </p>
            <button
              type="button"
              onClick={onGenerateFromThreeScene}
              className="px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg"
            >
              Generate Interactive .GLB Now
            </button>
          </div>
        )}
      </div>

      <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAutoRotate((r) => !r)}
            aria-pressed={autoRotate}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-300 text-slate-800 hover:bg-slate-100 rounded-lg"
          >
            <RotateCw className="w-3.5 h-3.5" />
            Auto-Rotate: {autoRotate ? 'On' : 'Off'}
          </button>

          <button
            type="button"
            onClick={handleResetCamera}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-300 text-slate-800 hover:bg-slate-100 rounded-lg"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reset Orbit
          </button>

          <button
            type="button"
            onClick={() => void handleActivateAR()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-700 text-white hover:bg-emerald-800 rounded-lg"
          >
            <Smartphone className="w-3.5 h-3.5" />
            View in AR
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void speak(`${modelTitle}. ${modelDescription}`, { hd: true })}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100 rounded-lg"
          >
            <Volume2 className="w-3.5 h-3.5" />
            Read Model Aloud
          </button>

          {modelUrl && (
            <a
              href={modelUrl}
              download={`${modelTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.glb`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-300 text-slate-800 hover:bg-slate-100 rounded-lg"
            >
              <Download className="w-3.5 h-3.5" />
              Download .GLB
            </a>
          )}
        </div>
      </div>

      {arNotice && (
        <div className="px-4 py-2.5 bg-amber-50 border-t border-amber-200 text-xs text-amber-900">
          {arNotice}
        </div>
      )}
    </div>
  );
}
