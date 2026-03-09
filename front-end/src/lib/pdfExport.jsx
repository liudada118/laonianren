/**
 * PDF 导出工具
 * 
 * 使用 html2canvas + jsPDF 将 DOM 内容渲染为真实 PDF 文件并触发下载
 * 支持长页面自动分页（单页滑动模式）
 */
import React from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

/**
 * 将指定容器内容导出为 PDF 文件
 * @param {HTMLElement} container - 要导出的 DOM 容器
 * @param {string} fileName - 文件名（不含扩展名）
 * @param {object} options - 配置选项
 * @param {string} options.title - PDF 标题（元数据）
 * @param {string} options.orientation - 'portrait' | 'landscape'
 * @param {number} options.scale - 渲染缩放比例，默认 2
 * @param {number} options.quality - JPEG 质量 0-1，默认 0.95
 */
export async function exportToPdf(container, fileName = 'report', options = {}) {
  if (!container) {
    console.error('[PDF Export] 容器不存在');
    return false;
  }

  const {
    title = '评估报告',
    orientation = 'portrait',
    scale = 2,
    quality = 0.95,
  } = options;

  try {
    // 1. 使用 html2canvas 将 DOM 渲染为 canvas
    const canvas = await html2canvas(container, {
      scale,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      // 滚动容器需要完整渲染
      scrollX: 0,
      scrollY: 0,
      windowWidth: container.scrollWidth,
      windowHeight: container.scrollHeight,
    });

    // 2. 计算 PDF 尺寸（A4: 210mm x 297mm）
    const isLandscape = orientation === 'landscape';
    const pageWidth = isLandscape ? 297 : 210;
    const pageHeight = isLandscape ? 210 : 297;
    const margin = 5; // mm
    const contentWidth = pageWidth - margin * 2;
    const contentHeight = pageHeight - margin * 2;

    // 图片宽度适配到 PDF 内容区域宽度
    const imgWidth = contentWidth;
    const imgHeight = (canvas.height * contentWidth) / canvas.width;

    // 3. 创建 jsPDF 实例
    const pdf = new jsPDF({
      orientation: isLandscape ? 'l' : 'p',
      unit: 'mm',
      format: 'a4',
    });

    // 设置 PDF 元数据
    pdf.setProperties({
      title: `${title} - ${fileName}`,
      creator: '老年人筛查系统',
    });

    // 4. 将 canvas 转为图片数据
    const imgData = canvas.toDataURL('image/jpeg', quality);

    // 5. 单页滑动模式：如果内容超过一页，自动分页
    if (imgHeight <= contentHeight) {
      // 内容不超过一页，直接放置
      pdf.addImage(imgData, 'JPEG', margin, margin, imgWidth, imgHeight);
    } else {
      // 内容超过一页，按页高裁切分页
      let remainingHeight = imgHeight;
      let position = 0; // 当前在图片中的 mm 偏移

      while (remainingHeight > 0) {
        if (position > 0) {
          pdf.addPage();
        }

        // 计算当前页应该显示的图片区域
        // 使用 canvas 裁切来实现精确分页
        const sliceHeight = Math.min(contentHeight, remainingHeight);
        const sourceY = (position / imgHeight) * canvas.height;
        const sourceH = (sliceHeight / imgHeight) * canvas.height;

        // 创建当前页的 canvas 切片
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = sourceH;
        const ctx = pageCanvas.getContext('2d');
        ctx.drawImage(canvas, 0, sourceY, canvas.width, sourceH, 0, 0, canvas.width, sourceH);

        const pageImgData = pageCanvas.toDataURL('image/jpeg', quality);
        pdf.addImage(pageImgData, 'JPEG', margin, margin, imgWidth, sliceHeight);

        position += sliceHeight;
        remainingHeight -= sliceHeight;
      }
    }

    // 6. 保存 PDF 文件
    pdf.save(`${fileName}.pdf`);

    console.log('[PDF Export] PDF 生成成功:', `${fileName}.pdf`);
    return true;
  } catch (e) {
    console.error('[PDF Export] PDF 生成失败:', e);
    alert('PDF 生成失败: ' + e.message);
    return false;
  }
}

/**
 * 简单的 PDF 导出按钮组件（可复用）
 */
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
      className={className || "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all"}
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
