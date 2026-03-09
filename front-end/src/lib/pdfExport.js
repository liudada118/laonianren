/**
 * PDF 导出工具
 * 
 * 使用 window.print() 实现 PDF 导出
 * 在 Electron 环境中，会调用 webContents.printToPDF 实现无弹窗直接保存
 * 在浏览器环境中，会弹出打印对话框
 */
import React from 'react';

/**
 * 将指定容器内容导出为 PDF
 * @param {HTMLElement} container - 要导出的 DOM 容器
 * @param {string} fileName - 文件名（不含扩展名）
 * @param {object} options - 配置选项
 * @param {string} options.title - PDF 标题
 * @param {string} options.orientation - 'portrait' | 'landscape'
 */
export async function exportToPdf(container, fileName = 'report', options = {}) {
  if (!container) {
    console.error('[PDF Export] 容器不存在');
    return false;
  }

  const { title = '评估报告', orientation = 'portrait' } = options;

  // 检查是否在 Electron 环境中
  const isElectron = !!(window.electronAPI || (typeof process !== 'undefined' && process.versions?.electron));

  if (isElectron && window.electronAPI?.printToPDF) {
    // Electron 环境：使用 IPC 调用主进程的 printToPDF
    try {
      const result = await window.electronAPI.printToPDF({
        fileName: `${fileName}.pdf`,
        landscape: orientation === 'landscape',
        printBackground: true,
        margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
      });
      console.log('[PDF Export] Electron PDF 导出成功:', result);
      return true;
    } catch (e) {
      console.error('[PDF Export] Electron PDF 导出失败:', e);
      // fallback 到 window.print
    }
  }

  // 浏览器环境 / Electron fallback：使用 window.print()
  return printContainerAsPdf(container, fileName, title, orientation);
}

/**
 * 使用 window.print() 打印指定容器
 */
function printContainerAsPdf(container, fileName, title, orientation) {
  return new Promise((resolve) => {
    // 创建打印专用 iframe
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow.document;

    // 复制所有样式表
    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'));
    let styleHtml = styles.map(s => s.outerHTML).join('\n');

    // 添加打印专用样式
    styleHtml += `
      <style>
        @page {
          size: A4 ${orientation};
          margin: 10mm;
        }
        @media print {
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          body {
            margin: 0;
            padding: 0;
            background: white !important;
            font-size: 12px;
          }
          .no-print { display: none !important; }
          canvas { max-width: 100% !important; }
          .zeiss-card { break-inside: avoid; page-break-inside: avoid; }
          section { break-inside: avoid; page-break-inside: avoid; }
        }
      </style>
    `;

    // 克隆容器内容
    const clonedContent = container.cloneNode(true);

    // 将 ECharts canvas 转换为图片
    const originalCanvases = container.querySelectorAll('canvas');
    const clonedCanvases = clonedContent.querySelectorAll('canvas');
    originalCanvases.forEach((canvas, i) => {
      try {
        const img = doc.createElement('img');
        img.src = canvas.toDataURL('image/png');
        img.style.cssText = `width:${canvas.style.width || canvas.width + 'px'};height:${canvas.style.height || canvas.height + 'px'};max-width:100%;`;
        if (clonedCanvases[i] && clonedCanvases[i].parentNode) {
          clonedCanvases[i].parentNode.replaceChild(img, clonedCanvases[i]);
        }
      } catch (e) {
        console.warn('[PDF Export] Canvas 转图片失败:', e);
      }
    });

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${title} - ${fileName}</title>
          ${styleHtml}
        </head>
        <body>
          ${clonedContent.outerHTML}
        </body>
      </html>
    `);
    doc.close();

    // 等待样式和图片加载完成后打印
    iframe.contentWindow.onload = () => {
      setTimeout(() => {
        try {
          iframe.contentWindow.print();
        } catch (e) {
          console.error('[PDF Export] 打印失败:', e);
        }
        setTimeout(() => {
          document.body.removeChild(iframe);
          resolve(true);
        }, 1000);
      }, 500);
    };

    // 超时保护
    setTimeout(() => {
      if (document.body.contains(iframe)) {
        try { iframe.contentWindow.print(); } catch (e) {}
        setTimeout(() => {
          if (document.body.contains(iframe)) document.body.removeChild(iframe);
          resolve(true);
        }, 1000);
      }
    }, 5000);
  });
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
