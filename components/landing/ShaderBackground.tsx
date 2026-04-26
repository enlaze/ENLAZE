"use client";

import { useEffect, useRef } from "react";

/* ─────────────────────────────────────────────────────────────────────
 *  ShaderBackground — Fondo animado tipo "gradient mesh" con WebGL.
 *
 *  · Domain-warped fbm (movimiento orgánico, lento, no agresivo)
 *  · Paleta brand: blanco base + brand-green / teal / navy en acentos
 *  · El cursor introduce una distorsión MUY sutil (sin halo agresivo)
 *  · 60fps con requestAnimationFrame, DPR limitado a 1.5 para perf
 *  · Pausa cuando está fuera de viewport (IntersectionObserver)
 *  · Honra prefers-reduced-motion (congela el tiempo)
 *  · SSR-safe (todo dentro de useEffect, comprueba window/canvas)
 *  · Fallback graceful: si WebGL no está disponible, renderiza un
 *    gradiente CSS estático con la misma paleta — sin reventar.
 * ───────────────────────────────────────────────────────────────────── */

const VERT_SRC = /* glsl */ `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

/*
 * Fragment shader.
 *  - simplex-style hash + value noise (barato y estable en todas las GPUs)
 *  - fbm con 4 octavas
 *  - domain warping para que el movimiento se sienta "vivo"
 *  - mezcla 3 colores brand sobre fondo blanco con baja saturación
 */
/*
 * Fragment shader inspirado en el wallpaper "Mesh" de Claude Design,
 * adaptado a la paleta brand de Enlaze.
 *
 * Soporta dos variants vía uniform `u_dark`:
 *  · default (0.0): pastel claro, base blanco, ideal sobre hero white
 *  · dark    (1.0): superficie oscura tipo navy profundo + glow brand
 *
 * Técnicas clave:
 *  - uv 0..1 con aspect correction (`p.x *= ratio`)
 *  - 2 pasadas de domain warping (q → r) con time-offsets asimétricos
 *  - Swirl perpendicular del cursor — revuelve el campo en vez de tirar
 *  - Ridged noise → filamentos brillantes
 *  - Doble cursor uniform: smoothed para swirl + raw para offset extra
 *  - Tonemap Reinhard suave `col/(1+col*0.15)` — look premium
 *  - En modo dark: +30% flow, speed +40%, contraste extra, bloom 1.7×
 */
const FRAG_SRC = /* glsl */ `
  precision highp float;
  varying vec2 v_uv;

  uniform vec2  u_resolution;
  uniform float u_time;
  uniform vec2  u_mouse;       // 0..1, smoothed (~4.5% per frame)
  uniform vec2  u_mouse_raw;   // 0..1, sin suavizar
  uniform float u_pointer;     // 0..1, intensidad cursor
  uniform float u_dark;        // 0.0 = light, 1.0 = dark

  // Acento marca (#00c896) — se mantiene en ambos modos
  const vec3 C_BRAND_LIGHT = vec3(0.000, 0.784, 0.588);
  const vec3 C_BRAND_DARK  = vec3(0.100, 0.950, 0.720); // más brillante para pop sobre navy

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.02;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = v_uv;
    vec2 p = uv;
    p.x *= u_resolution.x / u_resolution.y;

    // Speed/flow boosts en modo dark (+40 % speed, +30 % warp scale)
    float speedMul = 1.0 + 0.40 * u_dark;
    float flowMul  = 1.0 + 0.30 * u_dark;
    float t = u_time * 0.10 * speedMul;

    // Cursor centrado en -0.5..0.5
    vec2 mRaw = u_mouse_raw - 0.5;

    // Domain warping (2 pasadas, time offsets asimétricos)
    vec2 q = vec2(
      fbm(p + vec2(0.0,  t)),
      fbm(p + vec2(5.2, -t * 0.8))
    );
    vec2 r = vec2(
      fbm(p + 2.0 * flowMul * q + vec2(1.7 + t * 0.3, 9.2)),
      fbm(p + 2.0 * flowMul * q + vec2(8.3, 2.8 - t * 0.4))
    );

    // Cursor swirl — vector perpendicular, cae con la distancia.
    vec2 toMouse = (uv - u_mouse) * vec2(u_resolution.x / u_resolution.y, 1.0);
    float md = length(toMouse);
    float infl = exp(-md * 2.4) * u_pointer;
    vec2 swirl = vec2(-toMouse.y, toMouse.x) * infl * (0.85 + 0.30 * u_dark);

    // Campo base — swirl + offset raw del cursor
    float n = fbm(p * 1.4 + 1.6 * flowMul * r + swirl + mRaw * 0.30);

    // Ridged noise — filamentos brillantes (look líquido)
    float ridge = 1.0 - abs(fbm(p * 2.2 + r * 1.4 + t * 0.5) - 0.5) * 2.0;
    ridge = pow(ridge, 2.5);

    // ── Paletas ─────────────────────────────────────────────────
    // LIGHT: mint → teal → sky → off-white
    vec3 lA = vec3(0.72, 0.94, 0.85);
    vec3 lB = vec3(0.40, 0.84, 0.74);
    vec3 lC = vec3(0.55, 0.78, 0.92);
    vec3 lD = vec3(0.97, 0.99, 0.98);

    // DARK: navy base #0B1F2A → teal profundo → azul profundo → glow cyan
    vec3 dA = vec3(0.043, 0.122, 0.165); // #0B1F2A
    vec3 dB = vec3(0.060, 0.420, 0.450); // teal medio
    vec3 dC = vec3(0.080, 0.220, 0.450); // azul profundo
    vec3 dD = vec3(0.300, 0.780, 0.650); // highlight cyan-verde

    vec3 cA = mix(lA, dA, u_dark);
    vec3 cB = mix(lB, dB, u_dark);
    vec3 cC = mix(lC, dC, u_dark);
    vec3 cD = mix(lD, dD, u_dark);
    vec3 cAccent = mix(C_BRAND_LIGHT, C_BRAND_DARK, u_dark);

    // Mezcla: dark mode usa rangos de smoothstep ligeramente más
    // estrechos para que el contraste se note más sin saturar.
    float sLo = mix(0.25, 0.20, u_dark);
    float sHi = mix(0.65, 0.60, u_dark);
    vec3 col = mix(cA, cB, smoothstep(sLo, sHi, n));
    col = mix(col, cC, smoothstep(0.50, 0.90, fbm(p * 0.9 + r + t * 0.3)));

    // En light, el highlight blanco va al 0.5 de mezcla. En dark, sube
    // al 0.7 para que el cyan glow se perciba más en los picos.
    float hiMix = mix(0.50, 0.70, u_dark);
    col = mix(col, cD, smoothstep(0.60, 1.00, n) * hiMix);

    // Filamentos brand: en dark, más cuerpo (0.14 → 0.22)
    col += cAccent * ridge * mix(0.14, 0.22, u_dark);

    // Cursor bloom — más intenso y de mayor radio en dark
    float ptr = exp(-md * mix(3.0, 2.2, u_dark)) * u_pointer * mix(0.28, 0.55, u_dark);
    col += cAccent * ptr;

    // Halo cálido extra solo en dark (refuerza la "interacción")
    float halo = exp(-md * 0.9) * u_pointer * 0.18 * u_dark;
    col += vec3(0.55, 1.00, 0.85) * halo;

    // Vignette: en dark más marcada para enfocar el centro
    float vig = smoothstep(1.20, 0.40, length(uv - 0.5));
    col *= mix(mix(0.94, 1.00, vig), mix(0.78, 1.00, vig), u_dark);

    // Boost de contraste final (sólo dark) — eleva nitidez del flujo
    vec3 colC = (col - 0.5) * 1.18 + 0.5;
    col = mix(col, colC, u_dark);

    // Tonemap Reinhard suave — fuerza ligeramente menor en dark para
    // no aplastar los azules profundos.
    float tm = mix(0.15, 0.10, u_dark);
    col = col / (1.0 + col * tm);

    gl_FragColor = vec4(col, 1.0);
  }
`;

function compileShader(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export type ShaderVariant = "default" | "dark";

interface ShaderBackgroundProps {
  /** "default" = paleta clara (actual). "dark" = navy profundo + glow brand. */
  variant?: ShaderVariant;
}

// Fallback CSS — visible inmediatamente (sin esperar a que WebGL pinte el
// primer frame). En producción casi no se nota; en dev es lo que evita el
// "flash negro" durante la doble-init de React Strict Mode.
const FALLBACK_BG_DARK =
  "radial-gradient(ellipse at 30% 20%, rgba(0,200,150,0.18), transparent 55%), radial-gradient(ellipse at 70% 80%, rgba(8,34,69,0.50), transparent 60%), #0B1F2A";
const FALLBACK_BG_LIGHT =
  "radial-gradient(ellipse at 30% 20%, rgba(0,200,150,0.12), transparent 55%), radial-gradient(ellipse at 70% 80%, rgba(46,176,176,0.10), transparent 60%), #ffffff";

export default function ShaderBackground({ variant = "default" }: ShaderBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const darkRef = useRef(variant === "dark");
  // Guard contra doble-init en React Strict Mode (dev). Si el primer mount
  // sigue activo, el segundo skipea la creación de un nuevo contexto WebGL.
  const initializedRef = useRef(false);

  // Mantener `darkRef` sincronizado si el padre cambia la variant en runtime,
  // sin reiniciar el ciclo WebGL.
  useEffect(() => {
    darkRef.current = variant === "dark";
  }, [variant]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Pinta SIEMPRE el fallback CSS antes de tocar WebGL — así, aunque el
    // primer frame del shader tarde, el canvas nunca se ve negro.
    canvas.style.background = darkRef.current ? FALLBACK_BG_DARK : FALLBACK_BG_LIGHT;

    // Strict Mode dev: skipea si ya hay un contexto activo de un mount anterior.
    if (initializedRef.current) return;
    initializedRef.current = true;

    // alpha:true → canvas no opaco; antes del primer drawArrays se ve el
    // background CSS. premultipliedAlpha:false porque dibujamos opaco igual.
    const gl =
      (canvas.getContext("webgl", { antialias: false, alpha: true, premultipliedAlpha: false }) as
        | WebGLRenderingContext
        | null) ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);

    if (!gl) {
      // Sin WebGL → el fallback CSS ya está aplicado, no hace falta nada más.
      return;
    }

    // Clear color = navy oscuro: si por alguna razón el frame 1 tarda,
    // el clear inicial pinta navy en vez de negro.
    if (darkRef.current) {
      gl.clearColor(0.043, 0.075, 0.122, 1.0); // ~ #0B1320
    } else {
      gl.clearColor(1.0, 1.0, 1.0, 1.0);
    }
    gl.clear(gl.COLOR_BUFFER_BIT);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ── Compile + link ───────────────────────────────────────────── */
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    /* ── Full-screen quad ─────────────────────────────────────────── */
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    const aPos = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "u_resolution");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uMouse = gl.getUniformLocation(program, "u_mouse");
    const uMouseRaw = gl.getUniformLocation(program, "u_mouse_raw");
    const uPointer = gl.getUniformLocation(program, "u_pointer");
    const uDark = gl.getUniformLocation(program, "u_dark");

    /* ── Resize (DPR cap a 1.5) ───────────────────────────────────── */
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    function resize() {
      if (!canvas || !gl) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const W = Math.max(1, Math.floor(w * dpr));
      const H = Math.max(1, Math.floor(h * dpr));
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
        gl.viewport(0, 0, W, H);
      }
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    /* ── Mouse smoothing ──────────────────────────────────────────── */
    // raw: posición exacta del cursor (uv 0..1, y invertida estilo GL)
    // smoothed: low-pass del raw para que el swirl se sienta fluido
    const mouseRaw = { x: 0.5, y: 0.5 };
    const mouse = { x: 0.5, y: 0.5 };
    let pointerTarget = 0;
    let pointer = 0;

    function onMove(e: PointerEvent) {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / Math.max(1, rect.width);
      // GL y crece hacia arriba, page y hacia abajo → invertir.
      const y = 1 - (e.clientY - rect.top) / Math.max(1, rect.height);
      mouseRaw.x = Math.min(1, Math.max(0, x));
      mouseRaw.y = Math.min(1, Math.max(0, y));
      pointerTarget = 1;
    }
    function onLeave() {
      pointerTarget = 0;
    }

    // Listener a window para que funcione aunque el cursor pase
    // por encima del contenido (z-index 10) sin perder el rastro.
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave, { passive: true });

    /* ── Pausa cuando está fuera de viewport ──────────────────────── */
    let visible = true;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible = e.isIntersecting;
      },
      { threshold: 0 }
    );
    io.observe(canvas);

    /* ── Render loop ──────────────────────────────────────────────── */
    const start = performance.now();
    let raf = 0;
    const frozenT = 0;

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      if (!visible) return;
      if (!canvas || !gl) return;

      // Smoothing exponencial (~ 4.5 % por frame a 60fps → fluid feel)
      mouse.x += (mouseRaw.x - mouse.x) * 0.045;
      mouse.y += (mouseRaw.y - mouse.y) * 0.045;
      pointer += (pointerTarget - pointer) * 0.05;

      const t = reduced ? frozenT : (now - start) / 1000;

      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, t);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.uniform2f(uMouseRaw, mouseRaw.x, mouseRaw.y);
      gl.uniform1f(uPointer, pointer);
      gl.uniform1f(uDark, darkRef.current ? 1.0 : 0.0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    raf = requestAnimationFrame(frame);

    /* ── Cleanup ──────────────────────────────────────────────────── */
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      ro.disconnect();
      io.disconnect();
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      // NOTA: NO llamamos WEBGL_lose_context.loseContext() aquí —
      // el browser libera el contexto cuando el canvas es GC'd. Llamarlo
      // explícitamente rompía la doble-init de React Strict Mode (dev) y
      // dejaba el segundo mount con un contexto perdido → flash negro.
      // Permitir el reset del guard en caso de unmount real del componente.
      initializedRef.current = false;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
    />
  );
}
