/**
 * Heatmap Canvas - GPU-accelerated heatmap rendering for pressure sensor data
 * Adapted from the original heatmap.js for the sarcopenia assessment system
 */
import * as THREE from 'three';

/* ─── CPU Fallback helpers ─── */

function Canvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function addSide(arr, width, height, wnum, hnum, sideNum) {
  const narr = new Array(height);
  const res = [];
  for (let i = 0; i < height; i++) {
    narr[i] = [];
    for (let j = 0; j < width; j++) {
      if (j === 0) {
        narr[i].push(...new Array(wnum).fill(sideNum >= 0 ? sideNum : 1), arr[i * width + j]);
      } else if (j === width - 1) {
        narr[i].push(arr[i * width + j], ...new Array(wnum).fill(sideNum >= 0 ? sideNum : 1));
      } else {
        narr[i].push(arr[i * width + j]);
      }
    }
  }
  for (let i = 0; i < height; i++) {
    res.push(...narr[i]);
  }
  return [
    ...new Array(hnum * (width + 2 * wnum)).fill(sideNum >= 0 ? sideNum : 1),
    ...res,
    ...new Array(hnum * (width + 2 * wnum)).fill(sideNum >= 0 ? sideNum : 1),
  ];
}

function interpSmall(smallMat, width, height, interp1, interp2) {
  const bigMat = new Array((width * interp1) * (height * interp2)).fill(0);
  for (let i = 0; i < height; i++) {
    for (let j = 0; j < width; j++) {
      bigMat[(width * interp1) * i * interp2 + (j * interp1)] = smallMat[i * width + j] * 10;
      bigMat[(width * interp1) * (i * interp2 + 1) + (j * interp1)] = smallMat[i * width + j] * 10;
    }
  }
  return bigMat;
}

function generateData(arr, canvas, width, height, interp1, interp2, order) {
  let resArr = addSide(arr, height, width, order, order, 0);
  const interpArr = interpSmall(resArr, height + order * 2, width + order * 2, interp1, interp2);
  const data = [];
  const dataWidth = (width + order * 2) * interp1;
  const dataHeight = (height + order * 2) * interp2;
  for (let i = 0; i < dataHeight; i++) {
    for (let j = 0; j < dataWidth; j++) {
      data.push({
        y: i * canvas.width / dataWidth,
        x: j * canvas.height / dataHeight,
        value: interpArr[i * dataWidth + j]
      });
    }
  }
  return data;
}

let isShadow = true;

function createCircle(size) {
  const shadowBlur = size / 2;
  const r2 = size + shadowBlur;
  const offsetDistance = 10000;
  const circle = new Canvas(r2 * 2, r2 * 2);
  const context = circle.getContext('2d');
  if (isShadow) context.shadowBlur = shadowBlur;
  context.shadowColor = 'black';
  context.shadowOffsetX = context.shadowOffsetY = offsetDistance;
  context.beginPath();
  context.arc(r2 - offsetDistance, r2 - offsetDistance, size, 0, Math.PI * 2, true);
  context.closePath();
  context.fill();
  return circle;
}

function Intensity(options) {
  options = options || {};
  this.gradient = options.gradient || DEFAULT_GRADIENT;
  this.maxSize = options.maxSize || 35;
  this.minSize = options.minSize || 0;
  this.max = options.max || 100;
  this.min = options.min || 0;
  this.initPalette();
}

Intensity.prototype.initPalette = function () {
  const gradient = this.gradient;
  const canvas = new Canvas(256, 1);
  const paletteCtx = this.paletteCtx = canvas.getContext('2d');
  const lineGradient = paletteCtx.createLinearGradient(0, 0, 256, 1);
  for (const key in gradient) {
    lineGradient.addColorStop(parseFloat(key), gradient[key]);
  }
  paletteCtx.fillStyle = lineGradient;
  paletteCtx.fillRect(0, 0, 256, 1);
};

Intensity.prototype.getImageData = function (value) {
  const imageData = this.paletteCtx.getImageData(0, 0, 256, 1).data;
  if (value === undefined) return imageData;
  const max = this.max;
  const min = this.min;
  if (value > max) value = max;
  if (value < min) value = min;
  const index = Math.floor((value - min) / (max - min) * (256 - 1));
  return [imageData[index], imageData[index + 1], imageData[index + 2], imageData[index + 3]];
};

function colorize(pixels, gradient, options) {
  const max = options.max;
  const min = options.min;
  const diff = max - min;
  let jMin = options.fliter ? options.fliter : 100;
  let jMax = 1024;
  const range = options.range || null;
  if (range && range.length === 2) jMin = (range[0] - min) / diff * 1024;
  if (range && range.length === 2) jMax = (range[1] - min) / diff * 1024;

  for (let i = 3, len = pixels.length, j; i < len; i += 4) {
    j = pixels[i] * 4;
    if (pixels[i] / 256 < 1) pixels[i] = 256 * 1;
    if (j && j >= jMin && j <= jMax) {
      pixels[i - 3] = gradient[j];
      pixels[i - 2] = gradient[j + 1];
      pixels[i - 1] = gradient[j + 2];
    } else {
      pixels[i] = 0;
    }
  }
}

function applySharpen(context, width, height) {
  const originalImageData = context.getImageData(0, 0, width, height);
  const originalPixels = originalImageData.data;
  const outputImageData = context.createImageData(width, height);
  const outputPixels = outputImageData.data;
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  const kernelSize = 3;
  const halfKernelSize = 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = 0; ky < kernelSize; ky++) {
        for (let kx = 0; kx < kernelSize; kx++) {
          const pixelY = y + ky - halfKernelSize;
          const pixelX = x + kx - halfKernelSize;
          if (pixelY < 0 || pixelY >= height || pixelX < 0 || pixelX >= width) continue;
          const offset = (pixelY * width + pixelX) * 4;
          const weight = kernel[ky * kernelSize + kx];
          r += originalPixels[offset] * weight;
          g += originalPixels[offset + 1] * weight;
          b += originalPixels[offset + 2] * weight;
        }
      }
      const destOffset = (y * width + x) * 4;
      outputPixels[destOffset] = r;
      outputPixels[destOffset + 1] = g;
      outputPixels[destOffset + 2] = b;
      outputPixels[destOffset + 3] = originalPixels[destOffset + 3];
    }
  }
  context.putImageData(outputImageData, 0, 0);
}

function draw(context, data, canvas, options) {
  const circle = createCircle(options.size);
  const circleHalfWidth = circle.width / 2;
  const circleHalfHeight = circle.height / 2;

  const dataOrderByAlpha = {};
  data.forEach((item) => {
    const alpha = Math.min(1, item.value / options.max).toFixed(2);
    dataOrderByAlpha[alpha] = dataOrderByAlpha[alpha] || [];
    dataOrderByAlpha[alpha].push(item);
  });

  for (const i in dataOrderByAlpha) {
    if (isNaN(i)) continue;
    const _data = dataOrderByAlpha[i];
    context.beginPath();
    context.globalAlpha = i;
    _data.forEach(item => {
      context.drawImage(circle, item.x - circleHalfWidth, item.y - circleHalfHeight);
    });
  }

  const intensity = new Intensity(options);
  const colored = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
  colorize(colored.data, intensity.getImageData(), options);
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.putImageData(colored, 0, 0);
  applySharpen(context, canvas.width, canvas.height);
}

function bthClickHandle(arr, canvas, width, height, interp1, interp2, order, options) {
  const data = generateData(arr, canvas, width, height, interp1, interp2, order);
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  isShadow = true;
  context.globalCompositeOperation = 'lighter';
  draw(context, data, canvas, options);
  isShadow = false;
}

/* ─── GPU Shader-based rendering ─── */

const DEFAULT_GRADIENT = {
  0.00: '#ffffff',
  0.01: '#4192fe',
  0.08: '#49aaff',
  0.17: '#51c6ff',
  0.25: '#4ddff5',
  0.33: '#34f6db',
  0.42: '#6cffb9',
  0.50: '#c5ff8b',
  0.58: '#fdf655',
  0.67: '#ffda41',
  0.75: '#ffb54a',
  0.83: '#ff9555',
  0.92: '#ff7665',
  1.00: '#ff0000'
};

function buildGradientTexture(gradient) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  const stops = Object.keys(gradient)
    .map((k) => ({ stop: parseFloat(k), color: gradient[k] }))
    .sort((a, b) => a.stop - b.stop);
  const lineGradient = ctx.createLinearGradient(0, 0, 256, 0);
  stops.forEach(({ stop, color }) => lineGradient.addColorStop(stop, color));
  ctx.fillStyle = lineGradient;
  ctx.fillRect(0, 0, 256, 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createHeatmapMaterial(dataTexture, gradientTexture, texelSize) {
  return new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uData: { value: dataTexture },
      uGradient: { value: gradientTexture },
      uTexel: { value: texelSize },
      uSharpen: { value: 0.6 },
      uGamma: { value: 1.0 },
      uFlipX: { value: 0.0 },
      uFlipY: { value: 1.0 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uData;
      uniform sampler2D uGradient;
      uniform vec2 uTexel;
      uniform float uSharpen;
      uniform float uGamma;
      uniform float uFlipX;
      uniform float uFlipY;

      void main() {
        vec2 uv = vUv;
        if (uFlipX > 0.5) uv.x = 1.0 - uv.x;
        if (uFlipY > 0.5) uv.y = 1.0 - uv.y;
        float c = texture2D(uData, uv).r;
        float l = texture2D(uData, uv + vec2(-uTexel.x, 0.0)).r;
        float r = texture2D(uData, uv + vec2(uTexel.x, 0.0)).r;
        float u = texture2D(uData, uv + vec2(0.0, uTexel.y)).r;
        float d = texture2D(uData, uv + vec2(0.0, -uTexel.y)).r;
        float blur = (l + r + u + d) * 0.25;
        float v = clamp(c + uSharpen * (c - blur), 0.0, 1.0);
        v = pow(v, uGamma);
        vec4 col = texture2D(uGradient, vec2(v, 0.5));
        gl_FragColor = col;
      }
    `
  });
}

/* ─── Main HeatmapCanvas class ─── */

export class HeatmapCanvas {
  constructor(width, height, canvasWProp, canvasHProp, canvasName, options) {
    this.width = 32;
    this.height = 32;
    this.canvas = document.createElement('canvas');

    const contentWidth = 1024;
    this.options = {
      min: 0,
      max: 2000,
      size: contentWidth * canvasWProp / 4
    };

    if (canvasName === 'body') {
      this.options.size = contentWidth * canvasWProp / 40;
      this.canvas.width = contentWidth * canvasWProp;
      this.canvas.height = contentWidth * canvasHProp;
    } else {
      this.canvas.width = contentWidth * canvasWProp;
      this.canvas.height = contentWidth * canvasHProp;
    }

    if (options) {
      // 合并而不是覆盖，保留 gradient 等默认值
      this.options = { ...this.options, ...options };
    }

    this.useGPU = false;
    try {
      this.gpuCanvas = document.createElement('canvas');
      this.gpuCanvas.width = this.canvas.width;
      this.gpuCanvas.height = this.canvas.height;
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.gpuCanvas,
        antialias: false,
        alpha: true,
        preserveDrawingBuffer: true
      });
      this.renderer.setSize(this.gpuCanvas.width, this.gpuCanvas.height, false);
      this.renderer.setClearColor(0x000000, 0);

      this.scene = new THREE.Scene();
      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const texelSize = new THREE.Vector2(1 / this.width, 1 / this.height);
      this.dataTexture = new THREE.DataTexture(
        new Uint8Array(this.width * this.height * 4),
        this.width,
        this.height,
        THREE.RGBAFormat
      );
      this.dataTexture.minFilter = THREE.LinearFilter;
      this.dataTexture.magFilter = THREE.LinearFilter;
      this.dataTexture.needsUpdate = true;

      const gradient = (this.options && this.options.gradient) || DEFAULT_GRADIENT;
      this.gradientTexture = buildGradientTexture(gradient);
      this.material = createHeatmapMaterial(this.dataTexture, this.gradientTexture, texelSize);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
      this.scene.add(plane);
      this.cpuCtx = this.canvas.getContext('2d');
      this.useGPU = true;
    } catch (err) {
      this.useGPU = false;
    }
  }

  changeHeatmap(resArr, interp1, interp2, order) {
    // 调试日志：每50帧打印一次
    if (!this._frameCount) this._frameCount = 0;
    this._frameCount++;
    const shouldLog = this._frameCount % 50 === 1;

    if (shouldLog) {
      const nonZero = Array.isArray(resArr) ? resArr.filter(v => v > 0).length : 0;
      const maxVal = Array.isArray(resArr) ? Math.max(...resArr) : 0;
      console.log(`[Heatmap] changeHeatmap #${this._frameCount}: arrLen=${resArr?.length}, nonZero=${nonZero}, max=${maxVal}, useGPU=${this.useGPU}, canvas=${this.canvas.width}x${this.canvas.height}, options.max=${this.options.max}`);
    }

    if (!this.useGPU) {
      bthClickHandle(resArr, this.canvas, this.width, this.height, interp1, interp2, order, this.options);
      return;
    }
    const min = typeof this.options.min === 'number' ? this.options.min : 0;
    const max = typeof this.options.max === 'number' ? this.options.max : 1;
    const range = max - min || 1;
    const data = this.dataTexture.image.data;
    const total = this.width * this.height;
    for (let i = 0; i < total; i++) {
      const v = Array.isArray(resArr) ? resArr[i] || 0 : 0;
      let n = (v - min) / range;
      if (n < 0) n = 0;
      if (n > 1) n = 1;
      const base = i * 4;
      const value = Math.round(n * 255);
      data[base] = value;
      data[base + 1] = value;
      data[base + 2] = value;
      data[base + 3] = 255;
    }
    this.dataTexture.needsUpdate = true;
    this.material.uniforms.uSharpen.value = typeof this.options.sharpen === 'number' ? this.options.sharpen : 0.6;
    this.material.uniforms.uGamma.value = typeof this.options.gamma === 'number' ? this.options.gamma : 1.0;
    this.material.uniforms.uFlipX.value = this.options.flipX ? 1.0 : 0.0;
    this.material.uniforms.uFlipY.value = this.options.flipY === false ? 0.0 : 1.0;
    this.renderer.render(this.scene, this.camera);
    if (this.cpuCtx && this.gpuCanvas) {
      this.cpuCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.cpuCtx.drawImage(this.gpuCanvas, 0, 0, this.canvas.width, this.canvas.height);
    }
  }
}
