import React from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const TEMP_EXPORT_ATTR = 'data-pdf-export-id';
const DEFAULT_PAGE_BREAK_SELECTORS = [
  'section',
  '.zeiss-card',
  '.zeiss-card-inner',
  'table',
  '[data-pdf-keep-intact]',
  '[class*="overflow-x-auto"]',
].join(', ');
const MAX_RENDER_PIXELS = 32_000_000;

function getCaptureBounds(container) {
  const rect = container.getBoundingClientRect();
  let estimatedHeight = Math.max(
    container.scrollHeight || 0,
    container.clientHeight || 0,
    rect.height || 0,
  );

  container.querySelectorAll('*').forEach((element) => {
    const elementRect = element.getBoundingClientRect();
    const overflowHeight = Math.max(0, element.scrollHeight - element.clientHeight);
    const bottom = elementRect.bottom - rect.top + container.scrollTop + overflowHeight;
    estimatedHeight = Math.max(estimatedHeight, Math.ceil(bottom));
  });

  return {
    width: Math.max(1, Math.ceil(rect.width || container.clientWidth || container.offsetWidth || 0)),
    height: Math.max(1, estimatedHeight),
  };
}

function limitRenderScale(width, height, requestedScale) {
  const safeScale = Math.max(1, requestedScale || 1);
  const pixelCount = width * height * safeScale * safeScale;

  if (!pixelCount || pixelCount <= MAX_RENDER_PIXELS) {
    return safeScale;
  }

  const reducedScale = Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, width * height));
  return Math.max(1, Math.min(safeScale, reducedScale));
}

function collectPageBreakRanges(root, selectors) {
  if (!root) return [];

  const rootRect = root.getBoundingClientRect();
  const elements = Array.from(root.querySelectorAll(selectors));
  const seen = new Set();
  const ranges = [];

  elements.forEach((element) => {
    const rect = element.getBoundingClientRect();
    const top = Math.max(0, Math.round(rect.top - rootRect.top));
    const bottom = Math.max(top, Math.round(rect.bottom - rootRect.top));
    const height = bottom - top;

    if (height < 24) return;

    const key = `${top}:${bottom}`;
    if (seen.has(key)) return;
    seen.add(key);

    ranges.push({ top, bottom, height });
  });

  ranges.sort((a, b) => (a.top - b.top) || (a.bottom - b.bottom));
  return ranges;
}

function prepareCloneForCapture(root, captureWidth, captureHeight, selectors) {
  if (!root) return [];

  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const styleTag = doc.createElement('style');

  styleTag.textContent = `
    * {
      animation: none !important;
      transition: none !important;
      caret-color: transparent !important;
      scroll-behavior: auto !important;
    }
  `;
  doc.head.appendChild(styleTag);

  root.scrollTop = 0;
  root.scrollLeft = 0;
  root.style.width = `${captureWidth}px`;
  root.style.minWidth = `${captureWidth}px`;
  root.style.maxWidth = `${captureWidth}px`;
  root.style.height = 'auto';
  root.style.maxHeight = 'none';
  root.style.minHeight = `${captureHeight}px`;
  root.style.overflow = 'visible';
  root.style.background = '#ffffff';

  root.querySelectorAll('*').forEach((element) => {
    const computed = win.getComputedStyle(element);
    const hasVerticalOverflow = element.scrollHeight > element.clientHeight + 1;

    if (computed.position === 'sticky') {
      element.style.position = 'static';
      element.style.top = 'auto';
    }

    if (hasVerticalOverflow) {
      element.scrollTop = 0;
      element.style.height = 'auto';
      element.style.maxHeight = 'none';
      element.style.overflowY = 'visible';
    }
  });

  return collectPageBreakRanges(root, selectors);
}

function computePageSlices(totalHeight, pageHeight, ranges) {
  if (totalHeight <= pageHeight) {
    return [{ start: 0, end: totalHeight }];
  }

  const minFill = Math.max(160, Math.floor(pageHeight * 0.55));
  const slices = [];
  let start = 0;

  while (start < totalHeight) {
    let end = Math.min(start + pageHeight, totalHeight);

    if (end >= totalHeight) {
      slices.push({ start, end: totalHeight });
      break;
    }

    const crossingRanges = ranges
      .filter((range) => range.top < end && range.bottom > end && range.top > start + 20)
      .sort((a, b) => (b.top - a.top) || (a.height - b.height));

    const safeStart = crossingRanges.find(
      (range) => (range.top - start) >= minFill && range.height <= pageHeight,
    );

    if (safeStart) {
      end = safeStart.top;
    } else {
      const nearestBottom = ranges
        .filter((range) => range.bottom > start + minFill && range.bottom <= end)
        .map((range) => range.bottom)
        .sort((a, b) => b - a)[0];

      if (nearestBottom) {
        end = nearestBottom;
      }
    }

    if (end <= start + 20) {
      end = Math.min(start + pageHeight, totalHeight);
    }

    slices.push({ start, end });
    start = end;
  }

  return slices;
}

function renderCanvasSlice(sourceCanvas, startY, endY, quality) {
  const sliceHeight = Math.max(1, endY - startY);
  const pageCanvas = document.createElement('canvas');
  pageCanvas.width = sourceCanvas.width;
  pageCanvas.height = sliceHeight;

  const ctx = pageCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('无法创建 PDF 页面画布');
  }

  ctx.drawImage(
    sourceCanvas,
    0,
    startY,
    sourceCanvas.width,
    sliceHeight,
    0,
    0,
    sourceCanvas.width,
    sliceHeight,
  );

  return {
    dataUrl: pageCanvas.toDataURL('image/jpeg', quality),
    height: sliceHeight,
  };
}

// html2canvas 抓取 <canvas> 内容不稳定：ECharts 用 canvas 渲染，导出 PDF 时折线常丢失
// （软件里能看到，PDF 里空白）。这里在 onclone 阶段把每个 ECharts(zrender) canvas 用其
// toDataURL 快照替换成 <img>，保证曲线进入 PDF。只处理带 data-zr-dom-id 的 zrender canvas，
// 不触碰 WebGL（如 3D 手模）——WebGL canvas toDataURL 多为空白，替换反而会弄丢。
function replaceChartCanvasesWithImages(originalRoot, clonedRoot) {
  if (!originalRoot || !clonedRoot) return;
  const origCanvases = originalRoot.querySelectorAll('canvas');
  const cloneCanvases = clonedRoot.querySelectorAll('canvas');
  const view = originalRoot.ownerDocument.defaultView;
  origCanvases.forEach((orig, i) => {
    const clone = cloneCanvases[i];
    if (!clone || !clone.parentNode) return;
    // 仅处理 ECharts/zrender 的 2D canvas；WebGL 等其它 canvas 保持原样交给 html2canvas
    if (!orig.hasAttribute('data-zr-dom-id')) return;
    let dataUrl = '';
    try { dataUrl = orig.toDataURL('image/png'); } catch (e) { return; }
    if (!dataUrl || dataUrl.length < 32) return;
    const cs = view.getComputedStyle(orig);
    const img = clonedRoot.ownerDocument.createElement('img');
    img.src = dataUrl;
    img.style.cssText = clone.style.cssText || '';
    img.style.width = cs.width;
    img.style.height = cs.height;
    img.style.display = 'block';
    clone.parentNode.replaceChild(img, clone);
  });
}

export async function exportToPdf(container, fileName = 'report', options = {}) {
  if (!container) {
    console.error('[PDF Export] container is missing');
    return false;
  }

  const {
    title = '评估报告',
    orientation = 'portrait',
    scale = 2,
    quality = 0.95,
    pageBreakSelectors = DEFAULT_PAGE_BREAK_SELECTORS,
  } = options;

  const previousExportId = container.getAttribute(TEMP_EXPORT_ATTR);
  const exportId = `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const { width: captureWidth, height: captureHeight } = getCaptureBounds(container);
    const viewportWidth = Math.max(
      document.documentElement.clientWidth || 0,
      window.innerWidth || 0,
      captureWidth,
    );
    const viewportHeight = Math.max(
      document.documentElement.clientHeight || 0,
      window.innerHeight || 0,
      captureHeight,
    );
    const effectiveScale = limitRenderScale(captureWidth, captureHeight, scale);
    let pageBreakRanges = [];

    container.setAttribute(TEMP_EXPORT_ATTR, exportId);

    const canvas = await html2canvas(container, {
      scale: effectiveScale,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      width: captureWidth,
      height: captureHeight,
      scrollX: 0,
      scrollY: 0,
      windowWidth: viewportWidth,
      windowHeight: viewportHeight,
      onclone: (clonedDoc) => {
        const clonedContainer = clonedDoc.querySelector(`[${TEMP_EXPORT_ATTR}="${exportId}"]`);
        replaceChartCanvasesWithImages(container, clonedContainer);
        pageBreakRanges = prepareCloneForCapture(
          clonedContainer,
          captureWidth,
          captureHeight,
          pageBreakSelectors,
        );
      },
    });

    const isLandscape = orientation === 'landscape';
    const pageWidth = isLandscape ? 297 : 210;
    const pageHeight = isLandscape ? 210 : 297;
    const margin = 5;
    const contentWidth = pageWidth - margin * 2;
    const contentHeight = pageHeight - margin * 2;
    const imgWidth = contentWidth;
    const imgHeight = (canvas.height * contentWidth) / canvas.width;
    const pageHeightPx = Math.max(1, Math.floor((contentHeight / contentWidth) * canvas.width));
    const rangeScale = canvas.height / Math.max(1, captureHeight);
    const scaledBreakRanges = pageBreakRanges.map((range) => ({
      top: Math.round(range.top * rangeScale),
      bottom: Math.round(range.bottom * rangeScale),
      height: Math.round(range.height * rangeScale),
    }));
    const pageSlices = computePageSlices(canvas.height, pageHeightPx, scaledBreakRanges);

    const pdf = new jsPDF({
      orientation: isLandscape ? 'l' : 'p',
      unit: 'mm',
      format: 'a4',
    });

    pdf.setProperties({
      title: `${title} - ${fileName}`,
      creator: '老年人筛查系统',
    });

    if (imgHeight <= contentHeight || pageSlices.length <= 1) {
      const imgData = canvas.toDataURL('image/jpeg', quality);
      pdf.addImage(imgData, 'JPEG', margin, margin, imgWidth, imgHeight);
    } else {
      pageSlices.forEach((slice, index) => {
        if (index > 0) {
          pdf.addPage();
        }

        const page = renderCanvasSlice(canvas, slice.start, slice.end, quality);
        const sliceHeightMm = (page.height * imgWidth) / canvas.width;
        pdf.addImage(page.dataUrl, 'JPEG', margin, margin, imgWidth, sliceHeightMm);
      });
    }

    pdf.save(`${fileName}.pdf`);
    console.log('[PDF Export] success:', `${fileName}.pdf`);
    return true;
  } catch (error) {
    console.error('[PDF Export] failed:', error);
    alert(`PDF 生成失败: ${error.message}`);
    return false;
  } finally {
    if (previousExportId == null) {
      container.removeAttribute(TEMP_EXPORT_ATTR);
    } else {
      container.setAttribute(TEMP_EXPORT_ATTR, previousExportId);
    }
  }
}

/**
 * 多段合并导出：依次对每个 step.prepare() 返回的容器截图，合并进同一个 PDF。
 * 用于握力左右手：先切左手截图、再切右手截图，左手在前、右手在后。
 * @param {Array<{prepare: () => Promise<HTMLElement>}>} steps
 */
export async function exportHandsToPdf(steps, fileName = 'report', options = {}) {
  const {
    title = '评估报告',
    orientation = 'portrait',
    scale = 2,
    quality = 0.95,
    pageBreakSelectors = DEFAULT_PAGE_BREAK_SELECTORS,
  } = options;

  const isLandscape = orientation === 'landscape';
  const pageWidth = isLandscape ? 297 : 210;
  const pageHeight = isLandscape ? 210 : 297;
  const margin = 5;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;

  const pdf = new jsPDF({ orientation: isLandscape ? 'l' : 'p', unit: 'mm', format: 'a4' });
  pdf.setProperties({ title: `${title} - ${fileName}`, creator: '老年人筛查系统' });

  let firstPage = true;
  try {
    for (const step of steps) {
      const container = await step.prepare();
      if (!container) continue;

      const exportId = `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const prevId = container.getAttribute(TEMP_EXPORT_ATTR);
      container.setAttribute(TEMP_EXPORT_ATTR, exportId);
      try {
        const { width: cw, height: ch } = getCaptureBounds(container);
        const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0, cw);
        const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0, ch);
        const effScale = limitRenderScale(cw, ch, scale);
        let ranges = [];
        const canvas = await html2canvas(container, {
          scale: effScale, useCORS: true, allowTaint: true, backgroundColor: '#ffffff', logging: false,
          width: cw, height: ch, scrollX: 0, scrollY: 0, windowWidth: vw, windowHeight: vh,
          onclone: (doc) => {
            const c = doc.querySelector(`[${TEMP_EXPORT_ATTR}="${exportId}"]`);
            replaceChartCanvasesWithImages(container, c);
            ranges = prepareCloneForCapture(c, cw, ch, pageBreakSelectors);
          },
        });

        const imgWidth = contentWidth;
        const imgHeight = (canvas.height * contentWidth) / canvas.width;
        const pageHeightPx = Math.max(1, Math.floor((contentHeight / contentWidth) * canvas.width));
        const rangeScale = canvas.height / Math.max(1, ch);
        const scaledRanges = ranges.map((r) => ({
          top: Math.round(r.top * rangeScale),
          bottom: Math.round(r.bottom * rangeScale),
          height: Math.round(r.height * rangeScale),
        }));
        const slices = computePageSlices(canvas.height, pageHeightPx, scaledRanges);

        if (imgHeight <= contentHeight || slices.length <= 1) {
          if (!firstPage) pdf.addPage();
          pdf.addImage(canvas.toDataURL('image/jpeg', quality), 'JPEG', margin, margin, imgWidth, imgHeight);
          firstPage = false;
        } else {
          slices.forEach((slice) => {
            if (!firstPage) pdf.addPage();
            const page = renderCanvasSlice(canvas, slice.start, slice.end, quality);
            const sliceHmm = (page.height * imgWidth) / canvas.width;
            pdf.addImage(page.dataUrl, 'JPEG', margin, margin, imgWidth, sliceHmm);
            firstPage = false;
          });
        }
      } finally {
        if (prevId == null) container.removeAttribute(TEMP_EXPORT_ATTR);
        else container.setAttribute(TEMP_EXPORT_ATTR, prevId);
      }
    }

    pdf.save(`${fileName}.pdf`);
    return true;
  } catch (error) {
    console.error('[PDF Export multi] failed:', error);
    alert(`PDF 生成失败: ${error.message}`);
    return false;
  }
}

export function PdfExportButton({ containerRef, fileName, title, className, style, children }) {
  const [exporting, setExporting] = React.useState(false);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);

    try {
      await exportToPdf(containerRef?.current, fileName, { title });
    } finally {
      setExporting(false);
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={exporting}
      className={className || 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all'}
      style={style || {
        color: exporting ? 'var(--text-muted)' : '#DC2626',
        background: exporting ? 'var(--bg-tertiary)' : '#FEF2F2',
        border: '1px solid #FCA5A530',
        cursor: exporting ? 'wait' : 'pointer',
      }}
    >
      {exporting ? (
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      )}
      {children || (exporting ? '导出中...' : '导出 PDF')}
    </button>
  );
}
