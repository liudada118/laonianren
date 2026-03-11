import React, { useRef, useEffect, useState, useCallback } from 'react';
import { JET_LUT } from './heatmapUtils';

/**
 * GaitAverageChart - 平均步态热力图 + COP轨迹
 * Canvas渲染，自适应容器宽度，hover显示压力值，COP白色轨迹线
 */

function calcVmax(heatmap) {
  if (!heatmap) return 1;
  const vals = [];
  for (const row of heatmap) for (const v of row) if (v > 0) vals.push(v);
  if (vals.length === 0) return 1;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length * 0.95)] || vals[vals.length - 1] || 1;
}

function renderHeatmap(ctx, data, vmax, x, y, w, h) {
  if (!data || data.length === 0) return;
  const rows = data.length;
  const cols = data[0].length;
  const off = document.createElement('canvas');
  off.width = cols;
  off.height = rows;
  const offCtx = off.getContext('2d');
  const imgData = offCtx.createImageData(cols, rows);
  const px = imgData.data;
  const threshold = vmax * 0.02;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = data[r][c];
      const idx = (r * cols + c) * 4;
      if (v <= threshold) {
        px[idx] = 12; px[idx + 1] = 12; px[idx + 2] = 20; px[idx + 3] = 255;
      } else {
        const norm = Math.min(1, v / (vmax * 0.8));
        const li = Math.round(norm * 255) * 4;
        px[idx] = JET_LUT[li]; px[idx + 1] = JET_LUT[li + 1]; px[idx + 2] = JET_LUT[li + 2]; px[idx + 3] = 255;
      }
    }
  }
  offCtx.putImageData(imgData, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, x, y, w, h);
}

export default function GaitAverageChart({ gaitAvgData, className = '' }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const metaRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // 监听容器宽度
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(containerRef.current);
    setContainerWidth(containerRef.current.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!gaitAvgData || !canvasRef.current || containerWidth < 100) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const sides = [
      { data: gaitAvgData.left, label: '左脚平均', color: '#3B82F6' },
      { data: gaitAvgData.right, label: '右脚平均', color: '#F59E0B' },
    ].filter(s => s.data?.heatmap);

    if (sides.length === 0) return;

    // 计算全局 vmax
    let globalVmax = 1;
    sides.forEach(s => { const v = calcVmax(s.data.heatmap); if (v > globalVmax) globalVmax = v; });

    const refHm = sides[0].data.heatmap;
    const srcH = refHm.length;
    const srcW = refHm[0].length;
    const aspect = srcH / srcW;

    const GAP = 24;
    const LABEL_H = 26;
    const PAD = 16;

    // 根据容器宽度自适应计算 FOOT_W
    const availW = containerWidth - PAD * 2 - (sides.length - 1) * GAP;
    const FOOT_W = Math.min(200, Math.floor(availW / sides.length));
    const FOOT_H = Math.round(FOOT_W * aspect);

    const totalW = PAD + sides.length * FOOT_W + (sides.length - 1) * GAP + PAD;
    const totalH = PAD + LABEL_H + FOOT_H + PAD;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = totalW * dpr;
    canvas.height = totalH * dpr;
    canvas.style.width = `${totalW}px`;
    canvas.style.height = `${totalH}px`;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#FAFAFA';
    ctx.fillRect(0, 0, totalW, totalH);

    const footMeta = [];

    sides.forEach((side, idx) => {
      const fx = PAD + idx * (FOOT_W + GAP);
      const fy = PAD + LABEL_H;
      const hm = side.data.heatmap;
      const hmH = hm.length;
      const hmW = hm[0].length;

      // 标签
      ctx.fillStyle = side.color;
      ctx.beginPath();
      ctx.arc(fx + 4, PAD + LABEL_H / 2, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1F2937';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(side.label, fx + 14, PAD + LABEL_H / 2);

      // 黑色背景
      ctx.fillStyle = '#111122';
      ctx.beginPath();
      ctx.roundRect(fx, fy, FOOT_W, FOOT_H, 4);
      ctx.fill();

      // 保持宽高比绘制
      const srcAsp = hmH / hmW;
      const dstAsp = FOOT_H / FOOT_W;
      let drawW, drawH;
      if (srcAsp > dstAsp) { drawH = FOOT_H; drawW = FOOT_H / srcAsp; }
      else { drawW = FOOT_W; drawH = FOOT_W * srcAsp; }
      const offX = fx + (FOOT_W - drawW) / 2;
      const offY = fy + (FOOT_H - drawH) / 2;

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(fx + 1, fy + 1, FOOT_W - 2, FOOT_H - 2, 3);
      ctx.clip();

      renderHeatmap(ctx, hm, globalVmax, offX, offY, drawW, drawH);

      // COP 轨迹
      const pxPerCol = drawW / hmW;
      const pxPerRow = drawH / hmH;
      (side.data.copTrajectories || []).forEach(trail => {
        if (!trail || trail.length < 2) return;

        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < trail.length; i++) {
          const px = offX + trail[i][1] * pxPerCol;
          const py = offY + trail[i][0] * pxPerRow;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // 起点 cyan
        const s = trail[0];
        ctx.beginPath();
        ctx.arc(offX + s[1] * pxPerCol, offY + s[0] * pxPerRow, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#00FFFF';
        ctx.fill();

        // 终点 red
        const e = trail[trail.length - 1];
        ctx.beginPath();
        ctx.arc(offX + e[1] * pxPerCol, offY + e[0] * pxPerRow, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#FF4444';
        ctx.fill();
      });

      ctx.restore();

      // tooltip用rawHeatmap（原始牛顿值），渲染用heatmap（插值平滑版）
      const rawHm = side.data.rawHeatmap || hm;
      footMeta.push({
        x: offX, y: offY, w: drawW, h: drawH,
        rawHeatmap: rawHm, rawH: rawHm.length, rawW: rawHm[0].length,
      });
    });

    metaRef.current = footMeta;
  }, [gaitAvgData, containerWidth]);

  const handleMouseMove = useCallback((e) => {
    if (!metaRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    for (const m of metaRef.current) {
      if (mx >= m.x && mx < m.x + m.w && my >= m.y && my < m.y + m.h) {
        const r = Math.floor((my - m.y) / m.h * m.rawH);
        const c = Math.floor((mx - m.x) / m.w * m.rawW);
        if (r >= 0 && r < m.rawH && c >= 0 && c < m.rawW) {
          const v = m.rawHeatmap[r][c];
          if (v > 0) {
            setTooltip({ x: e.clientX, y: e.clientY, text: `${v.toFixed(1)} N` });
            return;
          }
        }
      }
    }
    setTooltip(null);
  }, []);

  if (!gaitAvgData) return null;

  return (
    <div ref={containerRef} className={`relative ${className}`} style={{ width: '100%', maxWidth: 520, margin: '0 auto' }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
        style={{ display: 'block', maxWidth: '100%', height: 'auto', cursor: 'crosshair' }}
      />
      {tooltip && (
        <div style={{
          position: 'fixed', left: tooltip.x + 12, top: tooltip.y - 8,
          background: 'rgba(0,0,0,0.85)', color: '#fff', padding: '4px 8px',
          borderRadius: 4, fontSize: 11, pointerEvents: 'none', zIndex: 999,
        }}>
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
