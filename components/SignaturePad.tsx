"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";

interface SignaturePadProps {
  onSave: (dataUrl: string) => void;
  onClear?: () => void;
  width?: number;
  height?: number;
  label?: string;
  initialImage?: string;
  disabled?: boolean;
}

export default function SignaturePad({
  onSave,
  onClear,
  width = 500,
  height = 200,
  label = "Firme aquí",
  initialImage,
  disabled = false,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set actual size for retina
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    // Line style
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Load initial image if provided
    if (initialImage) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height);
        setIsEmpty(false);
        setHasDrawn(true);
      };
      img.src = initialImage;
    }
  }, [width, height, initialImage]);

  const getPos = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();

      if ("touches" in e) {
        const touch = e.touches[0];
        return {
          x: touch.clientX - rect.left,
          y: touch.clientY - rect.top,
        };
      }
      return {
        x: (e as React.MouseEvent).clientX - rect.left,
        y: (e as React.MouseEvent).clientY - rect.top,
      };
    },
    []
  );

  const startDraw = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (disabled) return;
      e.preventDefault();
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      const pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      setIsDrawing(true);
    },
    [disabled, getPos]
  );

  const draw = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDrawing || disabled) return;
      e.preventDefault();
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      const pos = getPos(e);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      setHasDrawn(true);
      setIsEmpty(false);
    },
    [isDrawing, disabled, getPos]
  );

  const endDraw = useCallback(() => {
    setIsDrawing(false);
  }, []);

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    setHasDrawn(false);
    setIsEmpty(true);
    onClear?.();
  }

  function saveSignature() {
    const canvas = canvasRef.current;
    if (!canvas || isEmpty) return;
    const dataUrl = canvas.toDataURL("image/png");
    onSave(dataUrl);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-navy-600 dark:text-zinc-300 uppercase tracking-wider">
        {label}
      </p>

      <div
        className={`relative rounded-xl border-2 overflow-hidden ${
          disabled
            ? "border-navy-100 dark:border-zinc-800 opacity-60"
            : "border-dashed border-navy-200 dark:border-zinc-700 hover:border-brand-green dark:hover:border-brand-green"
        } transition-colors`}
      >
        <canvas
          ref={canvasRef}
          style={{ width, height, touchAction: "none" }}
          className="cursor-crosshair bg-white"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />

        {/* Placeholder line */}
        {isEmpty && (
          <div className="absolute bottom-8 left-8 right-8 border-b border-navy-200 dark:border-zinc-600 pointer-events-none">
            <span className="absolute -bottom-5 left-0 text-[10px] text-navy-400 dark:text-zinc-500">
              Firma
            </span>
            <span className="absolute -bottom-5 right-0 text-[10px] text-navy-400 dark:text-zinc-500">
              Fecha: {new Date().toLocaleDateString("es-ES")}
            </span>
          </div>
        )}
      </div>

      {!disabled && (
        <div className="flex gap-3">
          <Button size="sm" onClick={saveSignature} disabled={isEmpty}>
            Confirmar firma
          </Button>
          <Button size="sm" variant="secondary" onClick={clearCanvas} disabled={isEmpty}>
            Borrar
          </Button>
        </div>
      )}
    </div>
  );
}
