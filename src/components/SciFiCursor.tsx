import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useAccessibility } from './AccessibilityContext';

export function SciFiCursor() {
  const { customCursorEnabled, sciFiMode } = useAccessibility();
  const ringRef = useRef<HTMLDivElement | null>(null);
  const dotRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);
  const [hoverInteractive, setHoverInteractive] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const finePointer = window.matchMedia('(pointer: fine)').matches;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const shouldActivate = Boolean(customCursorEnabled && sciFiMode && finePointer && !reducedMotion);

    setActive(shouldActivate);
    document.documentElement.classList.toggle('custom-cursor-active', shouldActivate);

    return () => {
      document.documentElement.classList.remove('custom-cursor-active');
    };
  }, [customCursorEnabled, sciFiMode]);

  useEffect(() => {
    if (!active || !ringRef.current || !dotRef.current) return;

    const ring = ringRef.current;
    const dot = dotRef.current;

    const moveRingX = gsap.quickTo(ring, 'x', { duration: 0.22, ease: 'power3.out' });
    const moveRingY = gsap.quickTo(ring, 'y', { duration: 0.22, ease: 'power3.out' });
    const moveDotX = gsap.quickTo(dot, 'x', { duration: 0.06, ease: 'power2.out' });
    const moveDotY = gsap.quickTo(dot, 'y', { duration: 0.06, ease: 'power2.out' });

    const onMove = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') {
        setVisible(false);
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'IFRAME') {
        setVisible(false);
        return;
      }

      setVisible(true);
      moveRingX(e.clientX);
      moveRingY(e.clientY);
      moveDotX(e.clientX);
      moveDotY(e.clientY);

      const interactive = Boolean(
        target?.closest('button, a, [role="tab"], [role="button"], select, [data-tilt-card="true"]'),
      );
      setHoverInteractive(interactive);
    };

    const onDown = () => {
      gsap.to(ring, { scale: 0.78, duration: 0.12, ease: 'power2.out' });
    };
    const onUp = () => {
      gsap.to(ring, { scale: hoverInteractive ? 1.45 : 1, duration: 0.2, ease: 'power2.out' });
    };
    const onLeaveWindow = () => setVisible(false);

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    document.addEventListener('mouseleave', onLeaveWindow);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      document.removeEventListener('mouseleave', onLeaveWindow);
    };
  }, [active, hoverInteractive]);

  useEffect(() => {
    if (!active || !ringRef.current) return;
    gsap.to(ringRef.current, {
      scale: hoverInteractive ? 1.45 : 1,
      duration: 0.2,
      ease: 'power2.out',
    });
  }, [active, hoverInteractive]);

  if (!active) return null;

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 z-[9999] transition-opacity duration-150 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* Outer Neon Cyan -> Metallic Gold Reticle */}
      <div
        ref={ringRef}
        className={`fixed top-0 left-0 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full border-2 transition-colors duration-150 ${
          hoverInteractive
            ? 'border-amber-400 shadow-[0_0_16px_rgba(251,191,36,0.65)] bg-amber-400/10'
            : 'border-cyan-400/85 shadow-[0_0_12px_rgba(34,211,238,0.55)]'
        }`}
      />
      {/* Inner Metallic Gold Precision Diamond */}
      <div
        ref={dotRef}
        className="fixed top-0 left-0 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rotate-45 bg-gradient-to-br from-amber-200 via-amber-400 to-yellow-600 shadow-[0_0_8px_rgba(251,191,36,0.9)]"
      />
    </div>
  );
}
