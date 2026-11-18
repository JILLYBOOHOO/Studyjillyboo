import type { HTMLAttributes, DetailedHTMLProps } from 'react';

export interface ModelViewerElement extends HTMLElement {
  src?: string;
  alt?: string;
  autoRotate?: boolean;
  cameraControls?: boolean;
  ar?: boolean;
  arModes?: string;
  shadowIntensity?: string | number;
  exposure?: string | number;
  cameraOrbit?: string;
  resetTurntableRotation?: () => void;
  jumpCameraToGoal?: () => void;
  activateAR?: () => Promise<void>;
  canActivateAR?: boolean;
}

type ModelViewerJSXProps = DetailedHTMLProps<
  HTMLAttributes<ModelViewerElement> & {
    src?: string;
    alt?: string;
    poster?: string;
    'camera-controls'?: boolean | string;
    'auto-rotate'?: boolean | string;
    'auto-rotate-delay'?: number | string;
    'shadow-intensity'?: number | string;
    'shadow-softness'?: number | string;
    exposure?: number | string;
    'environment-image'?: string;
    ar?: boolean | string;
    'ar-modes'?: string;
    'ar-scale'?: string;
    'camera-orbit'?: string;
    'touch-action'?: string;
    'interaction-prompt'?: string;
    loading?: 'auto' | 'lazy' | 'eager';
    reveal?: 'auto' | 'manual';
  },
  ModelViewerElement
>;

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': ModelViewerJSXProps;
    }
  }
}

export {};
