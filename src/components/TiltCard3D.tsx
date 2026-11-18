import { useRef, useState, type ReactNode } from 'react';
import gsap from 'gsap';
import { useAccessibility } from './AccessibilityContext';

interface TiltCard3DProps {
  children: ReactNode;
  className?: string;
  goldAccent?: boolean;
  maxTilt?: number;
}

export function TiltCard3D({
  children,
  className = '',
  goldAccent = false,
  maxTilt = 7,
}: TiltCard3DProps) {
  const { sciFiMode } = useAccessibility();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const glareRef = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);

  const canTilt = () => {
    if (!sciFiMode || typeof window === 'undefined') return false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    if (window.matchMedia('(pointer: coarse)').matches) return false;
    return true;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canTilt() || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const rotateY = (px - 0.5) * 2 * maxTilt;
    const rotateX = (0.5 - py) * 2 * maxTilt;

    gsap.to(cardRef.current, {
      rotateX,
      rotateY,
      scale: 1.018,
      transformPerspective: 920,
      duration: 0.22,
      ease: 'power2.out',
      overwrite: 'auto',
    });

    if (glareRef.current) {
      glareRef.current.style.opacity = '1';
      glareRef.current.style.background = `radial-gradient(circle at ${Math.round(px * 100)}% ${Math.round(py * 100)}%, ${
        goldAccent ? 'rgba(251, 191, 36, 0.24)' : 'rgba(56, 189, 248, 0.2)'
      }, transparent 62%)`;
    }
  };

  const handlePointerLeave = () => {
    if (!cardRef.current) return;
    gsap.to(cardRef.current, {
      rotateX: 0,
      rotateY: 0,
      scale: 1,
      duration: 0.45,
      ease: 'power3.out',
      overwrite: 'auto',
    });
    if (glareRef.current) {
      glareRef.current.style.opacity = '0';
    }
  };

  return (
    <div
      ref={cardRef}
      data-tilt-card="true"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={() => setFocused(false)}
      className={`relative overflow-hidden rounded-xl transition-colors will-change-transform ${
        goldAccent ? 'glass-surface gold-border' : 'glass-surface neu-surface'
      } ${focused ? 'ring-2 ring-amber-400/70' : ''} ${className}`}
      style={{ transformStyle: 'preserve-3d' }}
    >
      <div
        ref={glareRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200"
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
