import React, { useRef, useEffect } from 'react';

/* ─── Jet 色谱映射 ─── */
function jetColor(t) {
  t = Math.max(0, Math.min(1, t));
  let r, g, b;
  if (t < 0.125) { r = 0; g = 0; b = 128 + t / 0.125 * 127; }
  else if (t < 0.375) { r = 0; g = (t - 0.125) / 0.25 * 255; b = 255; }
  else if (t < 0.625) { r = (t - 0.375) / 0.25 * 255; g = 255; b = 255 - (t - 0.375) / 0.25 * 255; }
  else if (t < 0.875) { r = 255; g = 255 - (t - 0.625) / 0.25 * 255; b = 0; }
  else { r = 255 - (t - 0.875) / 0.125 * 127; g = 0; b = 0; }
  return [Math.round(r), Math.round(g), Math.round(b)];
}

/* ─── 获取矩阵最大值 ─── */
function getMatrixMax(matrix) {
  let max = 0;
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < (matrix[r]?.length || 0); c++) {
      if (matrix[r][c] > max) max = matrix[r][c];
    }
  }
  return max;
}

/* ─── 简易高斯模糊（对二维数组做 NxN 均值模糊，多次迭代近似高斯） ─── */
function gaussianBlur2D(matrix, radius = 2, iterations = 2) {
  const rows = matrix.length;
  const cols = matrix[0]?.length || 0;
  if (rows === 0 || cols === 0) return matrix;

  let src = matrix.map(row => Float32Array.from(row));
  let dst = src.map(row => new Float32Array(row.length));

  for (let iter = 0; iter < iterations; iter++) {
    // 水平方向
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0, cnt = 0;
        for (let k = -radius; k <= radius; k++) {
          const cc = c + k;
          if (cc >= 0 && cc < cols) { sum += src[r][cc]; cnt++; }
        }
        dst[r][c] = sum / cnt;
      }
    }
    // 交换
    [src, dst] = [dst, src];
    // 垂直方向
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0, cnt = 0;
        for (let k = -radius; k <= radius; k++) {
          const rr = r + k;
          if (rr >= 0 && rr < rows) { sum += src[rr][c]; cnt++; }
        }
        dst[r][c] = sum / cnt;
      }
    }
    [src, dst] = [dst, src];
  }
  return src;
}

/* ─── 上采样矩阵（双线性插值放大） ─── */
function upsampleMatrix(matrix, scale = 4) {
  const rows = matrix.length;
  const cols = matrix[0]?.length || 0;
  if (rows === 0 || cols === 0) return matrix;
  const newRows = rows * scale;
  const newCols = cols * scale;
  const result = [];
  for (let r = 0; r < newRows; r++) {
    const row = new Float32Array(newCols);
    const srcR = r / scale;
    const r0 = Math.floor(srcR);
    const r1 = Math.min(r0 + 1, rows - 1);
    const fr = srcR - r0;
    for (let c = 0; c < newCols; c++) {
      const srcC = c / scale;
      const c0 = Math.floor(srcC);
      const c1 = Math.min(c0 + 1, cols - 1);
      const fc = srcC - c0;
      row[c] = (1 - fr) * (1 - fc) * matrix[r0][c0]
             + (1 - fr) * fc * matrix[r0][c1]
             + fr * (1 - fc) * matrix[r1][c0]
             + fr * fc * matrix[r1][c1];
    }
    result.push(row);
  }
  return result;
}

/* ─── 渲染平滑热力图到Canvas指定区域 ─── */
function drawSmoothHeatmap(ctx, matrix, x, y, w, h, maxVal, bgBlack = true) {
  if (!matrix || matrix.length === 0) return;
  const rows = matrix.length;
  const cols = matrix[0]?.length || 0;
  if (cols === 0) return;

  // 上采样 + 高斯模糊实现平滑效果（8x上采样 + 4次迭代模糊）
  const scale = 8;
  const upsampled = upsampleMatrix(matrix, scale);
  const blurred = gaussianBlur2D(upsampled, 4, 4);

  const bRows = blurred.length;
  const bCols = blurred[0]?.length || 0;

  // 生成 ImageData
  const imgData = ctx.createImageData(bCols, bRows);
  for (let r = 0; r < bRows; r++) {
    for (let c = 0; c < bCols; c++) {
      const idx = (r * bCols + c) * 4;
      const val = maxVal > 0 ? blurred[r][c] / maxVal : 0;
      if (val < 0.015) {
        if (bgBlack) {
          imgData.data[idx] = 0; imgData.data[idx + 1] = 0; imgData.data[idx + 2] = 0; imgData.data[idx + 3] = 255;
        } else {
          imgData.data[idx] = 255; imgData.data[idx + 1] = 255; imgData.data[idx + 2] = 255; imgData.data[idx + 3] = 0;
        }
      } else {
        const [cr, cg, cb] = jetColor(val);
        imgData.data[idx] = cr; imgData.data[idx + 1] = cg; imgData.data[idx + 2] = cb; imgData.data[idx + 3] = 255;
      }
    }
  }

  const tmp = document.createElement('canvas');
  tmp.width = bCols; tmp.height = bRows;
  tmp.getContext('2d').putImageData(imgData, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tmp, x, y, w, h);
}

/* ═══════════════════════════════════════════════════════════════
   1. 压力演变图 - 真实数据渲染
   props.data = { left: [{data, title}, ...], right: [{data, title}, ...] }
   ═══════════════════════════════════════════════════════════════ */
export function RealPressureEvolution({ data, width = 1200, height = 600 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // 浅灰背景
    ctx.fillStyle = '#F8F8F8';
    ctx.fillRect(0, 0, width, height);

    const leftFrames = data?.left || [];
    const rightFrames = data?.right || [];
    const numCols = Math.max(leftFrames.length, rightFrames.length, 10);

    // 标题
    ctx.fillStyle = '#1A2332';
    ctx.font = 'bold 14px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('足底压力演变（落地 → 离地）', width / 2, 22);

    const labelW = 70;
    const padX = 10;
    const padY = 36;
    const rowGap = 12;
    const cellW = (width - labelW - padX * 2) / numCols;
    const cellH = (height - padY - 10 - rowGap) / 2;

    // 计算全局最大值（使用 80% 分位作为 vmax，让颜色更饱满）
    let allVals = [];
    [...leftFrames, ...rightFrames].forEach(f => {
      if (f?.data) {
        for (let r = 0; r < f.data.length; r++) {
          for (let c = 0; c < (f.data[r]?.length || 0); c++) {
            if (f.data[r][c] > 0) allVals.push(f.data[r][c]);
          }
        }
      }
    });
    allVals.sort((a, b) => a - b);
    let globalMax = allVals.length > 0 ? allVals[Math.floor(allVals.length * 0.95)] : 1;
    if (globalMax === 0) globalMax = 1;

    // 绘制行
    const drawRow = (frames, rowIdx, label) => {
      const y0 = padY + rowIdx * (cellH + rowGap);

      // 行标签
      ctx.fillStyle = '#1A2332';
      ctx.font = 'bold 12px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, labelW - 10, y0 + cellH / 2 + 8);

      if (!frames || frames.length === 0) {
        ctx.fillStyle = '#999';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('无数据', width / 2, y0 + cellH / 2);
        return;
      }

      frames.forEach((frame, i) => {
        if (!frame?.data || frame.data.length === 0) return;
        const cellX = labelW + padX + i * cellW + 4;
        const cellY = y0 + 20;
        const cellContentW = cellW - 8;
        const cellContentH = cellH - 26;

        // 帧标签
        const title = frame.title || '';
        const isPeak = title.includes('峰值') || title.includes('Peak');

        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        if (isPeak) {
          ctx.fillStyle = '#DC2626';
          ctx.font = 'bold 10px "PingFang SC", "Microsoft YaHei", sans-serif';
          ctx.fillText(title, cellX + cellContentW / 2, y0);
        } else {
          ctx.fillStyle = '#6B7B8D';
          ctx.font = '10px "PingFang SC", "Microsoft YaHei", sans-serif';
          ctx.fillText(title, cellX + cellContentW / 2, y0 + 4);
        }

        // 先画黑色背景填满单元格
        ctx.fillStyle = '#000000';
        ctx.fillRect(cellX, cellY, cellContentW, cellContentH);

        // 保持矩阵纵横比，在单元格内居中绘制
        const matRows = frame.data.length;
        const matCols = frame.data[0]?.length || 1;
        const matAspect = matRows / matCols;
        const cellAspect = cellContentH / cellContentW;
        let drawW, drawH;
        if (matAspect > cellAspect) {
          // 矩阵更瘦长，以高度为准
          drawH = cellContentH;
          drawW = drawH / matAspect;
        } else {
          // 矩阵更宽扁，以宽度为准
          drawW = cellContentW;
          drawH = drawW * matAspect;
        }
        const drawX = cellX + (cellContentW - drawW) / 2;
        const drawY = cellY + (cellContentH - drawH) / 2;

        // 绘制平滑热力图（保持纵横比）
        drawSmoothHeatmap(ctx, frame.data, drawX, drawY, drawW, drawH, globalMax, true);
      });
    };

    drawRow(leftFrames, 0, '左脚');
    drawRow(rightFrames, 1, '右脚');

  }, [data, width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: 'auto', aspectRatio: `${width}/${height}`, borderRadius: 8, display: 'block', margin: '0 auto' }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════
   2. 步态平均摘要 - 真实数据渲染
   props.data = { left: {heatmap, cops, stepCount}, right: {heatmap, cops, stepCount} }
   ═══════════════════════════════════════════════════════════════ */
export function RealGaitAverageSummary({ data, width = 800, height = 700 }) {
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
    ctx.font = 'bold 14px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('步态平均摘要（平滑处理）', width / 2, 24);

    const leftData = data?.left;
    const rightData = data?.right;

    const drawSide = (sideData, centerX, label) => {
      if (!sideData || !sideData.heatmap || sideData.heatmap.length === 0) {
        ctx.fillStyle = '#666';
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('无数据', centerX, height / 2);
        return;
      }

      const heatmap = sideData.heatmap;
      const rows = heatmap.length;
      const cols = heatmap[0]?.length || 0;
      if (cols === 0) return;

      // 标签在上方
      ctx.fillStyle = '#CCCCCC';
      ctx.font = '13px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${label}平均`, centerX, 46);

      // 计算绘制区域，保持纵横比
      const topPad = 58;
      const bottomPad = 30;
      const maxDrawH = height - topPad - bottomPad;
      const maxDrawW = width / 2 - 50;
      const aspect = rows / cols;
      let drawW, drawH;
      if (aspect > maxDrawH / maxDrawW) {
        drawH = maxDrawH;
        drawW = drawH / aspect;
      } else {
        drawW = maxDrawW;
        drawH = drawW * aspect;
      }

      const drawX = centerX - drawW / 2;
      const drawY = topPad;

      // 使用 95% 分位值作为 maxVal，让颜色更饱满
      let vals = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (heatmap[r][c] > 0) vals.push(heatmap[r][c]);
        }
      }
      vals.sort((a, b) => a - b);
      const maxVal = vals.length > 0 ? vals[Math.floor(vals.length * 0.92)] : 1;

      // 绘制平滑热力图
      drawSmoothHeatmap(ctx, heatmap, drawX, drawY, drawW, drawH, maxVal, true);

      // 绘制COP轨迹
      const scaleX = drawW / cols;
      const scaleY = drawH / rows;

      if (sideData.cops && sideData.cops.length > 0) {
        sideData.cops.forEach((cop, copIdx) => {
          if (!cop.xs || !cop.ys || cop.xs.length < 2) return;

          // 每条COP轨迹用白色线
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.lineWidth = 1.8;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.beginPath();
          for (let i = 0; i < cop.xs.length; i++) {
            const px = drawX + cop.ys[i] * scaleX;
            const py = drawY + cop.xs[i] * scaleY;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.stroke();

          // 起点标记（白色实心圆 + 红色边框）
          const startPx = drawX + cop.ys[0] * scaleX;
          const startPy = drawY + cop.xs[0] * scaleY;
          ctx.fillStyle = '#FFFFFF';
          ctx.strokeStyle = '#FF4444';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(startPx, startPy, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // 终点标记（红色 ×）
          const endPx = drawX + cop.ys[cop.ys.length - 1] * scaleX;
          const endPy = drawY + cop.xs[cop.xs.length - 1] * scaleY;
          ctx.strokeStyle = '#FF4444';
          ctx.lineWidth = 2;
          const sz = 4;
          ctx.beginPath(); ctx.moveTo(endPx - sz, endPy - sz); ctx.lineTo(endPx + sz, endPy + sz); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(endPx + sz, endPy - sz); ctx.lineTo(endPx - sz, endPy + sz); ctx.stroke();
        });
      }

      // 步数标签
      ctx.fillStyle = '#CCCCCC';
      ctx.font = '12px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`(共${sideData.stepCount || 0}步)`, centerX, drawY + drawH + 18);
    };

    drawSide(leftData, width * 0.25, '左脚');
    drawSide(rightData, width * 0.75, '右脚');

  }, [data, width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', maxWidth: width, height: 'auto', aspectRatio: `${width}/${height}`, borderRadius: 8, display: 'block', margin: '0 auto' }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════
   3. 足印热力图（足偏角分析）- 真实数据渲染
   props.data = { heatmap, fpaLines }
   ═══════════════════════════════════════════════════════════════ */
export function RealFootprintHeatmap({ data, width: canvasWidth = 500, height: canvasHeight = 700 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // 白色背景
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    const heatmap = data?.heatmap;
    if (!heatmap || heatmap.length === 0) {
      ctx.fillStyle = '#999';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('无数据', canvasWidth / 2, canvasHeight / 2);
      return;
    }

    // 标题
    ctx.fillStyle = '#1A2332';
    ctx.font = 'bold 14px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('足印热力图（足偏角分析）', canvasWidth / 2, 24);

    const matH = heatmap.length;
    const matW = heatmap[0]?.length || 0;
    if (matW === 0) return;

    // 绘制区域
    const padTop = 40, padBottom = 20, padLeft = 30, padRight = 60;
    const drawW = canvasWidth - padLeft - padRight;
    const drawH = canvasHeight - padTop - padBottom;

    // 保持纵横比
    const aspect = matH / matW;
    let actualW, actualH;
    if (aspect > drawH / drawW) {
      actualH = drawH;
      actualW = actualH / aspect;
    } else {
      actualW = drawW;
      actualH = actualW * aspect;
    }
    const drawX = padLeft + (drawW - actualW) / 2;
    const drawY = padTop;

    // 使用 95% 分位值作为 maxVal
    let vals = [];
    for (let r = 0; r < matH; r++) {
      for (let c = 0; c < matW; c++) {
        if (heatmap[r][c] > 0) vals.push(heatmap[r][c]);
      }
    }
    vals.sort((a, b) => a - b);
    const maxVal = vals.length > 0 ? vals[Math.floor(vals.length * 0.92)] : 1;

    // 绘制平滑热力图
    drawSmoothHeatmap(ctx, heatmap, drawX, drawY, actualW, actualH, maxVal, false);

    // 绘制FPA角度线
    const scaleX = actualW / matW;
    const scaleY = actualH / matH;

    if (data.fpaLines && data.fpaLines.length > 0) {
      data.fpaLines.forEach(line => {
        if (!line.heel || !line.fore) return;
        const hx = drawX + line.heel[1] * scaleX;
        const hy = drawY + line.heel[0] * scaleY;
        const fx = drawX + line.fore[1] * scaleX;
        const fy = drawY + line.fore[0] * scaleY;

        // 主轴线（白色虚线）
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(fx, fy);
        ctx.stroke();
        ctx.setLineDash([]);

        // 行进方向参考线（垂直虚线）
        const midX = (hx + fx) / 2;
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = 'rgba(200,200,200,0.5)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(midX, Math.min(hy, fy) - 15);
        ctx.lineTo(midX, Math.max(hy, fy) + 15);
        ctx.stroke();
        ctx.setLineDash([]);

        // 角度标注
        const angle = line.angle;
        const labelX = Math.max(hx, fx) + 8;
        const labelY = (hy + fy) / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(labelX - 2, labelY - 9, 38, 14);
        ctx.fillStyle = '#FFFF00';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`${angle.toFixed(1)}°`, labelX + 2, labelY + 2);
      });
    }

    // 色条
    const barX = canvasWidth - 45, barY = padTop, barW = 16, barH = actualH;
    for (let i = 0; i < barH; i++) {
      const t = 1 - i / barH;
      const [r, g, b] = jetColor(t);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(barX, barY + i, barW, 1);
    }
    ctx.strokeStyle = '#D0D5DD';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(barX, barY, barW, barH);

    // 色条标签
    ctx.fillStyle = '#6B7B8D';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) {
      const val = Math.round(maxVal * (1 - i / 4));
      const yy = barY + i * barH / 4;
      ctx.fillText(`${val}`, barX + barW + 3, yy + 3);
    }

  }, [data, canvasWidth, canvasHeight]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: canvasWidth, height: canvasHeight, borderRadius: 8, display: 'block', margin: '0 auto' }}
    />
  );
}
