/**
 * Heatmap Canvas - GPU-accelerated heatmap rendering for pressure sensor data
 * Adapted from the original heatmap.js for the sarcopenia assessment system
 * Enhanced with smooth Gaussian blur and rainbow gradient (blue to red)
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
  0.14: '#4477BB',
  0.28: '#5599CC',
  0.42: '#66BB88',
  0.56: '#CCBB55',
  0.70: '#CC7744',
  0.84: '#BB4444'
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
      uSharpen: { value: 0.0 },
      uGamma: { value: 0.12 },
      uFlipX: { value: 0.0 },
      uFlipY: { value: 1.0 },
      uBlurRadius: { value: 2.5 },
      uAlphaThreshold: { value: 0.04 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uData;
      uniform sampler2D uGradient;
      uniform vec2 uTexel;
      uniform float uSharpen;
      uniform float uGamma;
      uniform float uFlipX;
      uniform float uFlipY;
      uniform float uBlurRadius;
      uniform float uAlphaThreshold;

      // Multi-pass Gaussian blur for smooth heatmap
      float gaussianBlur(vec2 uv) {
        float sigma = uBlurRadius;
        int radius = int(ceil(sigma * 2.0));
        float total = 0.0;
        float weightSum = 0.0;

        for (int y = -6; y <= 6; y++) {
          for (int x = -6; x <= 6; x++) {
            if (abs(x) > radius || abs(y) > radius) continue;
            float fx = float(x);
            float fy = float(y);
            float weight = exp(-(fx * fx + fy * fy) / (2.0 * sigma * sigma));
            vec2 offset = vec2(fx * uTexel.x, fy * uTexel.y);
            total += texture2D(uData, uv + offset).r * weight;
            weightSum += weight;
          }
        }
        return total / weightSum;
      }

      void main() {
        vec2 uv = vUv;
        if (uFlipX > 0.5) uv.x = 1.0 - uv.x;
        if (uFlipY > 0.5) uv.y = 1.0 - uv.y;

        // Apply Gaussian blur for smooth interpolation
        float v = gaussianBlur(uv);

        // Apply gamma correction for better visual contrast
        v = pow(v, uGamma);

        // Clamp to valid range
        v = clamp(v, 0.0, 1.0);

        // Map through rainbow gradient
        vec4 col = texture2D(uGradient, vec2(v, 0.5));

        // Smooth alpha based on value - fade out near zero for clean look
        // Use a wider transition band to ensure zero-data areas are fully transparent
        float alpha = smoothstep(uAlphaThreshold, uAlphaThreshold + 0.06, v);

        // Ensure truly zero values produce zero alpha
        if (v < 0.005) alpha = 0.0;

        gl_FragColor = vec4(col.rgb, alpha);
      }
    `
  });
}

/* ─── Gaussian blur helper for CPU-side data upscaling ─── */

/**
 * Upscale a small grid (srcW x srcH) to a larger grid (dstW x dstH)
 * using bilinear interpolation, then apply Gaussian blur
 */
function upscaleAndBlur(srcArr, srcW, srcH, dstW, dstH, blurPasses) {
  // Step 1: Bilinear upscale
  const upscaled = new Float32Array(dstW * dstH);
  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      // Map destination pixel to source coordinates
      const sx = (dx / dstW) * srcW;
      const sy = (dy / dstH) * srcH;

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const y1 = Math.min(y0 + 1, srcH - 1);

      const fx = sx - x0;
      const fy = sy - y0;

      const v00 = srcArr[y0 * srcW + x0] || 0;
      const v10 = srcArr[y0 * srcW + x1] || 0;
      const v01 = srcArr[y1 * srcW + x0] || 0;
      const v11 = srcArr[y1 * srcW + x1] || 0;

      const val = v00 * (1 - fx) * (1 - fy) +
                  v10 * fx * (1 - fy) +
                  v01 * (1 - fx) * fy +
                  v11 * fx * fy;

      upscaled[dy * dstW + dx] = val;
    }
  }

  // Step 2: Apply multiple passes of box blur (approximates Gaussian)
  let current = upscaled;
  for (let pass = 0; pass < (blurPasses || 3); pass++) {
    const next = new Float32Array(dstW * dstH);
    for (let y = 0; y < dstH; y++) {
      for (let x = 0; x < dstW; x++) {
        let sum = 0;
        let count = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const nx = x + kx;
            const ny = y + ky;
            if (nx >= 0 && nx < dstW && ny >= 0 && ny < dstH) {
              const weight = 1.0 / (1.0 + Math.abs(kx) + Math.abs(ky));
              sum += current[ny * dstW + nx] * weight;
              count += weight;
            }
          }
        }
        next[y * dstW + x] = sum / count;
      }
    }
    current = next;
  }

  return current;
}

/* ─── Main HeatmapCanvas class ─── */

export class HeatmapCanvas {
  constructor(width, height, canvasWProp, canvasHProp, canvasName, options) {
    // Internal data resolution - higher for smoother rendering
    this.srcWidth = 32;
    this.srcHeight = 32;
    // GPU texture resolution - upscaled for smooth heatmap
    this.width = 128;
    this.height = 128;
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

      // Initial render with empty data to ensure canvas starts transparent
      this.renderer.render(this.scene, this.camera);
      this.cpuCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.cpuCtx.drawImage(this.gpuCanvas, 0, 0, this.canvas.width, this.canvas.height);
    } catch (err) {
      this.useGPU = false;
    }
  }

  changeHeatmap(resArr, interp1, interp2, order) {
    if (!this.useGPU) {
      bthClickHandle(resArr, this.canvas, this.srcWidth, this.srcHeight, interp1, interp2, order, this.options);
      return;
    }

    const min = typeof this.options.min === 'number' ? this.options.min : 0;
    const max = typeof this.options.max === 'number' ? this.options.max : 1;
    const range = max - min || 1;

    // Upscale 32x32 source data to 128x128 with bilinear interpolation and blur
    const srcTotal = this.srcWidth * this.srcHeight;
    const normalizedSrc = new Float32Array(srcTotal);
    for (let i = 0; i < srcTotal; i++) {
      const v = Array.isArray(resArr) ? resArr[i] || 0 : 0;
      let n = (v - min) / range;
      if (n < 0) n = 0;
      if (n > 1) n = 1;
      normalizedSrc[i] = n;
    }

    // Upscale and blur for smooth heatmap
    const blurred = upscaleAndBlur(normalizedSrc, this.srcWidth, this.srcHeight, this.width, this.height, 2);

    // Write to GPU texture
    const data = this.dataTexture.image.data;
    const total = this.width * this.height;
    for (let i = 0; i < total; i++) {
      let n = blurred[i];
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
    this.material.uniforms.uSharpen.value = typeof this.options.sharpen === 'number' ? this.options.sharpen : 0.0;
    this.material.uniforms.uGamma.value = typeof this.options.gamma === 'number' ? this.options.gamma : 0.12;
    this.material.uniforms.uFlipX.value = this.options.flipX ? 1.0 : 0.0;
    this.material.uniforms.uFlipY.value = this.options.flipY === false ? 0.0 : 1.0;
    this.renderer.render(this.scene, this.camera);
    if (this.cpuCtx && this.gpuCanvas) {
      this.cpuCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.cpuCtx.drawImage(this.gpuCanvas, 0, 0, this.canvas.width, this.canvas.height);
    }
  }
}
