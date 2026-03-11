import React, { useRef, useEffect, useState, useCallback } from 'react';
import { JET_LUT } from './heatmapUtils';

/**
 * PressureEvolutionChart - 足底压力演变（落地→离地）
 * 2行(左脚/右脚) × 10列，Canvas渲染，自适应容器宽度
 */

function renderFrame(ctx, data, vmax, x, y, w, h) {
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

export default function PressureEvolutionChart({ evolutionData, className = '' }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const layoutRef = useRef(null);
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
    if (!evolutionData || !canvasRef.current || containerWidth < 100) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const rowsData = [
      { data: evolutionData.left, label: '左脚', color: '#3B82F6' },
      { data: evolutionData.right, label: '右脚', color: '#F59E0B' },
    ];

    const numCols = 10;
    const GAP = 4;
    const LABEL_W = 36;
    const TITLE_H = 20;
    const PAD = 8;

    // 根据容器宽度计算 cell 尺寸
    const totalW = containerWidth;
    const availW = totalW - PAD * 2 - LABEL_W;
    const CELL_W = Math.floor((availW - GAP * (numCols - 1)) / numCols);
    const CELL_H = Math.round(CELL_W * 1.4);
    const totalH = PAD + rowsData.length * (CELL_H + TITLE_H + 12) + PAD;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = totalW * dpr;
    canvas.height = totalH * dpr;
    canvas.style.width = `${totalW}px`;
    canvas.style.height = `${totalH}px`;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#FAFAFA';
    ctx.fillRect(0, 0, totalW, totalH);

    const cells = [];

    rowsData.forEach((row, ri) => {
      const yBase = PAD + ri * (CELL_H + TITLE_H + 12);

      // 行标签
      ctx.fillStyle = row.color;
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(row.label, PAD + LABEL_W / 2, yBase + CELL_H / 2);

      if (!row.data?.frames) return;
      const vmax = row.data.vmax || 1;

      for (let ci = 0; ci < Math.min(row.data.frames.length, numCols); ci++) {
        const frame = row.data.frames[ci];
        const title = row.data.titles?.[ci] || '';
        const isPeak = title.includes('峰值');
        const cx = PAD + LABEL_W + ci * (CELL_W + GAP);
        const cy = yBase;

        // 背景
        ctx.fillStyle = '#111122';
        ctx.beginPath();
        ctx.roundRect(cx, cy, CELL_W, CELL_H, 3);
        ctx.fill();

        if (frame) {
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(cx + 1, cy + 1, CELL_W - 2, CELL_H - 2, 2);
          ctx.clip();
          renderFrame(ctx, frame, vmax, cx, cy, CELL_W, CELL_H);
          ctx.restore();

          // tooltip用rawFrame（原始牛顿值），渲染用frame（插值平滑版）
          const rawFrame = row.data.rawFrames?.[ci];
          cells.push({
            x: cx, y: cy, w: CELL_W, h: CELL_H,
            rawFrame: rawFrame || frame,
            rawRows: rawFrame ? rawFrame.length : frame.length,
            rawCols: rawFrame ? rawFrame[0].length : frame[0].length,
          });
        }

        // 峰值边框
        if (isPeak) {
          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(cx, cy, CELL_W, CELL_H, 3);
          ctx.stroke();
        }

        // 时间标签
        ctx.fillStyle = isPeak ? '#EF4444' : '#888';
        ctx.font = `${isPeak ? 'bold ' : ''}10px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const displayTitle = title.replace('峰值\n', '峰值 ').replace('落地\n', '落地 ').replace('离地\n', '离地 ');
        ctx.fillText(displayTitle, cx + CELL_W / 2, cy + CELL_H + 3);
      }
    });

    layoutRef.current = cells;
  }, [evolutionData, containerWidth]);

  const handleMouseMove = useCallback((e) => {
    if (!layoutRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    for (const cell of layoutRef.current) {
      if (mx >= cell.x && mx < cell.x + cell.w && my >= cell.y && my < cell.y + cell.h) {
        const localX = mx - cell.x;
        const localY = my - cell.y;
        const r = Math.floor(localY / cell.h * cell.rawRows);
        const c = Math.floor(localX / cell.w * cell.rawCols);
        if (r >= 0 && r < cell.rawRows && c >= 0 && c < cell.rawCols) {
          const v = cell.rawFrame[r][c];
          if (v > 0) {
            setTooltip({ x: e.clientX, y: e.clientY, text: `${v.toFixed(1)} N` });
            return;
          }
        }
      }
    }
    setTooltip(null);
  }, []);

  if (!evolutionData) return null;

  return (
    <div ref={containerRef} className={`relative ${className}`} style={{ width: '100%' }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
        style={{ display: 'block', cursor: 'crosshair' }}
      />
      {tooltip && (
        <div style={{
          position: 'fixed', left: tooltip.x + 12, top: tooltip.y - 8,
          background: 'rgba(0,0,0,0.85)', color: '#fff', padding: '4px 8px',
          borderRadius: 4, fontSize: 11, pointerEvents: 'none', zIndex: 999,
          whiteSpace: 'nowrap',
        }}>
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
