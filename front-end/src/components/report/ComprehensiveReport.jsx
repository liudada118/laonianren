import React, { useRef, useState, useMemo } from 'react';
import { exportToPdf } from '../../lib/pdfExport';
import GripReport from './GripReport';
import StandingReport from './StandingReport';
import SitStandReport from './SitStandReport';
import { GaitReportContent } from '../../pages/assessment/GaitAssessment';

/**
 * 综合评估报告组件
 * 客户定制：综合报告 = 4 个完整单项报告按正常测试流程顺序堆叠
 * 顺序：行走步态 → 静态站立 → 握力 → 起坐
 * 不做任何评分汇总，只把各项完整报告内容堆叠在一起，导出为一个 PDF。
 */

/* 各项报告 reportData 取值路径： record.assessments[type].report.reportData
   gait 同样存于 .report.reportData，但作为 pythonResult 传给 GaitReportContent */

/* ─── 分隔小标题 ─── */
function SectionDivider({ index, title }) {
  return (
    <div className="px-4 md:px-6 pt-6 pb-2">
      <div className="flex items-center gap-3">
        <span className="text-sm md:text-base font-bold whitespace-nowrap" style={{ color: 'var(--zeiss-blue)' }}>
          {index}、{title}
        </span>
        <div className="flex-1 h-px" style={{ background: 'var(--border-light)' }} />
      </div>
    </div>
  );
}

/* ─── 未测占位 ─── */
function NotTested({ label }) {
  return (
    <div className="mx-4 md:mx-6 mb-2 zeiss-card p-8 flex flex-col items-center justify-center text-center">
      <svg className="w-10 h-10 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--border-light)' }}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>{label}未测</p>
    </div>
  );
}

/* ─── 子报告容器 ───
   不再用固定 88vh + 内部滚动（那样每块都有自己的滚动条、看起来像缩放小窗）。
   改为按内容完整展开：配合下方 scoped CSS 解除子报告内部的 h-full / overflow，
   4 份子报告垂直拼接成一长条，整体只用外层一个滚动条，导出 PDF 也天然完整。 */
function ReportBlock({ children }) {
  return (
    <div className="cr-report-block mx-2 md:mx-4 mb-4 rounded-xl" style={{ border: '1px solid var(--border-light)' }}>
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   主组件 —— 四项报告按测试流程堆叠
   ═══════════════════════════════════════════════════ */
export default function ComprehensiveReport({ record, onClose }) {
  const contentRef = useRef(null);
  const [pdfExporting, setPdfExporting] = useState(false);

  const patientInfo = useMemo(() => ({
    name: record?.patientName || '未知',
    id: record?.patientId || '',
    region: record?.patientRegion || '',
    gender: record?.patientGender || '',
    age: record?.patientAge || '',
    weight: record?.patientWeight || '',
  }), [record]);

  const assessments = record?.assessments || {};

  // 各项 reportData（路径：assessments[type].report.reportData）
  const gaitData = assessments.gait?.report?.reportData || null;
  const standingData = assessments.standing?.report?.reportData || null;
  const gripData = assessments.grip?.report?.reportData || null;
  const sitstandData = assessments.sitstand?.report?.reportData || null;

  const handlePdfExport = async () => {
    if (pdfExporting) return;
    setPdfExporting(true);
    const root = contentRef?.current;
    const restores = [];
    try {
      if (root) {
        // 综合报告 = 4 个固定 88vh 容器 + 子报告内部独立滚动，直接截图会漏掉每块超出可视区的内容（少最后一页）。
        // 导出前先把所有限高/滚动容器展开成完整高度，让 4 份子报告平铺，确保 PDF 完整贴上。
        root.querySelectorAll('*').forEach((el) => {
          const cs = window.getComputedStyle(el);
          const hasOverflow = el.scrollHeight > el.clientHeight + 1;
          const fixedVh = typeof el.style?.height === 'string' && el.style.height.includes('vh');
          const clipped = cs.overflowY === 'auto' || cs.overflowY === 'scroll'
            || cs.overflow === 'hidden' || cs.overflow === 'auto';
          if (hasOverflow || fixedVh || clipped) {
            restores.push([el, el.getAttribute('style')]);
            el.style.height = 'auto';
            el.style.maxHeight = 'none';
            el.style.minHeight = '0';
            el.style.overflow = 'visible';
            el.style.overflowY = 'visible';
          }
        });
        // 等两帧让展开后的布局（含 echarts 容器）稳定，再截图
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }
      await exportToPdf(root, `${patientInfo.name}_综合评估报告`, { title: '综合评估报告' });
    } finally {
      restores.forEach(([el, css]) => {
        if (css === null) el.removeAttribute('style');
        else el.setAttribute('style', css);
      });
      setPdfExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 让 4 份子报告完整展开拼接：解除子报告内部的固定高度与内部滚动，
          页面整体只用外层一个滚动条，不再是每块一个带滚动条的小窗。 */}
      <style>{`
        .cr-report-block .h-full { height: auto !important; }
        .cr-report-block .overflow-hidden { overflow: visible !important; }
        .cr-report-block .overflow-y-auto { overflow-y: visible !important; height: auto !important; max-height: none !important; }
      `}</style>
      {/* 顶部栏 */}
      <div className="shrink-0 px-4 md:px-6 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)', background: 'var(--bg-secondary)' }}>
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-sm md:text-base font-bold whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
            综合评估报告
          </h2>
          <span className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
            {patientInfo.name}
            {patientInfo.id && ` · 编号${patientInfo.id}`}
            {patientInfo.region && ` · ${patientInfo.region}`}
            {patientInfo.gender && ` · ${patientInfo.gender}`}
            {patientInfo.age !== '' && ` · ${patientInfo.age}岁`}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={handlePdfExport} disabled={pdfExporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{ color: pdfExporting ? 'var(--text-muted)' : '#DC2626', background: pdfExporting ? 'var(--bg-tertiary)' : '#FEF2F2', border: '1px solid #FCA5A530', cursor: pdfExporting ? 'wait' : 'pointer' }}>
            {pdfExporting ? (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            )}
            {pdfExporting ? '导出中...' : '导出PDF'}
          </button>
          {onClose && (
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors" style={{ color: 'var(--text-muted)' }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>
      </div>

      {/* 堆叠主体（整体导出为一个 PDF） */}
      <div ref={contentRef} className="flex-1 overflow-y-auto">
        {/* 一、行走步态评估 */}
        <SectionDivider index="一" title="行走步态评估" />
        {gaitData
          ? <ReportBlock><GaitReportContent patientInfo={patientInfo} pythonResult={gaitData} /></ReportBlock>
          : <NotTested label="行走步态评估" />}

        {/* 二、静态站立评估 */}
        <SectionDivider index="二" title="静态站立评估" />
        {standingData
          ? <ReportBlock><StandingReport patientInfo={patientInfo} reportData={standingData} /></ReportBlock>
          : <NotTested label="静态站立评估" />}

        {/* 三、握力评估 */}
        <SectionDivider index="三" title="握力评估" />
        {gripData
          ? (gripData.left && gripData.right ? (
              <>
                <ReportBlock><GripReport patientInfo={patientInfo} patientName={patientInfo.name} reportData={{ ...gripData, activeHand: '左手' }} /></ReportBlock>
                <ReportBlock><GripReport patientInfo={patientInfo} patientName={patientInfo.name} reportData={{ ...gripData, activeHand: '右手' }} /></ReportBlock>
              </>
            ) : (
              <ReportBlock><GripReport patientInfo={patientInfo} patientName={patientInfo.name} reportData={gripData} /></ReportBlock>
            ))
          : <NotTested label="握力评估" />}

        {/* 四、起坐能力评估 */}
        <SectionDivider index="四" title="起坐能力评估" />
        {sitstandData
          ? <ReportBlock><SitStandReport patientInfo={patientInfo} reportData={sitstandData} /></ReportBlock>
          : <NotTested label="起坐能力评估" />}

        {/* 页脚 */}
        <div className="text-center py-6 text-[10px]" style={{ color: 'var(--text-muted)' }}>
          <p>肌少症/老年人评估及监测系统 · 综合评估报告</p>
          <p>powered by 矩侨工业</p>
        </div>
      </div>
    </div>
  );
}
