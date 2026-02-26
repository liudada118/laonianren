import React, { useRef, useEffect, useMemo } from 'react';

/* ─── Jet 色谱映射 ─── */
function jetColor(t) {
  // t: 0~1 → 蓝→青→绿→黄→红
  t = Math.max(0, Math.min(1, t));
  let r, g, b;
  if (t < 0.125) { r = 0; g = 0; b = 128 + t / 0.125 * 127; }
  else if (t < 0.375) { r = 0; g = (t - 0.125) / 0.25 * 255; b = 255; }
  else if (t < 0.625) { r = (t - 0.375) / 0.25 * 255; g = 255; b = 255 - (t - 0.375) / 0.25 * 255; }
  else if (t < 0.875) { r = 255; g = 255 - (t - 0.625) / 0.25 * 255; b = 0; }
  else { r = 255 - (t - 0.875) / 0.125 * 127; g = 0; b = 0; }
  return [Math.round(r), Math.round(g), Math.round(b)];
}

/* ─── 生成足印形状的压力矩阵 ─── */
function generateFootprintMatrix(rows, cols, isLeft, intensity = 1.0) {
  const matrix = Array.from({ length: rows }, () => new Float32Array(cols));
  // 足印中心和尺寸
  const cx = cols / 2, cy = rows / 2;
  const footW = cols * 0.6, footH = rows * 0.85;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const ny = (y - cy) / (footH / 2);
      const nx = (x - cx) / (footW / 2);
      // 足印椭圆形状
      const footShape = nx * nx + ny * ny;
      if (footShape > 1.0) continue;

      // 足弓凹陷（中间区域压力较低）
      const archFactor = Math.abs(ny) < 0.3 ? 0.3 + Math.abs(nx) * 0.5 : 1.0;
      // 前足和后跟压力较大
      const heelFactor = ny > 0.3 ? 1.2 : 1.0;
      const toeFactor = ny < -0.5 ? 1.1 : 1.0;

      let val = (1 - footShape * 0.5) * archFactor * heelFactor * toeFactor * intensity;
      val += (Math.random() - 0.5) * 0.1;
      matrix[y][x] = Math.max(0, Math.min(1, val));
    }
  }

  // 添加脚趾
  const toePositions = isLeft
    ? [[-0.42, -0.15], [-0.42, 0.0], [-0.42, 0.15], [-0.40, 0.28], [-0.36, 0.38]]
    : [[-0.42, 0.15], [-0.42, 0.0], [-0.42, -0.15], [-0.40, -0.28], [-0.36, -0.38]];
  const toeRadii = [0.06, 0.07, 0.06, 0.05, 0.04];

  toePositions.forEach(([ty, tx], i) => {
    const tcx = cx + tx * footW;
    const tcy = cy + ty * footH;
    const tr = toeRadii[i] * Math.min(rows, cols);
    for (let y = Math.max(0, Math.floor(tcy - tr)); y < Math.min(rows, Math.ceil(tcy + tr)); y++) {
      for (let x = Math.max(0, Math.floor(tcx - tr)); x < Math.min(cols, Math.ceil(tcx + tr)); x++) {
        const d = Math.sqrt((x - tcx) ** 2 + (y - tcy) ** 2);
        if (d < tr) {
          matrix[y][x] = Math.max(matrix[y][x], (1 - d / tr) * 0.7 * intensity);
        }
      }
    }
  });

  return matrix;
}

/* ─── 渲染热力图到Canvas ─── */
function renderHeatmapToCanvas(ctx, matrix, x, y, w, h, maxVal = 1.0, bgBlack = true) {
  const rows = matrix.length, cols = matrix[0].length;
  const imgData = ctx.createImageData(cols, rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = (r * cols + c) * 4;
      const val = matrix[r][c] / maxVal;
      if (val < 0.02) {
        if (bgBlack) { imgData.data[idx] = 0; imgData.data[idx + 1] = 0; imgData.data[idx + 2] = 0; }
        else { imgData.data[idx] = 255; imgData.data[idx + 1] = 255; imgData.data[idx + 2] = 255; }
        imgData.data[idx + 3] = bgBlack ? 255 : 0;
      } else {
        const [cr, cg, cb] = jetColor(val);
        imgData.data[idx] = cr; imgData.data[idx + 1] = cg; imgData.data[idx + 2] = cb; imgData.data[idx + 3] = 255;
      }
    }
  }
  // 使用临时canvas缩放
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = cols; tmpCanvas.height = rows;
  tmpCanvas.getContext('2d').putImageData(imgData, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tmpCanvas, x, y, w, h);
}

/* ═══════════════════════════════════════════════════════════════
   1. 足印热力图 (Footprint Heatmap with FPA Analysis)
   ═══════════════════════════════════════════════════════════════ */
export function FootprintHeatmapCanvas({ leftSteps, rightSteps, width = 400, height = 700 }) {
  const canvasRef = useRef(null);
  const stepsData = useMemo(() => {
    // 生成每步的足印数据
    const allSteps = [];
    const totalSteps = leftSteps.length + rightSteps.length;
    let li = 0, ri = 0;
    const stepW = 40, stepH = 60;

    for (let i = 0; i < totalSteps; i++) {
      const isLeft = i % 2 === 0 && li < leftSteps.length;
      if (isLeft || ri >= rightSteps.length) {
        allSteps.push({
          side: 'left',
          fpa: leftSteps[li],
          matrix: generateFootprintMatrix(stepH, stepW, true, 0.3 + Math.random() * 0.7),
          x: width * 0.25,
          y: height - 80 - i * (height - 120) / totalSteps,
        });
        li++;
      } else {
        allSteps.push({
          side: 'right',
          fpa: rightSteps[ri],
          matrix: generateFootprintMatrix(stepH, stepW, false, 0.3 + Math.random() * 0.7),
          x: width * 0.55,
          y: height - 80 - i * (height - 120) / totalSteps,
        });
        ri++;
      }
    }
    return allSteps;
  }, [leftSteps, rightSteps, width, height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // 白色背景
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    // 标题
    ctx.fillStyle = '#1A2332';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Footprint Heatmap with FPA Analysis', width / 2, 24);

    // 边框
    ctx.strokeStyle = '#D0D5DD';
    ctx.lineWidth = 1;
    ctx.strokeRect(30, 35, width - 60, height - 55);

    // 绘制每步足印
    const footW = 55, footH = 75;
    stepsData.forEach(step => {
      renderHeatmapToCanvas(ctx, step.matrix, step.x - footW / 2, step.y - footH / 2, footW, footH, 1.0, true);

      // FPA角度标注
      ctx.fillStyle = '#888888';
      ctx.fillRect(step.x + footW / 2 + 5, step.y - 8, 42, 16);
      ctx.fillStyle = '#FFFF00';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${step.fpa}°`, step.x + footW / 2 + 9, step.y + 4);

      // FPA参考线（虚线）
      ctx.save();
      ctx.translate(step.x, step.y);
      ctx.rotate(-step.fpa * Math.PI / 180 * (step.side === 'left' ? 1 : -1));
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -footH / 2 - 5);
      ctx.lineTo(0, footH / 2 + 5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    });

    // 色条
    const barX = width - 45, barY = 50, barW = 18, barH = height - 120;
    for (let i = 0; i < barH; i++) {
      const t = 1 - i / barH;
      const [r, g, b] = jetColor(t);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(barX, barY + i, barW, 1);
    }
    ctx.strokeStyle = '#D0D5DD';
    ctx.strokeRect(barX, barY, barW, barH);

    // 色条标签
    ctx.fillStyle = '#6B7B8D';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    const maxPressure = 4000;
    for (let i = 0; i <= 4; i++) {
      const val = Math.round(maxPressure * (1 - i / 4));
      const yy = barY + i * barH / 4;
      ctx.fillText(`${val}`, barX + barW + 4, yy + 3);
    }
    ctx.save();
    ctx.translate(barX + barW + 35, barY + barH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#6B7B8D';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Accumulated Pressure / FPA Analysis', 0, 0);
    ctx.restore();

  }, [stepsData, width, height]);

  return (
    <canvas ref={canvasRef} style={{ width, height, borderRadius: 8 }} />
  );
}

/* ═══════════════════════════════════════════════════════════════
   2. 压力演变图 (Foot Pressure Evolution)
   ═══════════════════════════════════════════════════════════════ */
export function PressureEvolutionCanvas({ side = 'left', width = 800, height = 200 }) {
  const canvasRef = useRef(null);
  const frames = useMemo(() => {
    // 生成10个关键帧的压力矩阵
    const keyFrames = [0, 0.08, 0.12, 0.16, 0.4, 0.6, 0.75, 0.85, 0.92, 1.0];
    const labels = ['Start', '80ms', '120ms', '160ms', '', 'Peak', '', '', '', 'End'];
    const isLeft = side === 'left';
    return keyFrames.map((t, i) => {
      // 压力强度随步态周期变化
      let intensity;
      if (t < 0.1) intensity = 0.2 + t * 3;
      else if (t < 0.6) intensity = 0.5 + (t - 0.1) * 1.0;
      else if (t < 0.85) intensity = 1.0 - (t - 0.6) * 0.5;
      else intensity = 0.75 - (t - 0.85) * 3;
      intensity = Math.max(0.1, Math.min(1.0, intensity));

      return {
        matrix: generateFootprintMatrix(48, 32, isLeft, intensity),
        label: labels[i] || `${Math.round(t * 2000)}ms`,
        isPeak: t === 0.6,
      };
    });
  }, [side]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // 黑色背景
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // 标签
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(side === 'left' ? 'Left Foot' : 'Right Foot', 10, 85);

    // 绘制每帧
    const frameW = 55, frameH = 75;
    const startX = 90, gap = (width - startX - 20) / frames.length;

    frames.forEach((frame, i) => {
      const fx = startX + i * gap;
      const fy = 45;

      // 帧标签
      ctx.fillStyle = frame.isPeak ? '#FF4444' : '#AAAAAA';
      ctx.font = frame.isPeak ? 'bold 9px sans-serif' : '9px sans-serif';
      ctx.textAlign = 'center';
      if (frame.isPeak) {
        ctx.fillText('Peak', fx + frameW / 2, fy - 15);
      }
      ctx.fillText(frame.label, fx + frameW / 2, fy - 4);

      // 渲染热力图帧
      renderHeatmapToCanvas(ctx, frame.matrix, fx, fy, frameW, frameH, 1.0, true);
    });
  }, [frames, side, width, height]);

  return <canvas ref={canvasRef} style={{ width, height, borderRadius: 4 }} />;
}

/* ═══════════════════════════════════════════════════════════════
   3. 平均步态热力图 (Gait Average Summary)
   ═══════════════════════════════════════════════════════════════ */
export function GaitAverageSummaryCanvas({ leftStepCount = 3, rightStepCount = 4, width = 500, height = 280 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // 黑色背景
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // 标题
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Gait Average Summary (Smoothed)', width / 2, 20);

    // 左脚平均
    const leftMatrix = generateFootprintMatrix(80, 50, true, 0.85);
    const lx = width * 0.25 - 50, ly = 55;
    renderHeatmapToCanvas(ctx, leftMatrix, lx, ly, 100, 180, 1.0, true);

    // 左脚标签
    ctx.fillStyle = '#CCCCCC';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Left Foot Average`, width * 0.25, 45);
    ctx.fillText(`(n=${leftStepCount} steps)`, width * 0.25, ly + 195);

    // COP轨迹 (白色曲线)
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const copPoints = 20;
    for (let i = 0; i < copPoints; i++) {
      const t = i / (copPoints - 1);
      const cx = lx + 50 + Math.sin(t * 3) * 8 + (Math.random() - 0.5) * 4;
      const cy = ly + 170 - t * 160;
      if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    // COP起止点
    ctx.fillStyle = '#00FF00';
    ctx.beginPath(); ctx.arc(lx + 50, ly + 170, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FF0000';
    ctx.beginPath(); ctx.arc(lx + 50 + Math.sin(3) * 8, ly + 10, 3, 0, Math.PI * 2); ctx.fill();

    // 右脚平均
    const rightMatrix = generateFootprintMatrix(80, 50, false, 0.85);
    const rx = width * 0.75 - 50, ry = 55;
    renderHeatmapToCanvas(ctx, rightMatrix, rx, ry, 100, 180, 1.0, true);

    // 右脚标签
    ctx.fillStyle = '#CCCCCC';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Right Foot Average`, width * 0.75, 45);
    ctx.fillText(`(n=${rightStepCount} steps)`, width * 0.75, ry + 195);

    // COP轨迹
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < copPoints; i++) {
      const t = i / (copPoints - 1);
      const cx = rx + 50 + Math.sin(t * 2.8) * 10 + (Math.random() - 0.5) * 5;
      const cy = ry + 170 - t * 160;
      if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.fillStyle = '#00FF00';
    ctx.beginPath(); ctx.arc(rx + 50, ry + 170, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FF0000';
    ctx.beginPath(); ctx.arc(rx + 50 + Math.sin(2.8) * 10, ry + 10, 3, 0, Math.PI * 2); ctx.fill();

  }, [leftStepCount, rightStepCount, width, height]);

  return <canvas ref={canvasRef} style={{ width, height, borderRadius: 8 }} />;
}

/* ═══════════════════════════════════════════════════════════════
   4. 分区压力特征散点图 (Pressure Regions S1-S6)
   ═══════════════════════════════════════════════════════════════ */
export function PressureRegionsScatterOption(side = 'left') {
  // 生成6个分区的散点数据
  const sectionColors = ['#E74C3C', '#1ABC9C', '#3498DB', '#E67E22', '#2ECC71', '#9B59B6'];
  const sectionNames = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];

  // 模拟传感器坐标点
  const baseX = side === 'left' ? 238 : 210;
  const baseY = side === 'left' ? 21 : 44;
  const xRange = 18, yRange = 8;

  const series = sectionNames.map((name, si) => {
    const count = 15 + Math.floor(Math.random() * 10);
    const data = [];
    // 每个分区的中心位置
    const sectionCenters = [
      { dx: -xRange * 0.7, dy: yRange * 0.3 },  // S1 - 后跟
      { dx: -xRange * 0.3, dy: -yRange * 0.2 },  // S2 - 中足
      { dx: 0, dy: yRange * 0.4 },                // S3 - 中前足
      { dx: xRange * 0.2, dy: 0 },                // S4 - 前足
      { dx: xRange * 0.5, dy: yRange * 0.3 },     // S5 - 前足外侧
      { dx: xRange * 0.7, dy: -yRange * 0.1 },    // S6 - 脚趾
    ];
    const center = sectionCenters[si];
    for (let i = 0; i < count; i++) {
      data.push([
        +(baseX + center.dx + (Math.random() - 0.5) * xRange * 0.4).toFixed(1),
        +(baseY + center.dy + (Math.random() - 0.5) * yRange * 0.5).toFixed(1),
      ]);
    }
    return {
      name, type: 'scatter', data,
      symbolSize: 8,
      itemStyle: { color: sectionColors[si], opacity: 0.8 },
    };
  });

  // Section分割线 (X Ratio 5:5:9:5)
  const totalRatio = 24;
  const xMin = baseX - xRange, xMax = baseX + xRange;
  const sectionBounds = [5, 10, 19, 24].map(r => xMin + (r / totalRatio) * (xMax - xMin) * 2);

  const markLines = {
    silent: true,
    symbol: 'none',
    lineStyle: { color: '#DC2626', type: 'dashed', width: 1 },
    label: { show: true, position: 'start', fontSize: 9, color: '#DC2626' },
    data: sectionBounds.slice(0, 3).map((x, i) => ({
      xAxis: x,
      label: { formatter: '' },
    })),
  };

  // Section标签
  const sectionLabels = ['Section 1\n(比例5)', 'Section 2\n(比例5)', 'Section 3\n(比例9)', 'Section 4\n(比例5)'];

  return {
    title: {
      text: `Pressure Regions S1-S6 Visualization\n(X Ratio: 5:5:9:5)`,
      left: 'center', top: 5,
      textStyle: { fontSize: 11, color: '#1A2332', lineHeight: 16 },
    },
    tooltip: {
      trigger: 'item',
      formatter: p => `${p.seriesName}: (${p.data[0]}, ${p.data[1]})`,
    },
    legend: {
      data: sectionNames, top: 45, textStyle: { fontSize: 9, color: '#6B7B8D' },
    },
    grid: { top: 80, bottom: 40, left: 55, right: 80 },
    xAxis: {
      type: 'value', name: 'X Coordinate',
      nameTextStyle: { color: '#6B7B8D', fontSize: 10 },
      axisLabel: { color: '#6B7B8D', fontSize: 9 },
      splitLine: { lineStyle: { color: '#EDF0F4' } },
    },
    yAxis: {
      type: 'value', name: 'Y Coordinate',
      nameTextStyle: { color: '#6B7B8D', fontSize: 10 },
      axisLabel: { color: '#6B7B8D', fontSize: 9 },
      splitLine: { lineStyle: { color: '#EDF0F4' } },
    },
    series: [
      ...series,
      // 添加markLine到第一个series
      { ...series[0], markLine: markLines },
    ].filter((_, i) => i !== 0 || true), // 保留所有
    // 右侧色条 (用graphic模拟)
    graphic: sectionNames.map((name, i) => ({
      type: 'rect',
      right: 10,
      top: 80 + i * 30,
      shape: { width: 20, height: 25 },
      style: { fill: sectionColors[i], opacity: 0.7 },
    })).concat(sectionNames.map((name, i) => ({
      type: 'text',
      right: 35,
      top: 85 + i * 30,
      style: { text: name, fill: '#6B7B8D', fontSize: 10, textAlign: 'right' },
    }))),
  };
}
