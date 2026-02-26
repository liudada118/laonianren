/**
 * 3D 鞋垫压力模型 - 基于 huisheng-sdk
 * 使用 React Three Fiber + Three.js 自定义 Shader 实现实时压力 3D 可视化
 * 支持 64×64 矩阵数据，热力图着色 + 凹陷效果
 * 
 * 关键优化：通过 dataRef（来自 InsoleScene Context）读取实时数据，
 * 在 useFrame 中直接更新纹理，完全绕过 React 重渲染。
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

// ─── Vertex Shader ───
const vertexShader = `
varying vec2 vUv;
varying float vPressure;
varying vec3 vViewPosition;
varying vec3 vNormal;
varying vec3 vWorldPosition;

uniform sampler2D uPressureMap;
uniform float uDisplacementScale;
uniform float uThickness;
uniform float uSmoothness;

float getSmoothedPressure(vec2 uv) {
    float offset = 1.0 / 64.0;
    float p = texture2D(uPressureMap, uv).r;
    if (uSmoothness < 0.01) return p;
    
    float pL = texture2D(uPressureMap, uv + vec2(-offset, 0.0)).r;
    float pR = texture2D(uPressureMap, uv + vec2(offset, 0.0)).r;
    float pD = texture2D(uPressureMap, uv + vec2(0.0, -offset)).r;
    float pU = texture2D(uPressureMap, uv + vec2(0.0, offset)).r;
    float pTL = texture2D(uPressureMap, uv + vec2(-offset, offset)).r;
    float pTR = texture2D(uPressureMap, uv + vec2(offset, offset)).r;
    float pDL = texture2D(uPressureMap, uv + vec2(-offset, -offset)).r;
    float pDR = texture2D(uPressureMap, uv + vec2(offset, -offset)).r;
    
    float avg = (p + pL + pR + pD + pU + pTL + pTR + pDL + pDR) / 9.0;
    return mix(p, avg, uSmoothness);
}

void main() {
  vUv = uv;
  vec3 objectNormal = normal;
  
  if (objectNormal.z > 0.5) {
      float pressure = getSmoothedPressure(uv);
      vPressure = pressure;
      
      vec3 newPosition = position;
      float maxDisplacement = uThickness * 0.95;
      float displacement = min(pressure * uDisplacementScale, maxDisplacement);
      newPosition.z -= displacement;
      
      float offset = 1.0 / 64.0;
      float pL = getSmoothedPressure(uv + vec2(-offset, 0.0));
      float pR = getSmoothedPressure(uv + vec2(offset, 0.0));
      float pD = getSmoothedPressure(uv + vec2(0.0, -offset));
      float pU = getSmoothedPressure(uv + vec2(0.0, offset));
      
      float hL = min(pL * uDisplacementScale, maxDisplacement);
      float hR = min(pR * uDisplacementScale, maxDisplacement);
      float hD = min(pD * uDisplacementScale, maxDisplacement);
      float hU = min(pU * uDisplacementScale, maxDisplacement);
      
      vec3 vT = normalize(vec3(2.0 * offset, 0.0, hL - hR));
      vec3 vB = normalize(vec3(0.0, 2.0 * offset, hD - hU));
      vNormal = normalize(cross(vT, vB));
      
      vec4 worldPos = modelMatrix * vec4(newPosition, 1.0);
      vWorldPosition = worldPos.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
  } else {
      vPressure = 0.0;
      vNormal = normal;
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPos.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
  }

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = -mvPosition.xyz;
}
`;

// ─── Fragment Shader ───
const fragmentShader = `
varying vec2 vUv;
varying float vPressure;
varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec3 vWorldPosition;

uniform bool uShowHeatmap;
uniform vec3 uBaseColor;
uniform bool uEnableClipping;
uniform float uClipLevel;

vec3 getHeatmapColor(float t) {
  t = clamp(t, 0.0, 1.0);
  float r = clamp(1.5 - abs(2.0 * t - 1.0) * 2.0, 0.0, 1.0);
  float g = clamp(1.5 - abs(2.0 * t - 0.5) * 2.0, 0.0, 1.0);
  float b = clamp(1.5 - abs(2.0 * t - 0.0) * 2.0, 0.0, 1.0);
  return vec3(r, g, b);
}

void main() {
  if (uEnableClipping && vUv.y < uClipLevel) discard;

  vec3 normal = normalize(vNormal);
  if (!gl_FrontFacing) normal = -normal;

  vec3 lightDir = normalize(vec3(0.5, 0.5, 1.0)); 
  vec3 ambient = vec3(0.3);
  float diff = max(dot(normal, lightDir), 0.0);
  vec3 diffuse = diff * vec3(0.7);
  
  vec3 viewDir = normalize(vViewPosition);
  vec3 reflectDir = reflect(-lightDir, normal);
  float spec = pow(max(dot(viewDir, reflectDir), 0.0), 32.0);
  vec3 specular = spec * vec3(0.1);

  vec3 surfaceColor = uBaseColor;
  
  if (!gl_FrontFacing) {
      surfaceColor = vec3(0.4, 0.4, 0.4);
  } else if (uShowHeatmap && vPressure > 0.01) {
      vec3 heatColor = getHeatmapColor(vPressure);
      surfaceColor = mix(surfaceColor, heatColor, 0.9);
  }

  if (uEnableClipping && abs(vUv.y - uClipLevel) < 0.005) {
      surfaceColor = vec3(1.0, 0.2, 0.2);
      ambient = vec3(1.0);
  }

  vec3 finalColor = (ambient + diffuse) * surfaceColor + specular;
  gl_FragColor = vec4(finalColor, 1.0);
}
`;

/**
 * @param {Object} props
 * @param {boolean} props.showHeatmap
 * @param {boolean} props.enableClipping
 * @param {number} props.clipLevel
 * @param {number} props.depthScale
 * @param {number} props.smoothness
 * @param {React.MutableRefObject} props.dataRef - ref 对象，.current 为 64×64 矩阵或 null
 */
export default function InsoleModel({ showHeatmap = true, enableClipping = false, clipLevel = 0.5, depthScale = 0.3, smoothness = 0.5, dataRef }) {
  const thickness = 0.15;
  const materialRef = useRef(null);
  const textureRef = useRef(null);
  const propsRef = useRef({ showHeatmap, enableClipping, clipLevel, depthScale, smoothness });

  // 更新 propsRef（不触发重渲染）
  propsRef.current = { showHeatmap, enableClipping, clipLevel, depthScale, smoothness };

  // 初始化纹理（白板，全零）
  useMemo(() => {
    if (!textureRef.current) {
      const width = 64;
      const height = 64;
      const data = new Float32Array(width * height); // 默认全零，白板状态

      const texture = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.FloatType);
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      textureRef.current = texture;
    }
  }, []);

  // 在动画帧中更新纹理数据和 uniforms — 完全绕过 React 重渲染
  useFrame(() => {
    const mat = materialRef.current;
    if (!mat) return;

    const { showHeatmap: sh, enableClipping: ec, clipLevel: cl, depthScale: ds, smoothness: sm } = propsRef.current;
    mat.uniforms.uShowHeatmap.value = sh;
    mat.uniforms.uEnableClipping.value = ec;
    mat.uniforms.uClipLevel.value = cl;
    mat.uniforms.uDisplacementScale.value = ds;
    mat.uniforms.uSmoothness.value = sm;

    // 更新纹理数据
    const matrix = dataRef?.current;
    const texture = textureRef.current;
    if (!texture || !texture.image) return;


    const width = 64;
    const height = 64;
    const texData = texture.image.data;
    if (!texData || texData.length !== width * height) return;

    if (matrix && matrix.length > 0) {
      const inputRows = matrix.length;
      const inputCols = matrix[0]?.length || 0;
      // 找最大值用于归一化
      let maxVal = 1;
      for (let i = 0; i < inputRows; i++) {
        for (let j = 0; j < inputCols; j++) {
          if (matrix[i][j] > maxVal) maxVal = matrix[i][j];
        }
      }

      for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
          let val = 0;
          if (inputRows === 64 && inputCols === 64) {
            val = matrix[height - 1 - r]?.[c] || 0;
          } else if (inputRows === 32 && inputCols === 32) {
            const srcR = (height - 1 - r) * 31 / 63;
            const srcC = c * 31 / 63;
            const r0 = Math.floor(srcR), r1 = Math.min(r0 + 1, 31);
            const c0 = Math.floor(srcC), c1 = Math.min(c0 + 1, 31);
            const rFrac = srcR - r0, cFrac = srcC - c0;
            val = (matrix[r0]?.[c0] || 0) * (1 - rFrac) * (1 - cFrac)
                + (matrix[r0]?.[c1] || 0) * (1 - rFrac) * cFrac
                + (matrix[r1]?.[c0] || 0) * rFrac * (1 - cFrac)
                + (matrix[r1]?.[c1] || 0) * rFrac * cFrac;
          }
          texData[r * width + c] = Math.min(val / maxVal, 1.0);
        }
      }
      texture.needsUpdate = true;
    } else if (!matrix) {
      // 数据为 null 时清空纹理（白板状态）
      for (let i = 0; i < width * height; i++) {
        texData[i] = 0;
      }
      texture.needsUpdate = true;
    }

    mat.uniforms.uPressureMap.value = texture;
  });

  // Stable uniforms object — 只创建一次
  const uniforms = useMemo(() => ({
    uPressureMap: { value: textureRef.current },
    uDisplacementScale: { value: depthScale },
    uThickness: { value: thickness },
    uShowHeatmap: { value: showHeatmap },
    uBaseColor: { value: new THREE.Color('#eeeeee') },
    uEnableClipping: { value: enableClipping },
    uClipLevel: { value: clipLevel },
    uSmoothness: { value: smoothness }
  }), []);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <boxGeometry args={[2, 2, thickness, 128, 128, 1]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
