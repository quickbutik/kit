"use client";

import { useEffect, useRef } from "react";

const vertexSource = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

// A warped light field gives the background its slowly moving metallic folds.
// One draw call, no textures, and a deliberately small backing buffer.
const fragmentSource = `
  precision mediump float;
  uniform vec2 u_resolution;
  uniform vec2 u_pointer;
  uniform float u_time;

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 s = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), s.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), s.x), s.y);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
    float t = u_time * 0.055;
    p += (u_pointer - 0.5) * 0.16;
    p.x += 0.15;

    vec2 q = p * 1.8;
    q.x += 0.48 * sin(q.y * 1.7 + t);
    q.y += 0.34 * sin(q.x * 1.5 - t * 0.7);
    float field = q.x * 0.8 + q.y * 0.38;
    field += noise(q * 1.25 + vec2(t, -t * 0.4)) * 0.72;

    float fold = 0.5 + 0.5 * sin(field * 7.0 + t);
    float silver = pow(fold, 12.0);
    float broadLight = pow(0.5 + 0.5 * sin(field * 3.3 - 1.2), 4.0);
    float gold = pow(0.5 + 0.5 * sin(field * 7.0 + t + 0.65), 22.0);
    float contour = pow(0.5 + 0.5 * sin(field * 115.0), 30.0);
    vec3 color = vec3(0.025, 0.042, 0.047);
    color += vec3(0.14, 0.23, 0.27) * broadLight * 0.6;
    color += vec3(0.42, 0.56, 0.61) * silver * 0.62;
    color += vec3(0.54, 0.44, 0.28) * gold * 0.38;
    color += vec3(0.28, 0.35, 0.36) * contour * broadLight * 0.18;
    float vignette = 1.0 - smoothstep(0.25, 1.05, length(uv - 0.55));
    color *= 0.55 + vignette * 0.65;
    color += (hash(gl_FragCoord.xy) - 0.5) * 0.018;
    gl_FragColor = vec4(color, 1.0);
  }
`;

export default function ClubAtmosphere({ paused }: { paused: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playback = useRef<(paused: boolean) => void>(() => {});
  const pauseState = useRef(paused);

  useEffect(() => {
    pauseState.current = paused;
    playback.current(paused);
  }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const hero = canvas?.closest<HTMLElement>(".club-page-hero");
    if (!canvas || !hero) return;
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!gl || gl.isContextLost()) return; // Keep the CSS light field as fallback.

    const vertex = gl.createShader(gl.VERTEX_SHADER);
    const fragment = gl.createShader(gl.FRAGMENT_SHADER);
    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    if (!vertex || !fragment || !program || !buffer) {
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
      return;
    }

    gl.shaderSource(vertex, vertexSource);
    gl.shaderSource(fragment, fragmentSource);
    gl.compileShader(vertex);
    gl.compileShader(fragment);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, "a_position");
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
      return;
    }

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const resolution = gl.getUniformLocation(program, "u_resolution");
    const pointer = gl.getUniformLocation(program, "u_pointer");
    const time = gl.getUniformLocation(program, "u_time");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    let frame = 0;
    let previousTime = 0;
    let elapsed = 0;
    let visible = true;
    let stopped = pauseState.current;
    let lost = false;
    const target = { x: 0.5, y: 0.5 };
    const current = { ...target };

    function draw() {
      if (lost) return;
      gl!.uniform2f(resolution, canvas!.width, canvas!.height);
      gl!.uniform2f(pointer, current.x, current.y);
      gl!.uniform1f(time, elapsed);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      canvas!.dataset.ready = "true";
    }

    function tick(now: number) {
      frame = requestAnimationFrame(tick);
      if (now - previousTime < 1000 / 30) return;
      elapsed += Math.min((now - previousTime) / 1000, 0.07);
      previousTime = now;
      current.x += (target.x - current.x) * 0.065;
      current.y += (target.y - current.y) * 0.065;
      draw();
    }

    function syncPlayback() {
      cancelAnimationFrame(frame);
      const animate =
        !stopped &&
        !reducedMotion.matches &&
        visible &&
        !document.hidden &&
        !lost;
      canvas!.dataset.motion = animate ? "playing" : "paused";
      if (animate) {
        previousTime = performance.now();
        frame = requestAnimationFrame(tick);
      } else {
        draw();
      }
    }

    function resize() {
      const bounds = hero!.getBoundingClientRect();
      const scale = Math.min(
        Math.min(window.devicePixelRatio || 1, 1.25) *
          (bounds.width < 768 ? 0.65 : 0.8),
        1600 / bounds.width,
        1200 / bounds.height,
      );
      canvas!.width = Math.max(1, Math.round(bounds.width * scale));
      canvas!.height = Math.max(1, Math.round(bounds.height * scale));
      gl!.viewport(0, 0, canvas!.width, canvas!.height);
      draw();
    }

    function move(event: PointerEvent) {
      if (!finePointer.matches || reducedMotion.matches || stopped) return;
      const bounds = hero!.getBoundingClientRect();
      target.x = (event.clientX - bounds.left) / bounds.width;
      target.y = 1 - (event.clientY - bounds.top) / bounds.height;
    }

    function resetPointer() {
      target.x = 0.5;
      target.y = 0.5;
    }

    function contextLost(event: Event) {
      event.preventDefault();
      lost = true;
      cancelAnimationFrame(frame);
      delete canvas!.dataset.ready;
      canvas!.dataset.motion = "paused";
    }

    playback.current = (next) => {
      stopped = next;
      syncPlayback();
    };
    const resizeObserver = new ResizeObserver(resize);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      syncPlayback();
    });
    resizeObserver.observe(hero);
    intersectionObserver.observe(hero);
    hero.addEventListener("pointermove", move, { passive: true });
    hero.addEventListener("pointerleave", resetPointer);
    canvas.addEventListener("webglcontextlost", contextLost);
    document.addEventListener("visibilitychange", syncPlayback);
    reducedMotion.addEventListener("change", syncPlayback);
    resize();
    syncPlayback();

    return () => {
      playback.current = () => {};
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      hero.removeEventListener("pointermove", move);
      hero.removeEventListener("pointerleave", resetPointer);
      canvas.removeEventListener("webglcontextlost", contextLost);
      document.removeEventListener("visibilitychange", syncPlayback);
      reducedMotion.removeEventListener("change", syncPlayback);
      delete canvas.dataset.ready;
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, []);

  return (
    <div className="club-atmosphere" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
