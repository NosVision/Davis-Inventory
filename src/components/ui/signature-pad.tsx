'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { cn } from '@/lib/utils/cn';

// Imperative handle exposed to parents via ref.
export interface SignaturePadHandle {
  clear(): void;
  isEmpty(): boolean;
  toDataURL(): string | null;
}

interface SignaturePadProps {
  height?: number;
  className?: string;
  onChange?: (empty: boolean) => void;
}

const STROKE_COLOR = '#1f2937'; // gray-800 ink — visible on the white signing surface
const STROKE_WIDTH = 2;

// A reusable, touch-friendly signature canvas. Draw with pointer events, export
// as a PNG data URL. The signing surface is intentionally white ("paper") so ink
// stays visible in both light and dark themes; the exported PNG keeps a
// transparent background with dark strokes.
export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(
  function SignaturePad({ height = 180, className, onChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const drawingRef = useRef(false);
    const emptyRef = useRef(true);
    const lastRef = useRef<{ x: number; y: number } | null>(null);

    // Keep the latest onChange without re-running the setup effect (which would
    // wipe the canvas whenever the parent re-renders with a new inline handler).
    const onChangeRef = useRef(onChange);
    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    // Size the backing store for the device pixel ratio so strokes stay crisp.
    const setupCanvas = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const cssWidth = rect.width || canvas.clientWidth || 300;
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.lineWidth = STROKE_WIDTH;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = STROKE_COLOR;
    }, [height]);

    useEffect(() => {
      setupCanvas();
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Re-fit the backing store when the width changes (e.g. modal/orientation).
      // Any in-progress drawing is cleared by the resize, so reset empty state.
      let lastWidth = canvas.getBoundingClientRect().width;
      const observer = new ResizeObserver(() => {
        const w = canvas.getBoundingClientRect().width;
        if (Math.abs(w - lastWidth) < 1) return;
        lastWidth = w;
        setupCanvas();
        emptyRef.current = true;
        lastRef.current = null;
        onChangeRef.current?.(true);
      });
      observer.observe(canvas);
      return () => observer.disconnect();
    }, [setupCanvas]);

    const pointFromEvent = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
      },
      []
    );

    const handlePointerDown = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        canvas.setPointerCapture(e.pointerId);
        drawingRef.current = true;
        const p = pointFromEvent(e);
        lastRef.current = p;
        // Draw an initial dot so a tap registers a mark.
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + 0.1, p.y + 0.1);
        ctx.stroke();
        if (emptyRef.current) {
          emptyRef.current = false;
          onChangeRef.current?.(false);
        }
      },
      [pointFromEvent]
    );

    const handlePointerMove = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!drawingRef.current) return;
        e.preventDefault();
        const ctx = canvasRef.current?.getContext('2d');
        const last = lastRef.current;
        if (!ctx || !last) return;
        const p = pointFromEvent(e);
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        lastRef.current = p;
      },
      [pointFromEvent]
    );

    const stopDrawing = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      lastRef.current = null;
      const canvas = canvasRef.current;
      if (canvas && canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        clear() {
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d');
          if (canvas && ctx) {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
          }
          drawingRef.current = false;
          lastRef.current = null;
          emptyRef.current = true;
          onChangeRef.current?.(true);
        },
        isEmpty() {
          return emptyRef.current;
        },
        toDataURL() {
          const canvas = canvasRef.current;
          if (!canvas || emptyRef.current) return null;
          return canvas.toDataURL('image/png');
        },
      }),
      []
    );

    return (
      <div
        className={cn(
          'overflow-hidden rounded-xl border border-gray-300 bg-white dark:border-gray-600',
          className
        )}
      >
        <canvas
          ref={canvasRef}
          style={{ height, touchAction: 'none' }}
          className="block w-full cursor-crosshair touch-none bg-white"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDrawing}
          onPointerCancel={stopDrawing}
        />
      </div>
    );
  }
);
