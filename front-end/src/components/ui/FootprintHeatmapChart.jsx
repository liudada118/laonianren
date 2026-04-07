import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { JET_LUT } from './heatmapUtils';

function calcP95(data) {
  const vals = [];
  for (const row of data) {
    for (const v of row) {
      if (v > 0) vals.push(v);
    }
  }
  if (vals.length === 0) return 1;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length * 0.95)] || vals[vals.length - 1] || 1;
}

export default function FootprintHeatmapChart({ heatmapData, className = '' }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const metaRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const labeledFpaLines = useMemo(() => {
    const source = Array.isArray(heatmapData?.fpaLines) ? [...heatmapData.fpaLines] : [];
    source.sort((a, b) => (a?.frameIndex ?? 0) - (b?.frameIndex ?? 0));
    return source.map((line) => {
      const footText = line?.isRight ? '右脚' : '左脚';
      const angleVal = Number(line?.angle ?? 0);
      const angleText = line?.angleLabel || (Number.isFinite(angleVal) ? `足偏角：${angleVal.toFixed(1)}°` : '足偏角：0.0°');
      return {
        ...line,
        footText,
        angleText,
      };
    });
  }, [heatmapData]);

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
    if (!heatmapData?.heatmap || !canvasRef.current || containerWidth < 100) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { heatmap, size } = heatmapData;
    const fpaLines = labeledFpaLines;

    const H = size?.[0] || heatmap.length;
    const W = size?.[1] || heatmap[0]?.length || 1;
    const vmax = calcP95(heatmap);
    const threshold = vmax * 0.02;

    const PAD = 16;
    const totalW = containerWidth;
    const MAX_CHART_W = 150;
    const chartW = Math.min(MAX_CHART_W, totalW - PAD * 2);
    const aspect = H / W;
    const chartH = Math.max(200, Math.round(chartW * aspect));
    const totalH = chartH + PAD * 2;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = totalW * dpr;
    canvas.height = totalH * dpr;
    canvas.style.width = `${totalW}px`;
    canvas.style.height = `${totalH}px`;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#FAFAFA';
    ctx.fillRect(0, 0, totalW, totalH);

    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const offCtx = off.getContext('2d');
    const imgData = offCtx.createImageData(W, H);
    const px = imgData.data;

    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const v = heatmap[r]?.[c] || 0;
        const idx = (r * W + c) * 4;
        if (v <= threshold) {
          px[idx] = 250;
          px[idx + 1] = 250;
          px[idx + 2] = 250;
          px[idx + 3] = 255;
        } else {
          const norm = Math.min(1, v / (vmax * 0.8));
          const li = Math.round(norm * 255) * 4;
          px[idx] = JET_LUT[li];
          px[idx + 1] = JET_LUT[li + 1];
          px[idx + 2] = JET_LUT[li + 2];
          px[idx + 3] = 255;
        }
      }
    }
    offCtx.putImageData(imgData, 0, 0);

    const srcAsp = H / W;
    const dstAsp = chartH / chartW;
    let drawW;
    let drawH;
    if (srcAsp > dstAsp) {
      drawH = chartH;
      drawW = chartH / srcAsp;
    } else {
      drawW = chartW;
      drawH = chartW * srcAsp;
    }
    const offX = (totalW - drawW) / 2;
    const offY = PAD + (chartH - drawH) / 2;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, offX, offY, drawW, drawH);

    const pxPerCol = drawW / W;
    const pxPerRow = drawH / H;

    fpaLines.forEach(line => {
      const { heel, fore, angle, isRight, footText, angleText } = line;
      if (!heel || !fore) return;

      const hx = heel[0] * pxPerCol + offX;
      const hy = heel[1] * pxPerRow + offY;
      const fx = fore[0] * pxPerCol + offX;
      const fy = fore[1] * pxPerRow + offY;

      const vecX = fx - hx;
      const vecY = fy - hy;
      const plotFx = fx + vecX * 0.3;
      const plotFy = fy + vecY * 0.3;

      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(plotFx, plotFy);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(plotFx, plotFy);
      ctx.strokeStyle = isRight ? '#F59E0B' : '#3B82F6';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const footLen = Math.sqrt(vecX * vecX + vecY * vecY);
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx, hy - footLen * 1.1);
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(hx, hy, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();

      const titleText = footText || (isRight ? '右脚' : '左脚');
      const valueText = angleText || `足偏角：${Number(angle || 0).toFixed(1)}°`;
      ctx.font = 'bold 9px sans-serif';
      const titleMetrics = ctx.measureText(titleText);
      ctx.font = 'bold 10px sans-serif';
      const valueMetrics = ctx.measureText(valueText);

      const pillW = Math.max(titleMetrics.width, valueMetrics.width) + 12;
      const pillH = 28;
      const pillX = fx + (isRight ? 6 : -6 - pillW);
      const pillY = fy - pillH / 2;

      ctx.beginPath();
      ctx.roundRect(pillX, pillY, pillW, pillH, 8);
      ctx.fillStyle = isRight ? 'rgba(245,158,11,0.9)' : 'rgba(59,130,246,0.9)';
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(titleText, pillX + pillW / 2, pillY + 5);
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(valueText, pillX + pillW / 2, pillY + 15);
    });

    const rawHm = heatmapData.rawHeatmap || heatmap;
    metaRef.current = {
      offX,
      offY,
      drawW,
      drawH,
      rawH: rawHm.length,
      rawW: rawHm[0].length,
      rawHeatmap: rawHm,
    };
  }, [heatmapData, containerWidth, labeledFpaLines]);

  const handleMouseMove = useCallback((e) => {
    if (!metaRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const m = metaRef.current;

    if (mx >= m.offX && mx < m.offX + m.drawW && my >= m.offY && my < m.offY + m.drawH) {
      const r = Math.floor(((my - m.offY) / m.drawH) * m.rawH);
      const c = Math.floor(((mx - m.offX) / m.drawW) * m.rawW);
      if (r >= 0 && r < m.rawH && c >= 0 && c < m.rawW) {
        const v = m.rawHeatmap[r]?.[c] || 0;
        if (v > 0) {
          setTooltip({ x: e.clientX, y: e.clientY, text: `${v.toFixed(1)} N` });
          return;
        }
      }
    }
    setTooltip(null);
  }, []);

  if (!heatmapData?.heatmap) return null;

  return (
    <div ref={containerRef} className={`relative ${className}`} style={{ width: '100%', maxWidth: 420, margin: '0 auto' }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
        style={{ display: 'block', maxWidth: '100%', height: 'auto', cursor: 'crosshair' }}
      />
      {tooltip && (
        <div style={{
          position: 'fixed',
          left: tooltip.x + 12,
          top: tooltip.y - 8,
          background: 'rgba(0,0,0,0.85)',
          color: '#fff',
          padding: '4px 8px',
          borderRadius: 4,
          fontSize: 11,
          pointerEvents: 'none',
          zIndex: 999,
        }}>
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
