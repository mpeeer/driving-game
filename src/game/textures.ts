import * as THREE from 'three';

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');
  return [canvas, ctx];
}

function finish(texture: THREE.CanvasTexture, repeat = false): THREE.CanvasTexture {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  return texture;
}

/** A quiet, dry asphalt grain. 256px is plenty at driving speed. */
export function makeAsphaltTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#4b4e50';
  ctx.fillRect(0, 0, 256, 256);

  const wash = ctx.createLinearGradient(0, 0, 0, 256);
  wash.addColorStop(0, 'rgba(255,255,255,0.055)');
  wash.addColorStop(0.5, 'rgba(0,0,0,0.035)');
  wash.addColorStop(1, 'rgba(255,255,255,0.03)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 4200; i++) {
    const shade = 50 + Math.random() * 58;
    ctx.fillStyle = `rgba(${shade},${shade + 1},${shade + 2},${0.12 + Math.random() * 0.26})`;
    const size = Math.random() * 1.7 + 0.35;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, size, size);
  }

  for (let i = 0; i < 26; i++) {
    ctx.strokeStyle = `rgba(25,26,27,${0.06 + Math.random() * 0.1})`;
    ctx.lineWidth = 0.6 + Math.random() * 1.1;
    ctx.beginPath();
    const x = Math.random() * 256;
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + 20, 80, x - 14, 180, x + 8, 256);
    ctx.stroke();
  }

  const texture = finish(new THREE.CanvasTexture(canvas), true);
  texture.repeat.set(2.4, 1);
  return texture;
}

/** Equirectangular late-afternoon sky, painted once at load. */
export function makeSkyTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(1024, 512);

  const sky = ctx.createLinearGradient(0, 0, 0, 300);
  sky.addColorStop(0, '#1d68b7');
  sky.addColorStop(0.38, '#3f92d4');
  sky.addColorStop(0.68, '#8bc8e2');
  sky.addColorStop(0.86, '#d6e8e5');
  sky.addColorStop(1, '#f2d6b2');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1024, 300);

  const sea = ctx.createLinearGradient(0, 300, 0, 512);
  sea.addColorStop(0, '#5aa7b7');
  sea.addColorStop(0.35, '#2c829a');
  sea.addColorStop(1, '#135e79');
  ctx.fillStyle = sea;
  ctx.fillRect(0, 300, 1024, 212);

  // The sun sits just above the western horizon.
  const sunX = 205;
  const sunY = 274;
  const glow = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, 210);
  glow.addColorStop(0, 'rgba(255,253,236,1)');
  glow.addColorStop(0.06, 'rgba(255,241,198,0.98)');
  glow.addColorStop(0.17, 'rgba(255,214,152,0.55)');
  glow.addColorStop(0.42, 'rgba(255,180,116,0.2)');
  glow.addColorStop(1, 'rgba(255,172,112,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 40, 500, 330);

  ctx.fillStyle = 'rgba(255,252,235,0.95)';
  ctx.beginPath();
  ctx.arc(sunX, sunY, 17, 0, Math.PI * 2);
  ctx.fill();

  // A warm ribbon along the horizon, strongest near the sun.
  const horizon = ctx.createLinearGradient(0, 260, 0, 330);
  horizon.addColorStop(0, 'rgba(255,214,166,0)');
  horizon.addColorStop(0.65, 'rgba(255,207,158,0.2)');
  horizon.addColorStop(1, 'rgba(255,192,142,0.38)');
  ctx.fillStyle = horizon;
  ctx.fillRect(0, 258, 1024, 74);

  // Soft cloud banks. They stay away from the map seam.
  const clouds = [
    [320, 112, 170, 24, 0.22],
    [430, 88, 210, 18, 0.16],
    [560, 154, 150, 16, 0.15],
    [760, 120, 185, 20, 0.18],
    [900, 80, 150, 14, 0.13],
    [180, 160, 130, 14, 0.12],
  ];
  for (const [x, y, w, h, a] of clouds) {
    const cloud = ctx.createRadialGradient(x, y, 2, x, y, w * 0.55);
    cloud.addColorStop(0, `rgba(255,250,242,${a})`);
    cloud.addColorStop(0.45, `rgba(255,250,246,${a * 0.55})`);
    cloud.addColorStop(1, 'rgba(255,250,246,0)');
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, h / w);
    ctx.translate(-x, -y);
    ctx.fillStyle = cloud;
    ctx.beginPath();
    ctx.arc(x, y, w * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // A few gulls, barely there.
  ctx.strokeStyle = 'rgba(37,55,67,0.38)';
  ctx.lineWidth = 1.2;
  for (const [x, y] of [[660, 185], [680, 172], [700, 192]]) {
    ctx.beginPath();
    ctx.moveTo(x - 5, y);
    ctx.quadraticCurveTo(x, y - 4, x + 5, y);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Neutral grain that lets the terrain's vertex colours carry the palette. */
export function makeGroundTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#d8d8d0';
  ctx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 3100; i++) {
    const shade = 120 + Math.random() * 105;
    ctx.fillStyle = `rgba(${shade},${shade + 2},${shade - 6},${0.06 + Math.random() * 0.14})`;
    const size = 0.5 + Math.random() * 2.1;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, size, size * (0.6 + Math.random()));
  }

  for (let i = 0; i < 38; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    ctx.strokeStyle = `rgba(75,86,58,${0.035 + Math.random() * 0.05})`;
    ctx.lineWidth = 0.6 + Math.random() * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 3, y - 4, x + 1, y - 8 - Math.random() * 5);
    ctx.stroke();
  }

  const texture = finish(new THREE.CanvasTexture(canvas), true);
  texture.repeat.set(46, 46);
  return texture;
}

/** Cheap animated water: repeated ripples plus a hint of turquoise. */
export function makeWaterTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#1a7d93';
  ctx.fillRect(0, 0, 256, 256);

  for (let y = 0; y < 256; y += 4) {
    const alpha = 0.05 + Math.random() * 0.08;
    ctx.strokeStyle = `rgba(195,242,236,${alpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= 256; x += 8) {
      const yy = y + Math.sin(x * 0.07 + y * 0.11) * 2.2;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  for (let i = 0; i < 140; i++) {
    ctx.fillStyle = `rgba(235,255,250,${0.1 + Math.random() * 0.22})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, Math.random() * 5 + 1, 0.8);
  }

  const texture = finish(new THREE.CanvasTexture(canvas), true);
  texture.repeat.set(34, 34);
  return texture;
}

/** Additive warm glitter path on the sea toward the sun. */
export function makeSunPathTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(256, 512);
  ctx.clearRect(0, 0, 256, 512);

  const path = ctx.createLinearGradient(0, 0, 0, 512);
  path.addColorStop(0, 'rgba(255,228,174,0)');
  path.addColorStop(0.34, 'rgba(255,226,170,0.18)');
  path.addColorStop(0.68, 'rgba(255,213,143,0.4)');
  path.addColorStop(1, 'rgba(255,198,120,0.06)');
  ctx.fillStyle = path;
  ctx.fillRect(54, 0, 148, 512);

  for (let i = 0; i < 220; i++) {
    const y = Math.random() * 512;
    const spread = 34 + (y / 512) * 60;
    const x = 128 + (Math.random() * 2 - 1) * spread;
    const w = 1 + Math.random() * 9;
    const h = 0.7 + Math.random() * 2.2;
    ctx.fillStyle = `rgba(255,235,190,${0.08 + Math.random() * 0.35})`;
    ctx.fillRect(x, y, w, h);
  }

  return finish(new THREE.CanvasTexture(canvas), true);
}

export function makeGlowTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128, 128);
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.15, 'rgba(255,239,206,0.9)');
  gradient.addColorStop(0.42, 'rgba(255,203,143,0.24)');
  gradient.addColorStop(1, 'rgba(255,182,105,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Window grid used by the city towers; tinted per building. */
export function makeWindowTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128, 256);
  ctx.fillStyle = '#8ea3a4';
  ctx.fillRect(0, 0, 128, 256);

  const cols = 7;
  const rows = 18;
  const cellW = 128 / cols;
  const cellH = 256 / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lit = Math.random() < 0.14;
      ctx.fillStyle = lit
        ? `rgba(255,239,206,${0.35 + Math.random() * 0.25})`
        : `rgba(41,75,87,${0.55 + Math.random() * 0.3})`;
      ctx.fillRect(x * cellW + cellW * 0.2, y * cellH + cellH * 0.18, cellW * 0.55, cellH * 0.5);
    }
  }

  const texture = finish(new THREE.CanvasTexture(canvas), true);
  return texture;
}
