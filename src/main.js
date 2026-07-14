import Lenis from "lenis";
import * as THREE from "three";
import "./styles.css";

const canvas = document.querySelector("#particle-canvas");
const hero = document.querySelector(".hero");
const heroCopy = document.querySelector(".hero-copy");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const INTERACTION_FLOW_SPEED = 0.5;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 1, 3000);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setClearColor(0x000000, 0);

const particleGroup = new THREE.Group();
scene.add(particleGroup);

const vertexShader = `
  uniform float uPointSize;
  attribute float aAlpha;
  varying float vAlpha;

  void main() {
    vAlpha = aAlpha;
    gl_PointSize = uPointSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;

  void main() {
    vec2 point = gl_PointCoord - 0.5;
    float edge = 1.0 - smoothstep(0.34, 0.5, length(point));
    gl_FragColor = vec4(uColor, edge * vAlpha * uOpacity);
  }
`;

const state = {
  count: 0,
  geometry: null,
  points: null,
  positions: null,
  homes: null,
  starts: null,
  velocity: null,
  alpha: null,
  targetAlpha: null,
  introDelay: null,
  grid: null,
  width: 0,
  height: 0,
  pointer: new THREE.Vector2(-10000, -10000),
  lastPointer: new THREE.Vector2(-10000, -10000),
  screenPointer: new THREE.Vector2(-10000, -10000),
  pointerVelocity: new THREE.Vector2(),
  pointerActive: false,
  pointerMovedAt: 0,
  returnStartAt: null,
  lastFrameSeconds: performance.now() / 1000,
  enteredAt: performance.now(),
  introDone: false,
  scrollProgress: 0,
};

function createTextTargets(width, height) {
  const mobile = width < 800;
  const work = document.createElement("canvas");
  const targetWidth = mobile ? Math.min(700, width * 1.7) : Math.min(1100, width * 0.82);
  const targetHeight = mobile ? 620 : 600;
  work.width = Math.round(targetWidth);
  work.height = targetHeight;

  const context = work.getContext("2d", { willReadFrequently: true });
  const lines = ["talk", "with", "edison."];
  let fontSize = mobile ? 158 : 250;

  context.clearRect(0, 0, work.width, work.height);
  context.fillStyle = "#fff";
  context.font = `900 ${fontSize}px Arial, Helvetica, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";

  const measuredWidth = Math.max(...lines.map((line) => context.measureText(line).width));
  const availableWidth = work.width * 0.78;
  if (measuredWidth > availableWidth) {
    fontSize *= availableWidth / measuredWidth;
    context.font = `900 ${fontSize}px Arial, Helvetica, sans-serif`;
  }

  const lineHeight = fontSize * 0.72;
  const top = work.height / 2 - lineHeight;

  lines.forEach((line, index) => {
    context.fillText(line, work.width / 2, top + index * lineHeight);
  });

  const pixels = context.getImageData(0, 0, work.width, work.height).data;
  const stride = mobile ? 2 : 1;
  const candidates = [];

  for (let y = 0; y < work.height; y += stride) {
    for (let x = 0; x < work.width; x += stride) {
      const alpha = pixels[(y * work.width + x) * 4 + 3];
      if (alpha > 90) candidates.push([x, y, alpha / 255]);
    }
  }

  const maxParticles = mobile ? 48000 : 112000;
  const sampleRandom = mulberry32(7817 + Math.round(width * 3 + height));
  const selected = candidates.slice(0, maxParticles);

  for (let index = maxParticles; index < candidates.length; index += 1) {
    const replacement = Math.floor(sampleRandom() * (index + 1));
    if (replacement < maxParticles) selected[replacement] = candidates[index];
  }
  const scale = mobile ? Math.min(0.62, width / work.width * 0.94) : 0.9;
  const jitterRandom = mulberry32(19031 + Math.round(width + height * 2));

  return selected.map(([x, y, alpha]) => ({
    x: (x - work.width / 2 + (jitterRandom() - 0.5) * 1.8) * scale,
    y: -(y - work.height / 2 + (jitterRandom() - 0.5) * 1.8) * scale,
    alpha,
  }));
}

function makeGrid(width, height) {
  const cellSize = 10;
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const length = cols * rows;

  return {
    cellSize,
    cols,
    rows,
    vx: new Float32Array(length),
    vy: new Float32Array(length),
    pressure: new Float32Array(length),
  };
}

function rebuildParticles() {
  const targets = createTextTargets(state.width, state.height);
  const count = targets.length;
  const positions = new Float32Array(count * 3);
  const homes = new Float32Array(count * 3);
  const starts = new Float32Array(count * 3);
  const velocity = new Float32Array(count * 2);
  const alpha = new Float32Array(count);
  const targetAlpha = new Float32Array(count);
  const introDelay = new Float32Array(count);
  const returnStartAt = new Float64Array(count);
  returnStartAt.fill(-1);
  const random = mulberry32(14527 + Math.round(state.width));

  targets.forEach((target, index) => {
    const i3 = index * 3;
    const depth = (random() - 0.5) * 24;
    const streamWidth = state.width < 800 ? state.height * 0.2 : state.height * 0.24;

    homes[i3] = target.x;
    homes[i3 + 1] = target.y;
    homes[i3 + 2] = 0;
    starts[i3] = state.width / 2 + 70 + random() * state.width * 0.72;
    starts[i3 + 1] = target.y * 0.38 + (random() - 0.5) * streamWidth;
    starts[i3 + 2] = depth;
    positions[i3] = starts[i3];
    positions[i3 + 1] = starts[i3 + 1];
    positions[i3 + 2] = depth;
    alpha[index] = reducedMotion ? Math.max(0.4, target.alpha) : 0;
    targetAlpha[index] = Math.max(0.4, target.alpha);
    introDelay[index] = random() * 0.78 + Math.max(0, -target.x / state.width) * 0.12;
  });

  state.geometry?.dispose();
  state.points?.material.dispose();
  if (state.points) particleGroup.remove(state.points);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uPointSize: { value: (state.width < 800 ? 0.5 : 0.8) * Math.min(devicePixelRatio, 2) },
      uColor: { value: new THREE.Color(0xf6f6f2) },
      uOpacity: { value: 1 },
    },
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  particleGroup.add(points);

  Object.assign(state, {
    count,
    geometry,
    points,
    positions,
    homes,
    starts,
    velocity,
    alpha,
    targetAlpha,
    introDelay,
    returnStartAt,
    grid: makeGrid(state.width, state.height),
    lastFrameSeconds: performance.now() / 1000,
    enteredAt: performance.now(),
    introDone: reducedMotion,
  });
  state.pointer.set(-10000, -10000);
  state.screenPointer.set(-10000, -10000);

  if (reducedMotion) {
    positions.set(homes);
    alpha.set(targetAlpha);
  }
}

function resize() {
  state.width = window.innerWidth;
  state.height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(state.width, state.height, false);

  const cameraZ = 1000;
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(state.height / 2 / cameraZ));
  camera.aspect = state.width / state.height;
  camera.position.set(0, 0, cameraZ);
  camera.updateProjectionMatrix();
  rebuildParticles();
}

function mulberry32(seed) {
  return function random() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function easeOutExpo(value) {
  if (value >= 1) return 1;
  return 1 - 2 ** (-10 * value);
}

function smoothstep(min, max, value) {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
}

function worldFromEvent(event) {
  return {
    x: event.clientX - state.width / 2,
    y: -(event.clientY - state.height / 2),
  };
}

function injectGrid(x, y, vx, vy) {
  const grid = state.grid;
  if (!grid) return;
  const radius = 48;
  const minCol = Math.max(0, Math.floor((x - radius) / grid.cellSize));
  const maxCol = Math.min(grid.cols - 1, Math.floor((x + radius) / grid.cellSize));
  const minRow = Math.max(0, Math.floor((y - radius) / grid.cellSize));
  const maxRow = Math.min(grid.rows - 1, Math.floor((y + radius) / grid.cellSize));

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const cx = col * grid.cellSize;
      const cy = row * grid.cellSize;
      const dx = cx - x;
      const dy = cy - y;
      let distance = Math.hypot(dx, dy);
      if (distance >= radius) continue;
      if (distance < 4) distance = radius;
      const force = radius / distance;
      const index = row * grid.cols + col;
      grid.vx[index] += vx * force * INTERACTION_FLOW_SPEED;
      grid.vy[index] += vy * force * INTERACTION_FLOW_SPEED;
    }
  }
}

function onPointerMove(event) {
  const point = worldFromEvent(event);
  const previousX = state.screenPointer.x;
  const previousY = state.screenPointer.y;
  state.pointer.set(point.x, point.y);
  state.screenPointer.set(event.clientX, event.clientY);
  state.pointerMovedAt = performance.now();
  state.pointerActive = true;

  if (previousX > -9000 && state.introDone) {
    const dx = event.clientX - previousX;
    const dy = event.clientY - previousY;
    state.pointerVelocity.set(dx, dy);
    const distance = Math.hypot(dx, dy);
    const samples = Math.max(1, Math.ceil(distance / 6));
    for (let step = 0; step <= samples; step += 1) {
      const t = step / samples;
      injectGrid(previousX + dx * t, previousY + dy * t, dx, dy);
    }
  }

}

function onPointerLeave() {
  state.pointerActive = false;
  state.pointer.set(-10000, -10000);
  state.screenPointer.set(-10000, -10000);
}

function updateGrid(time) {
  const grid = state.grid;
  if (!grid) return;
  const { cols, rows, vx, vy, pressure, cellSize } = grid;
  const phase = time * 0.06;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      vx[index] += 0.005 * Math.sin(0.005 * row * cellSize + phase);
      vy[index] += 0.005 * Math.cos(0.005 * col * cellSize - 1.1 * phase);
    }
  }

  const xVelocity = (col, row) => {
    if (col < 0 || col >= cols || row < 0 || row >= rows) return 0;
    return vx[row * cols + col];
  };
  const yVelocity = (col, row) => {
    if (col < 0 || col >= cols || row < 0 || row >= rows) return 0;
    return vy[row * cols + col];
  };
  const cellPressure = (col, row) => {
    if (col < 0 || col >= cols || row < 0 || row >= rows) return 0;
    return pressure[row * cols + col];
  };

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      const horizontal =
        0.5 * xVelocity(col - 1, row - 1) +
        xVelocity(col - 1, row) +
        0.5 * xVelocity(col - 1, row + 1) -
        0.5 * xVelocity(col + 1, row - 1) -
        xVelocity(col + 1, row) -
        0.5 * xVelocity(col + 1, row + 1);
      const vertical =
        0.5 * yVelocity(col - 1, row - 1) +
        yVelocity(col, row - 1) +
        0.5 * yVelocity(col + 1, row - 1) -
        0.5 * yVelocity(col - 1, row + 1) -
        yVelocity(col, row + 1) -
        0.5 * yVelocity(col + 1, row + 1);
      pressure[index] = (horizontal + vertical) * 0.25;
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      vx[index] +=
        (0.5 * cellPressure(col - 1, row - 1) +
          cellPressure(col - 1, row) +
          0.5 * cellPressure(col - 1, row + 1) -
          0.5 * cellPressure(col + 1, row - 1) -
          cellPressure(col + 1, row) -
          0.5 * cellPressure(col + 1, row + 1)) *
        0.25;
      vy[index] +=
        (0.5 * cellPressure(col - 1, row - 1) +
          cellPressure(col, row - 1) +
          0.5 * cellPressure(col + 1, row - 1) -
          0.5 * cellPressure(col - 1, row + 1) -
          cellPressure(col, row + 1) -
          0.5 * cellPressure(col + 1, row + 1)) *
        0.25;

      const speed = Math.hypot(vx[index], vy[index]);
      if (speed > 100) {
        vx[index] *= 100 / speed;
        vy[index] *= 100 / speed;
      }
      vx[index] *= 0.99;
      vy[index] *= 0.99;
    }
  }
}

function updateParticles(time) {
  if (!state.points) return;
  const elapsed = (time - state.enteredAt) / 1000;
  const positions = state.positions;

  if (!reducedMotion && elapsed < 4.35) {
    for (let index = 0; index < state.count; index += 1) {
      const i3 = index * 3;
      const local = Math.max(0, Math.min(1, (elapsed - 0.18 - state.introDelay[index] * 1.08) / 3.25));
      const flow = 1 - (1 - local) ** 4;
      const envelope = Math.sin(local * Math.PI);
      const wave = Math.sin(index * 0.015 + elapsed * 3.1) * (1 - flow) * 8;
      const lift = Math.sin(index * 0.009) * envelope * 20;
      positions[i3] = state.starts[i3] + (state.homes[i3] - state.starts[i3]) * flow;
      positions[i3 + 1] = state.starts[i3 + 1] + (state.homes[i3 + 1] - state.starts[i3 + 1]) * flow + wave + lift;
      positions[i3 + 2] = state.starts[i3 + 2] * (1 - flow);
      state.alpha[index] = state.targetAlpha[index] * smoothstep(0.02, 0.34, local);
    }
    state.geometry.attributes.aAlpha.needsUpdate = true;
  } else {
    state.introDone = true;
    if (!reducedMotion && state.alpha[0] !== state.targetAlpha[0]) {
      state.alpha.set(state.targetAlpha);
      state.geometry.attributes.aAlpha.needsUpdate = true;
    }
    const seconds = time / 1000;
    const delta = Math.min(0.05, Math.max(0.001, seconds - state.lastFrameSeconds));
    state.lastFrameSeconds = seconds;
    updateGrid(seconds);
    const homes = state.homes;
    const velocity = state.velocity;
    const returnStartAt = state.returnStartAt;
    const grid = state.grid;
    const gridCols = grid.cols;
    const gridRows = grid.rows;
    const cellSize = grid.cellSize;
    const gridVx = grid.vx;
    const gridVy = grid.vy;
    const halfWidth = state.width / 2;
    const halfHeight = state.height / 2;
    const viewWidth = state.width;
    const viewHeight = state.height;

    for (let index = 0; index < state.count; index += 1) {
      const i3 = index * 3;
      const i2 = index * 2;
      const x = positions[i3];
      const y = positions[i3 + 1];
      const homeX = homes[i3];
      const homeY = homes[i3 + 1];
      let velocityX = velocity[i2];
      let velocityY = velocity[i2 + 1];
      const particleSpeed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);

      if (particleSpeed > 0.5) returnStartAt[index] = -1;
      if (particleSpeed <= 0.5 && returnStartAt[index] < 0) {
        returnStartAt[index] = seconds;
      }
      if (returnStartAt[index] >= 0) {
        const returnProgress = Math.min(1, (seconds - returnStartAt[index]) / 0.05);
        const returnEase = returnProgress * returnProgress * (3 - 2 * returnProgress);
        const returnForce = 50 * delta * (0.15 + 0.85 * returnEase);
        velocityX += (homeX - x) * returnForce;
        velocityY += (homeY - y) * returnForce;
      }

      const screenX = Math.min(Math.max(x + halfWidth, 0), viewWidth);
      const screenY = Math.min(Math.max(halfHeight - y, 0), viewHeight);
      const col = Math.min(gridCols - 1, Math.max(0, Math.floor(screenX / cellSize)));
      const row = Math.min(gridRows - 1, Math.max(0, Math.floor(screenY / cellSize)));
      const base = row * gridCols + col;
      const right = col + 1 < gridCols ? base + 1 : base;
      const down = row + 1 < gridRows ? base + gridCols : base;
      const fractionX = (screenX - col * cellSize) / cellSize;
      const fractionY = (screenY - row * cellSize) / cellSize;

      velocityX += ((1 - fractionX) * gridVx[base] + fractionX * gridVx[right] + fractionY * gridVx[down]) * 0.06;
      velocityY -= ((1 - fractionY) * gridVy[base] + fractionX * gridVy[right] + fractionY * gridVy[down]) * 0.06;

      const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
      if (speed > 30) {
        const limit = 30 / speed;
        velocityX *= limit;
        velocityY *= limit;
      }

      positions[i3] += velocityX;
      positions[i3 + 1] += velocityY;
      velocity[i2] = velocityX * 0.4;
      velocity[i2 + 1] = velocityY * 0.4;
    }
  }

  state.geometry.attributes.position.needsUpdate = true;
}

function updateScroll() {
  const maxTravel = Math.max(1, hero.offsetHeight - state.height);
  state.scrollProgress = Math.max(0, Math.min(1, window.scrollY / maxTravel));
  if (state.points) {
    state.points.material.uniforms.uOpacity.value = 1 - smoothstep(0.08, 0.72, state.scrollProgress);
  }
  heroCopy.style.opacity = "0";
}

function render(time) {
  updateParticles(time);
  updateScroll();

  const targetTiltX = state.pointerActive ? (state.pointer.y / state.height) * 0.14 : 0;
  const targetTiltY = state.pointerActive ? (state.pointer.x / state.width) * 0.14 : 0;
  particleGroup.rotation.x += (targetTiltX - particleGroup.rotation.x) * 0.08;
  particleGroup.rotation.y += (targetTiltY - particleGroup.rotation.y) * 0.08;
  particleGroup.position.y = state.scrollProgress * 80;

  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

const lenis = new Lenis({
  duration: 1.05,
  smoothWheel: true,
  wheelMultiplier: 0.92,
  touchMultiplier: 1.15,
});

function lenisFrame(time) {
  lenis.raf(time);
  requestAnimationFrame(lenisFrame);
}

window.addEventListener("resize", resize, { passive: true });
window.addEventListener("pointermove", onPointerMove, { passive: true });
window.addEventListener("pointerleave", onPointerLeave, { passive: true });
window.addEventListener("blur", onPointerLeave, { passive: true });

resize();
requestAnimationFrame(render);
requestAnimationFrame(lenisFrame);
