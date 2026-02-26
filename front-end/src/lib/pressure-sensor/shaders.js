/**
 * 压力热力图 GLSL 着色器
 * 
 * 顶点着色器：顶点位移（凹陷效果）+ 5×5 高斯核实时平滑
 * 片元着色器：7段热力图色带 + Phong 光照 + 截面视图
 */

/** 压力垫顶点着色器 */
export const pressurePadVertexShader = `
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
    float texSize = 256.0;
    float offset = 1.0 / texSize;
    
    float p = texture2D(uPressureMap, uv).r;
    
    if (uSmoothness < 0.01) return p;
    
    float kernel[25];
    kernel[0] = 0.003765; kernel[1] = 0.015019; kernel[2] = 0.023792; kernel[3] = 0.015019; kernel[4] = 0.003765;
    kernel[5] = 0.015019; kernel[6] = 0.059912; kernel[7] = 0.094907; kernel[8] = 0.059912; kernel[9] = 0.015019;
    kernel[10] = 0.023792; kernel[11] = 0.094907; kernel[12] = 0.150342; kernel[13] = 0.094907; kernel[14] = 0.023792;
    kernel[15] = 0.015019; kernel[16] = 0.059912; kernel[17] = 0.094907; kernel[18] = 0.059912; kernel[19] = 0.015019;
    kernel[20] = 0.003765; kernel[21] = 0.015019; kernel[22] = 0.023792; kernel[23] = 0.015019; kernel[24] = 0.003765;
    
    float blurred = 0.0;
    int idx = 0;
    
    for (int dy = -2; dy <= 2; dy++) {
        for (int dx = -2; dx <= 2; dx++) {
            vec2 sampleUv = uv + vec2(float(dx) * offset, float(dy) * offset);
            blurred += texture2D(uPressureMap, sampleUv).r * kernel[idx];
            idx++;
        }
    }
    
    float smoothFactor = uSmoothness * 2.0;
    smoothFactor = clamp(smoothFactor, 0.0, 1.0);
    
    return mix(p, blurred, smoothFactor);
}

void main() {
  vUv = uv;
  vec3 objectNormal = normal;
  
  if (objectNormal.z > 0.5) {
      float pressure = getSmoothedPressure(uv);
      vPressure = pressure;
      
      vec3 newPosition = position;
      
      float maxDisplacement = uThickness * 0.85;
      float mappedPressure = pow(pressure, 0.7);
      float displacement = min(mappedPressure * uDisplacementScale, maxDisplacement);
      
      newPosition.z -= displacement;
      
      float texSize = 256.0;
      float offset = 2.0 / texSize;
      
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

/** 压力垫片元着色器（含截面视图支持） */
export const pressurePadFragmentShader = `
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
  t = smoothstep(0.0, 1.0, t);
  
  vec3 c0 = vec3(0.0, 0.0, 0.5);
  vec3 c1 = vec3(0.0, 0.5, 1.0);
  vec3 c2 = vec3(0.0, 1.0, 0.5);
  vec3 c3 = vec3(0.5, 1.0, 0.0);
  vec3 c4 = vec3(1.0, 0.8, 0.0);
  vec3 c5 = vec3(1.0, 0.3, 0.0);
  vec3 c6 = vec3(0.5, 0.0, 0.0);
  
  if (t < 0.167) return mix(c0, c1, t / 0.167);
  if (t < 0.333) return mix(c1, c2, (t - 0.167) / 0.166);
  if (t < 0.5)   return mix(c2, c3, (t - 0.333) / 0.167);
  if (t < 0.667) return mix(c3, c4, (t - 0.5) / 0.167);
  if (t < 0.833) return mix(c4, c5, (t - 0.667) / 0.166);
  return mix(c5, c6, (t - 0.833) / 0.167);
}

void main() {
  if (uEnableClipping && vUv.y < uClipLevel) discard;

  vec3 normal = normalize(vNormal);
  if (!gl_FrontFacing) normal = -normal;

  vec3 lightDir = normalize(vec3(0.5, 0.5, 1.0)); 
  
  vec3 ambient = vec3(0.35);
  float diff = max(dot(normal, lightDir), 0.0);
  vec3 diffuse = diff * vec3(0.65);
  
  vec3 viewDir = normalize(vViewPosition);
  vec3 reflectDir = reflect(-lightDir, normal);
  float spec = pow(max(dot(viewDir, reflectDir), 0.0), 64.0);
  vec3 specular = spec * vec3(0.15);

  vec3 surfaceColor = uBaseColor;
  
  if (!gl_FrontFacing) {
      surfaceColor = vec3(0.4, 0.4, 0.4);
  } else if (uShowHeatmap && vPressure > 0.005) {
      vec3 heatColor = getHeatmapColor(vPressure);
      float blendFactor = smoothstep(0.0, 0.1, vPressure) * 0.95;
      surfaceColor = mix(surfaceColor, heatColor, blendFactor);
  }

  if (uEnableClipping && abs(vUv.y - uClipLevel) < 0.005) {
      surfaceColor = vec3(1.0, 0.2, 0.2);
      ambient = vec3(1.0);
  }

  vec3 finalColor = (ambient + diffuse) * surfaceColor + specular;
  gl_FragColor = vec4(finalColor, 1.0);
}
`;

/** 脚垫片元着色器（无截面视图，简化版） */
export const footpadFragmentShader = `
varying vec2 vUv;
varying float vPressure;
varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec3 vWorldPosition;

uniform bool uShowHeatmap;
uniform vec3 uBaseColor;

vec3 getHeatmapColor(float t) {
  t = clamp(t, 0.0, 1.0);
  t = smoothstep(0.0, 1.0, t);
  
  vec3 c0 = vec3(0.0, 0.0, 0.5);
  vec3 c1 = vec3(0.0, 0.5, 1.0);
  vec3 c2 = vec3(0.0, 1.0, 0.5);
  vec3 c3 = vec3(0.5, 1.0, 0.0);
  vec3 c4 = vec3(1.0, 0.8, 0.0);
  vec3 c5 = vec3(1.0, 0.3, 0.0);
  vec3 c6 = vec3(0.5, 0.0, 0.0);
  
  if (t < 0.167) return mix(c0, c1, t / 0.167);
  if (t < 0.333) return mix(c1, c2, (t - 0.167) / 0.166);
  if (t < 0.5)   return mix(c2, c3, (t - 0.333) / 0.167);
  if (t < 0.667) return mix(c3, c4, (t - 0.5) / 0.167);
  if (t < 0.833) return mix(c4, c5, (t - 0.667) / 0.166);
  return mix(c5, c6, (t - 0.833) / 0.167);
}

void main() {
  vec3 normal = normalize(vNormal);
  if (!gl_FrontFacing) normal = -normal;

  vec3 lightDir = normalize(vec3(0.5, 0.5, 1.0)); 
  
  vec3 ambient = vec3(0.35);
  float diff = max(dot(normal, lightDir), 0.0);
  vec3 diffuse = diff * vec3(0.65);
  
  vec3 viewDir = normalize(vViewPosition);
  vec3 reflectDir = reflect(-lightDir, normal);
  float spec = pow(max(dot(viewDir, reflectDir), 0.0), 64.0);
  vec3 specular = spec * vec3(0.15);

  vec3 surfaceColor = uBaseColor;
  
  if (!gl_FrontFacing) {
      surfaceColor = vec3(0.4, 0.4, 0.4);
  } else if (uShowHeatmap && vPressure > 0.005) {
      vec3 heatColor = getHeatmapColor(vPressure);
      float blendFactor = smoothstep(0.0, 0.1, vPressure) * 0.95;
      surfaceColor = mix(surfaceColor, heatColor, blendFactor);
  }

  vec3 finalColor = (ambient + diffuse) * surfaceColor + specular;
  gl_FragColor = vec4(finalColor, 1.0);
}
`;
