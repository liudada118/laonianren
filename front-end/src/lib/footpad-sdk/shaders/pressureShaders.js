/**
 * pressureShaders.js - 足底压力3D可视化 WebGL Shader
 * 
 * 简化版：直接使用原始归一化数据(0-1)，不做额外放大/gamma处理。
 * 热力图颜色映射：蓝→青→绿→黄→橙→红
 */

export const vertexShader = `
varying vec2 vUv;
varying float vPressure;
varying vec3 vViewPosition;
varying vec3 vNormal;
varying vec3 vWorldPosition;

uniform sampler2D uPressureMap;
uniform float uDisplacementScale;
uniform float uThickness;
uniform float uSmoothness;

void main() {
  vUv = uv;
  vec3 objectNormal = normal;

  // 纹理大小=64
  float texSize = 64.0;
  float offset = 1.0 / texSize;

  if (objectNormal.z > 0.5) {
      // 读取压力值（已在CPU端归一化到0-1）
      float pressure = texture2D(uPressureMap, uv).r;

      // 可选GPU平滑：简单3×3均值
      if (uSmoothness > 0.01) {
        float sum = pressure;
        sum += texture2D(uPressureMap, uv + vec2(-offset, 0.0)).r;
        sum += texture2D(uPressureMap, uv + vec2(offset, 0.0)).r;
        sum += texture2D(uPressureMap, uv + vec2(0.0, -offset)).r;
        sum += texture2D(uPressureMap, uv + vec2(0.0, offset)).r;
        pressure = mix(pressure, sum / 5.0, uSmoothness);
      }

      vPressure = pressure;

      // 顶点位移（凹陷效果）
      vec3 newPosition = position;
      float maxDisplacement = uThickness * 0.85;
      float displacement = min(pressure * uDisplacementScale, maxDisplacement);
      newPosition.z -= displacement;

      // 计算法线（用于光照）
      float pL = texture2D(uPressureMap, uv + vec2(-offset, 0.0)).r;
      float pR = texture2D(uPressureMap, uv + vec2(offset, 0.0)).r;
      float pD = texture2D(uPressureMap, uv + vec2(0.0, -offset)).r;
      float pU = texture2D(uPressureMap, uv + vec2(0.0, offset)).r;
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

export const fragmentShader = `
varying vec2 vUv;
varying float vPressure;
varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec3 vWorldPosition;

uniform bool uShowHeatmap;
uniform vec3 uBaseColor;

vec3 getHeatmapColor(float t) {
  t = clamp(t, 0.0, 1.0);
  // 蓝→青→绿→黄→橙→红
  vec3 c0 = vec3(0.0, 0.0, 0.5);   // 深蓝
  vec3 c1 = vec3(0.0, 0.5, 1.0);   // 蓝
  vec3 c2 = vec3(0.0, 1.0, 0.5);   // 青绿
  vec3 c3 = vec3(0.5, 1.0, 0.0);   // 黄绿
  vec3 c4 = vec3(1.0, 0.8, 0.0);   // 黄橙
  vec3 c5 = vec3(1.0, 0.3, 0.0);   // 橙红
  vec3 c6 = vec3(0.5, 0.0, 0.0);   // 深红
  if (t < 0.167) return mix(c0, c1, t / 0.167);
  if (t < 0.333) return mix(c1, c2, (t - 0.167) / 0.166);
  if (t < 0.5) return mix(c2, c3, (t - 0.333) / 0.167);
  if (t < 0.667) return mix(c3, c4, (t - 0.5) / 0.167);
  if (t < 0.833) return mix(c4, c5, (t - 0.667) / 0.166);
  return mix(c5, c6, (t - 0.833) / 0.167);
}

void main() {
  vec3 normal = normalize(vNormal);
  if (!gl_FrontFacing) normal = -normal;

  // 光照
  vec3 lightDir = normalize(vec3(0.5, 0.5, 1.0));
  vec3 ambient = vec3(0.35);
  float diff = max(dot(normal, lightDir), 0.0);
  vec3 diffuse = diff * vec3(0.65);
  vec3 viewDir = normalize(vViewPosition);
  vec3 reflectDir = reflect(-lightDir, normal);
  float spec = pow(max(dot(viewDir, reflectDir), 0.0), 64.0);
  vec3 specular = spec * vec3(0.15);

  // 表面颜色
  vec3 surfaceColor = uBaseColor;
  if (!gl_FrontFacing) {
      surfaceColor = vec3(0.4, 0.4, 0.4);
  } else if (uShowHeatmap && vPressure > 0.005) {
      // 直接使用原始归一化值作为热力图输入，不做任何放大
      vec3 heatColor = getHeatmapColor(vPressure);
      float blendFactor = smoothstep(0.0, 0.02, vPressure);
      surfaceColor = mix(surfaceColor, heatColor, blendFactor);
  }

  vec3 finalColor = (ambient + diffuse) * surfaceColor + specular;
  gl_FragColor = vec4(finalColor, 1.0);
}
`;
