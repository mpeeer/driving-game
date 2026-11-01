import * as THREE from 'three';

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');
  return [canvas, ctx];
}

function textureFrom(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

export interface AsphaltTextures {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

export function makeAsphaltTextures(): AsphaltTextures {
  const [colorCanvas, color] = makeCanvas(512, 512);
  color.fillStyle = '#14161b';
  color.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 18000; i++) {
    const shade = 16 + Math.random() * 48;
    color.fillStyle = `rgba(${shade},${shade + 2},${shade + 5},${0.12 + Math.random() * 0.4})`;
    const size = Math.random() * 2.2 + 0.4;
    color.fillRect(Math.random() * 512, Math.random() * 512, size, size);
  }

  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 512;
    const width = Math.random() * 18 + 3;
    const gradient = color.createLinearGradient(x, 0, x + width, 0);
    gradient.addColorStop(0, 'rgba(5,7,10,0)');
    gradient.addColorStop(0.5, 'rgba(5,7,10,0.35)');
    gradient.addColorStop(1, 'rgba(5,7,10,0)');
    color.fillStyle = gradient;
    color.fillRect(x, 0, width, 512);
  }

  const [roughCanvas, rough] = makeCanvas(512, 512);
  rough.fillStyle = '#b4b4b4';
  rough.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const rx = 20 + Math.random() * 120;
    const ry = 30 + Math.random() * 170;
    const gradient = rough.createRadialGradient(x, y, 2, x, y, Math.max(rx, ry));
    gradient.addColorStop(0, 'rgba(22,22,22,0.95)');
    gradient.addColorStop(0.55, 'rgba(58,58,58,0.7)');
    gradient.addColorStop(1, 'rgba(180,180,180,0)');
    rough.save();
    rough.translate(x, y);
    rough.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
    rough.translate(-x, -y);
    rough.fillStyle = gradient;
    rough.beginPath();
    rough.arc(x, y, Math.max(rx, ry), 0, Math.PI * 2);
    rough.fill();
    rough.restore();
  }

  for (let i = 0; i < 900; i++) {
    const tone = 110 + Math.random() * 90;
    rough.fillStyle = `rgba(${tone},${tone},${tone},0.18)`;
    rough.fillRect(Math.random() * 512, Math.random() * 512, Math.random() * 3, Math.random() * 3);
  }

  const map = textureFrom(colorCanvas);
  const roughnessMap = textureFrom(roughCanvas);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  return { map, roughnessMap };
}

export function makeGlowTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128, 128);
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.16, 'rgba(255,240,210,0.9)');
  gradient.addColorStop(0.4, 'rgba(255,205,150,0.28)');
  gradient.addColorStop(1, 'rgba(255,190,120,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function makeStreakTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128, 256);
  const image = ctx.createImageData(128, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 128; x++) {
      const nx = (x / 127) * 2 - 1;
      const ny = (y / 255) * 2 - 1;
      const horizontal = Math.pow(Math.max(0, 1 - Math.abs(nx)), 2.4);
      const vertical = Math.pow(Math.max(0, 1 - Math.abs(ny)), 1.4);
      const ripple = 0.55 + 0.45 * Math.sin(x * 0.35 + y * 0.09);
      const alpha = horizontal * vertical * ripple * 255;
      const index = (y * 128 + x) * 4;
      image.data[index] = 255;
      image.data[index + 1] = 196;
      image.data[index + 2] = 132;
      image.data[index + 3] = alpha;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function makeWindowTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128, 256);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 128, 256);
  const cols = 7;
  const rows = 20;
  const cellW = 128 / cols;
  const cellH = 256 / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lit = Math.random() < 0.28;
      if (lit) {
        const warm = Math.random() < 0.7;
        ctx.fillStyle = warm ? `rgba(255,206,142,${0.55 + Math.random() * 0.45})` : `rgba(160,205,255,${0.4 + Math.random() * 0.4})`;
      } else {
        ctx.fillStyle = `rgba(18,24,33,${0.3 + Math.random() * 0.4})`;
      }
      ctx.fillRect(x * cellW + cellW * 0.22, y * cellH + cellH * 0.2, cellW * 0.5, cellH * 0.45);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function makeEnvironmentTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(1024, 512);
  const sky = ctx.createLinearGradient(0, 0, 0, 300);
  sky.addColorStop(0, '#03060d');
  sky.addColorStop(0.4, '#0b1524');
  sky.addColorStop(0.75, '#283348');
  sky.addColorStop(0.92, '#6e4a39');
  sky.addColorStop(1, '#2a1e22');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1024, 300);

  const ground = ctx.createLinearGradient(0, 300, 0, 512);
  ground.addColorStop(0, '#0b0d11');
  ground.addColorStop(1, '#030405');
  ctx.fillStyle = ground;
  ctx.fillRect(0, 300, 1024, 212);

  const glow = ctx.createRadialGradient(706, 298, 4, 706, 298, 250);
  glow.addColorStop(0, 'rgba(255,186,112,0.9)');
  glow.addColorStop(0.3, 'rgba(235,128,72,0.32)');
  glow.addColorStop(1, 'rgba(160,70,40,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(420, 180, 600, 200);

  for (let i = 0; i < 160; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 220;
    const bright = 0.15 + Math.random() * 0.5;
    ctx.fillStyle = `rgba(205,222,255,${bright})`;
    ctx.fillRect(x, y, Math.random() < 0.15 ? 2 : 1, 1);
  }

  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 1024;
    const y = 292 + Math.random() * 18;
    const size = 2 + Math.random() * 9;
    ctx.fillStyle = `rgba(255,190,120,${0.1 + Math.random() * 0.25})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
