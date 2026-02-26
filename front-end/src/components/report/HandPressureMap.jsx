import React, { useRef, useEffect, useMemo } from 'react';

/**
 * HandPressureMap — 使用蓝色线框手背景图 + 动态热力叠加
 * 
 * 背景图: /assets/hand_wireframe.png (1143×2048)
 * 热力点: 根据传感器矩阵数据精确叠加到各手指和手掌区域
 * 颜色映射: 0-70N 蓝→红
 * 
 * 精确坐标来自图像分析:
 *   小指顶端: x=0.121, y=0.251
 *   无名指顶端: x=0.279, y=0.129
 *   中指顶端: x=0.455, y=0.081
 *   食指顶端: x=0.667, y=0.124
 *   拇指顶端: x=0.928, y=0.360
 *   手部蓝色区域: y 0.081-0.924, x 0.086-0.973
 */

// 手部各区域在图片中的归一化坐标 (0-1, 相对于图片尺寸)
// 图片中是左手（手掌面朝观察者），从左到右：小指、无名指、中指、食指，拇指在右侧
const HAND_REGIONS = {
  // 小指 - 图片左侧最外 (顶端 x=0.121, y=0.251)
  little_finger: {
    zones: [
      { cx: 0.122, cy: 0.270, rx: 0.030, ry: 0.025 },  // 指尖
      { cx: 0.135, cy: 0.315, rx: 0.028, ry: 0.025 },  // 指中
      { cx: 0.150, cy: 0.355, rx: 0.030, ry: 0.025 },  // 指根
    ],
    label: { x: 0.050, y: 0.290 },
    fingerIdx: 4,
  },
  // 无名指 (顶端 x=0.279, y=0.129)
  ring_finger: {
    zones: [
      { cx: 0.279, cy: 0.150, rx: 0.032, ry: 0.028 },  // 指尖
      { cx: 0.285, cy: 0.205, rx: 0.030, ry: 0.028 },  // 指中
      { cx: 0.295, cy: 0.265, rx: 0.032, ry: 0.030 },  // 指根
    ],
    label: { x: 0.210, y: 0.090 },
    fingerIdx: 3,
  },
  // 中指 (顶端 x=0.455, y=0.081)
  middle_finger: {
    zones: [
      { cx: 0.455, cy: 0.100, rx: 0.033, ry: 0.028 },  // 指尖
      { cx: 0.455, cy: 0.160, rx: 0.032, ry: 0.028 },  // 指中
      { cx: 0.450, cy: 0.230, rx: 0.035, ry: 0.030 },  // 指根
    ],
    label: { x: 0.430, y: 0.050 },
    fingerIdx: 2,
  },
  // 食指 (顶端 x=0.667, y=0.124)
  index_finger: {
    zones: [
      { cx: 0.660, cy: 0.145, rx: 0.032, ry: 0.028 },  // 指尖
      { cx: 0.655, cy: 0.205, rx: 0.030, ry: 0.028 },  // 指中
      { cx: 0.645, cy: 0.270, rx: 0.033, ry: 0.030 },  // 指根
    ],
    label: { x: 0.620, y: 0.090 },
    fingerIdx: 1,
  },
  // 拇指 - 图片右侧 (顶端 x=0.928, y=0.360)
  thumb: {
    zones: [
      { cx: 0.920, cy: 0.385, rx: 0.035, ry: 0.030 },  // 指尖
      { cx: 0.880, cy: 0.430, rx: 0.035, ry: 0.030 },  // 指中
      { cx: 0.830, cy: 0.480, rx: 0.038, ry: 0.032 },  // 指根
    ],
    label: { x: 0.920, y: 0.340 },
    fingerIdx: 0,
  },
  // 手掌 - 中心大区域 (大约 y=0.35-0.65, x=0.15-0.75)
  palm: {
    zones: [
      { cx: 0.380, cy: 0.380, rx: 0.080, ry: 0.040 },  // 上掌（指根连接处）
      { cx: 0.450, cy: 0.440, rx: 0.100, ry: 0.050 },  // 中掌
      { cx: 0.430, cy: 0.520, rx: 0.090, ry: 0.045 },  // 下掌
      { cx: 0.560, cy: 0.400, rx: 0.060, ry: 0.040 },  // 右上掌
      { cx: 0.530, cy: 0.500, rx: 0.070, ry: 0.045 },  // 右中掌
    ],
    label: { x: 0.430, y: 0.490 },
    fingerIdx: 5,
  },
};

// 传感器矩阵区域映射（16×16矩阵中各手指对应的行列范围）
const SENSOR_REGIONS = {
  thumb:         { rows: [6, 10], cols: [12, 15] },
  index_finger:  { rows: [0, 4],  cols: [0, 3] },
  middle_finger: { rows: [0, 4],  cols: [4, 7] },
  ring_finger:   { rows: [0, 4],  cols: [8, 11] },
  little_finger: { rows: [0, 4],  cols: [12, 15] },
  palm:          { rows: [4, 12], cols: [0, 11] },
};

// 颜色映射：0-70N → 蓝→青→绿→黄→红
const FORCE_MAX = 70; // 最大力值映射

function forceToColor(forceN, alpha = 0.6) {
  const v = Math.max(0, Math.min(1, forceN / FORCE_MAX));
  if (v < 0.005) return `rgba(0,0,0,0)`;
  
  let r, g, b;
  if (v < 0.25) {
    // 蓝 → 青
    const t = v / 0.25;
    r = 0;
    g = Math.round(t * 200);
    b = 255;
  } else if (v < 0.50) {
    // 青 → 绿
    const t = (v - 0.25) / 0.25;
    r = 0;
    g = 200 + Math.round(t * 55);
    b = Math.round(255 * (1 - t));
  } else if (v < 0.75) {
    // 绿 → 黄
    const t = (v - 0.50) / 0.25;
    r = Math.round(t * 255);
    g = 255;
    b = 0;
  } else {
    // 黄 → 红
    const t = (v - 0.75) / 0.25;
    r = 255;
    g = Math.round(255 * (1 - t));
    b = 0;
  }
  return `rgba(${r},${g},${b},${alpha})`;
}

// 归一化值到颜色（用于色标）
function normalizedToColor(v, alpha = 0.9) {
  v = Math.max(0, Math.min(1, v));
  let r, g, b;
  if (v < 0.25) {
    const t = v / 0.25;
    r = 0; g = Math.round(t * 200); b = 255;
  } else if (v < 0.50) {
    const t = (v - 0.25) / 0.25;
    r = 0; g = 200 + Math.round(t * 55); b = Math.round(255 * (1 - t));
  } else if (v < 0.75) {
    const t = (v - 0.50) / 0.25;
    r = Math.round(t * 255); g = 255; b = 0;
  } else {
    const t = (v - 0.75) / 0.25;
    r = 255; g = Math.round(255 * (1 - t)); b = 0;
  }
  return `rgba(${r},${g},${b},${alpha})`;
}

export default function HandPressureMap({ fingers = [], totalForce = 0, hand = '左手', sensorMatrix = null }) {
  const canvasRef = useRef(null);

  // 计算各区域的力值（N）
  const regionForces = useMemo(() => {
    const result = {};
    if (fingers.length > 0) {
      const regionKeys = Object.keys(HAND_REGIONS);
      for (const key of regionKeys) {
        const region = HAND_REGIONS[key];
        const f = fingers[region.fingerIdx];
        result[key] = f ? (f.force || 0) : 0;
      }
    }
    return result;
  }, [fingers]);

  // 计算传感器矩阵各区域的平均值
  const sensorRegionAvg = useMemo(() => {
    if (!sensorMatrix || sensorMatrix.length < 256) return null;
    const result = {};
    for (const [key, region] of Object.entries(SENSOR_REGIONS)) {
      let sum = 0, count = 0;
      for (let r = region.rows[0]; r <= region.rows[1]; r++) {
        for (let c = region.cols[0]; c <= region.cols[1]; c++) {
          const idx = r * 16 + c;
          sum += sensorMatrix[idx] || 0;
          count++;
        }
      }
      result[key] = count > 0 ? sum / count : 0;
    }
    return result;
  }, [sensorMatrix]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = '/assets/hand_wireframe.png';

    img.onload = () => {
      const dpr = window.devicePixelRatio || 1;
      const displayW = 420;
      const displayH = Math.round(displayW * (img.height / img.width));
      canvas.width = displayW * dpr;
      canvas.height = displayH * dpr;
      canvas.style.width = `${displayW}px`;
      canvas.style.height = `${displayH}px`;

      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, displayW, displayH);

      // 1. 绘制热力层
      drawHeatmap(ctx, displayW, displayH);

      // 2. 绘制背景图（线框手叠加在热力层上）
      ctx.globalAlpha = 0.80;
      ctx.drawImage(img, 0, 0, displayW, displayH);
      ctx.globalAlpha = 1.0;

      // 3. 绘制数据标注
      drawLabels(ctx, displayW, displayH);

      // 4. 绘制色标
      drawColorBar(ctx, displayW, displayH);
    };

    function drawHeatmap(ctx, W, H) {
      const regionKeys = Object.keys(HAND_REGIONS);

      for (const key of regionKeys) {
        const region = HAND_REGIONS[key];
        
        // 获取该区域的力值（N）
        let forceN = 0;
        if (regionForces[key] !== undefined) {
          forceN = regionForces[key];
        }

        if (forceN < 0.1) continue;

        // 颜色直接基于区域总力值（不除以zone数量）
        // 这样 90N 的手掌会显示为深红色
        const colorForce = forceN;

        // 在每个 zone 绘制高斯热力点
        for (const zone of region.zones) {
          const cx = zone.cx * W;
          const cy = zone.cy * H;
          const rx = zone.rx * W;
          const ry = zone.ry * H;
          const radius = Math.max(rx, ry) * 2.5;

          // 多层渐变叠加，颜色基于区域总力值
          for (let layer = 0; layer < 3; layer++) {
            const layerRadius = radius * (1 - layer * 0.15);

            const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, layerRadius);
            gradient.addColorStop(0, forceToColor(colorForce, 0.70));
            gradient.addColorStop(0.30, forceToColor(colorForce, 0.55));
            gradient.addColorStop(0.60, forceToColor(colorForce * 0.7, 0.30));
            gradient.addColorStop(1, 'rgba(0,0,0,0)');

            ctx.save();
            ctx.translate(cx, cy);
            ctx.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
            ctx.translate(-cx, -cy);
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(cx, cy, layerRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }
    }

    function drawLabels(ctx, W, H) {
      if (!fingers || fingers.length === 0) return;

      const regionKeys = Object.keys(HAND_REGIONS);
      for (const key of regionKeys) {
        const region = HAND_REGIONS[key];
        const f = fingers[region.fingerIdx];
        if (!f) continue;

        const lx = region.label.x * W;
        const ly = region.label.y * H;

        const name = f.name;
        const force = `${f.force}N`;

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // 背景圆角矩形
        const boxW = key === 'palm' ? 78 : 66;
        const boxH = 38;
        const bx = lx - boxW / 2;
        const by = ly - boxH / 2;

        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.strokeStyle = 'rgba(0,80,180,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(bx, by, boxW, boxH, 6);
        ctx.fill();
        ctx.stroke();

        // 名称
        ctx.fillStyle = '#334155';
        ctx.font = 'bold 11px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillText(name, lx, ly - 8);

        // 力值 — 根据力值大小着色
        const forceVal = f.force || 0;
        const ratio = Math.min(forceVal / FORCE_MAX, 1);
        // 蓝→红的文字颜色
        const textR = Math.round(ratio * 220);
        const textB = Math.round((1 - ratio) * 200);
        ctx.fillStyle = `rgb(${textR}, 40, ${textB})`;
        ctx.font = 'bold 14px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillText(force, lx, ly + 10);
      }
    }

    function drawColorBar(ctx, W, H) {
      const barW = W * 0.45;
      const barH = 10;
      const barX = (W - barW) / 2;
      const barY = H - 32;

      // 渐变色条
      const steps = 200;
      for (let i = 0; i < steps; i++) {
        const v = i / steps;
        ctx.fillStyle = normalizedToColor(v, 0.9);
        ctx.fillRect(barX + (barW * i / steps), barY, barW / steps + 1, barH);
      }

      ctx.strokeStyle = '#ccc';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(barX, barY, barW, barH);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('压力 (N)', W / 2, barY - 16);
      ctx.textAlign = 'left';
      ctx.fillText('0', barX, barY + barH + 4);
      ctx.textAlign = 'right';
      ctx.fillText(`${FORCE_MAX}`, barX + barW, barY + barH + 4);
    }
  }, [fingers, totalForce, hand, sensorMatrix, regionForces, sensorRegionAvg]);

  return (
    <div style={{
      background: '#fafbfc',
      borderRadius: 12,
      border: '1px solid #e2e8f0',
      padding: '12px 8px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        textAlign: 'center',
        color: '#64748b',
        fontSize: 13,
        marginBottom: 6,
        fontWeight: 500,
        letterSpacing: '0.5px',
      }}>
        {hand} · 力分布
      </div>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          display: 'block',
          margin: '0 auto',
        }}
      />
    </div>
  );
}
