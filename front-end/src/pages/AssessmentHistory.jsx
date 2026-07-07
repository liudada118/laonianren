import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAssessment } from '../contexts/AssessmentContext';
import { searchHistory, deleteRecord, clearHistory, updateRecordReport } from '../lib/historyService';
import { backendBridge } from '../lib/BackendBridge';
import { exportAssessmentWorkbook, exportAssessmentBatchWorkbook } from '../lib/assessmentWorkbookExport';

const ASSESSMENT_LABELS = {
  grip: '握力评估',
  sitstand: '起坐能力评估',
  standing: '静态站立评估',
  gait: '行走步态评估',
};

const ASSESSMENT_ICONS = {
  grip: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M9.5 7V3.5a1.5 1.5 0 013 0V7m0 0V2.5a1.5 1.5 0 013 0V7m0 0V4a1.5 1.5 0 013 0v4.5M15.5 7V5.5a1.5 1.5 0 013 0V12c0 4.142-3.358 7.5-7.5 7.5S3.5 16.142 3.5 12v-1.5a1.5 1.5 0 013 0V7" />
    </svg>
  ),
  sitstand: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="12" cy="5" r="2" />
      <path d="M8 10h8l-2 6H10l-2-6zm2 6v5m4-5v5" />
    </svg>
  ),
  standing: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <ellipse cx="8" cy="16" rx="3" ry="5" />
      <ellipse cx="16" cy="16" rx="3" ry="5" />
    </svg>
  ),
  gait: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="12" cy="4" r="2" />
      <path d="M10 8l-3 7 3-1 2 8m0-14l3 5-2 2 3 7" />
    </svg>
  ),
};

const ASSESSMENT_KEYS = ['gait', 'standing', 'grip', 'sitstand'];

export default function AssessmentHistory() {
  const navigate = useNavigate();
  const { institution, patientInfo, resumeSession } = useAssessment();
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exportingId, setExportingId] = useState(null);
  const pageSize = 10;

  // 异步数据状态
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  // 批量导出（可勾选指定记录；未勾选时导出当前筛选下的全部记录）
  const [batchExporting, setBatchExporting] = useState(false);
  const [batchProgress, setBatchProgress] = useState(null);
  // 勾选的记录：id -> 记录对象（跨分页保留）
  const [selectedRecords, setSelectedRecords] = useState({});
  const selectedCount = Object.keys(selectedRecords).length;

  // 异步加载数据
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    searchHistory({
      keyword: searchTerm,
      date: dateFilter,
      page: currentPage,
      pageSize,
    }).then(result => {
      if (!cancelled) {
        setItems(result.items || []);
        setTotal(result.total || 0);
        setTotalPages(result.totalPages || 0);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setItems([]);
        setTotal(0);
        setTotalPages(0);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [searchTerm, dateFilter, currentPage, refreshKey]);

  useEffect(() => { setCurrentPage(1); }, [searchTerm, dateFilter]);

  const handleDelete = useCallback(async (id) => {
    await deleteRecord(id);
    setShowDeleteConfirm(null);
    setRefreshKey(k => k + 1);
  }, []);

  const handleClear = useCallback(async () => {
    await clearHistory();
    setShowClearConfirm(false);
    setRefreshKey(k => k + 1);
  }, []);

  const handleExportWorkbook = useCallback(async (record) => {
    if (!record || exportingId) return;
    setExportingId(record.id);
    try {
      const result = await exportAssessmentWorkbook(record, backendBridge);
      if (result.skipped.length) {
        alert(`已导出 ${result.exported} 个项目。未导出：${result.skipped.join('、')}`);
      }
    } catch (error) {
      console.error('导出四项评估数据失败:', error);
      alert('导出失败: ' + (error?.message || '未知错误'));
    } finally {
      setExportingId(null);
    }
  }, [exportingId]);

  // 勾选/取消勾选单条记录（存整条记录，跨分页保留）
  const toggleSelect = useCallback((record) => {
    setSelectedRecords(prev => {
      const next = { ...prev };
      if (next[record.id]) delete next[record.id];
      else next[record.id] = record;
      return next;
    });
  }, []);

  // 全选/取消全选当前页
  const toggleSelectAllPage = useCallback((checked) => {
    setSelectedRecords(prev => {
      const next = { ...prev };
      items.forEach(it => { if (checked) next[it.id] = it; else delete next[it.id]; });
      return next;
    });
  }, [items]);

  // 批量导出：勾选了就导选中的，没勾选就导当前筛选下的「全部」记录；选目录后逐人写 xlsx
  const handleBatchExportWorkbook = useCallback(async () => {
    if (batchExporting) return;
    setBatchExporting(true);
    setBatchProgress({ current: 0, total: 0, message: '正在收集记录...', status: 'starting' });
    try {
      let records;
      if (selectedCount > 0) {
        records = Object.values(selectedRecords);
      } else {
        const all = await searchHistory({ keyword: searchTerm, date: dateFilter, page: 1, pageSize: Math.max(total, 1) });
        records = all.items || [];
      }
      if (!records.length) {
        setBatchProgress(null);
        alert('没有可导出的记录');
        return;
      }
      setBatchProgress({ current: 0, total: records.length, message: '准备批量导出...', status: 'starting' });
      const result = await exportAssessmentBatchWorkbook(records, backendBridge, { onProgress: setBatchProgress });
      if (result.canceled) {
        setBatchProgress(null);
        return;
      }
      if (result.skipped.length) {
        alert(`已导出 ${result.exportedRecords}/${result.records} 人，共 ${result.exported} 个项目。\n目录：${result.directoryPath}\n未导出：\n${result.skipped.join('\n')}`);
      } else {
        alert(`已导出 ${result.exportedRecords}/${result.records} 人，共 ${result.exported} 个项目。\n目录：${result.directoryPath}`);
      }
    } catch (error) {
      console.error('批量导出评估数据失败:', error);
      alert('批量导出失败: ' + (error?.message || '未知错误'));
    } finally {
      setBatchExporting(false);
      setTimeout(() => setBatchProgress(null), 600);
    }
  }, [batchExporting, searchTerm, dateFilter, total, selectedCount, selectedRecords]);

  const getCompletedCount = (assessments) => {
    if (!assessments) return 0;
    return ASSESSMENT_KEYS.filter(k => assessments[k]?.completed).length;
  };

  const viewReport = (recordId, type) => {
    navigate(`/history/report?id=${recordId}&type=${type}`);
  };

  // 用已存的原始数据(按 assessmentId)重新生成某项报告的 render_data
  const genReportRenderData = async (type, assessment, record) => {
    const aid = assessment?.assessmentId;
    if (!aid) return null;
    const name = record?.patientName || 'test';
    if (type === 'gait') {
      const resp = await backendBridge.getGaitReport({ timestamp: new Date().toISOString(), assessmentId: aid, collectName: 'gait_assessment', body_weight_kg: record?.patientWeight || 60 });
      return resp?.data?.render_data || null;
    }
    if (type === 'standing') {
      const resp = await backendBridge.getStandingReport({ timestamp: Date.now(), assessmentId: aid });
      return (resp?.code === 0 && resp?.data?.render_data) ? resp.data.render_data : null;
    }
    if (type === 'sitstand') {
      const resp = await backendBridge.getSitStandReport({ timestamp: Date.now(), assessmentId: aid, collectName: name });
      return (resp?.code === 0 && resp?.data?.render_data) ? resp.data.render_data : null;
    }
    if (type === 'grip') {
      const ids = String(aid).split(',').filter(Boolean);
      const resp = await backendBridge.getGripReport({ timestamp: Date.now(), collectName: name, leftAssessmentId: ids[0], rightAssessmentId: ids[1] || ids[0], assessmentId: aid });
      return (resp?.code === 0 && resp?.data?.render_data) ? resp.data.render_data : null;
    }
    return null;
  };

  // 补全报告：用已存原始数据生成报告并写回该历史记录
  const [generatingKey, setGeneratingKey] = useState(null);
  const handleGenerateReport = async (record, type) => {
    const gk = `${record.id}:${type}`;
    if (generatingKey) return;
    setGeneratingKey(gk);
    try {
      const renderData = await genReportRenderData(type, record.assessments?.[type], record);
      if (!renderData) {
        alert('补全失败：未取到有效数据（原始数据可能不足，或该项采集异常）。可尝试「重测」。');
        return;
      }
      await updateRecordReport(record.id, type, { completed: true, reportData: renderData });
      setRefreshKey(k => k + 1);
    } catch (e) {
      console.error('补全报告失败:', e);
      alert('补全报告失败：' + (e?.message || '未知错误'));
    } finally {
      setGeneratingKey(null);
    }
  };

  // 批量生成报告：勾选了就对选中的，没勾选就对当前筛选下的全部；
  // 逐条记录、逐项对「有采集数据但无报告」的项生成 render_data 并写回(IndexedDB)。
  const [batchGenerating, setBatchGenerating] = useState(false);
  const handleBatchGenerateReports = useCallback(async () => {
    if (batchGenerating || batchExporting) return;
    setBatchGenerating(true);
    setBatchProgress({ current: 0, total: 0, message: '正在收集记录...', status: 'starting' });
    try {
      let records;
      if (selectedCount > 0) {
        records = Object.values(selectedRecords);
      } else {
        const all = await searchHistory({ keyword: searchTerm, date: dateFilter, page: 1, pageSize: Math.max(total, 1) });
        records = all.items || [];
      }
      // 收集所有「有数据、无报告」的 (记录,项目)
      const tasks = [];
      for (const rec of records) {
        for (const type of ASSESSMENT_KEYS) {
          const a = rec.assessments?.[type];
          if (a?.assessmentId && !(a?.report?.reportData)) tasks.push({ rec, type });
        }
      }
      if (!tasks.length) {
        setBatchProgress(null);
        alert('没有需要生成的报告（选中的记录报告都已生成，或没有可用采集数据）');
        return;
      }
      let done = 0, ok = 0, fail = 0;
      setBatchProgress({ current: 0, total: tasks.length, message: '开始生成报告...', status: 'running' });
      for (const { rec, type } of tasks) {
        setBatchProgress({ current: done, total: tasks.length, message: `正在生成 ${rec.patientName || ''} · ${ASSESSMENT_LABELS[type]}`, status: 'running' });
        try {
          const renderData = await genReportRenderData(type, rec.assessments?.[type], rec);
          if (renderData) { await updateRecordReport(rec.id, type, { completed: true, reportData: renderData }); ok++; }
          else fail++;
        } catch (e) {
          console.error('批量生成失败', rec.patientName, type, e);
          fail++;
        }
        done++;
        setBatchProgress({ current: done, total: tasks.length, message: `已生成 ${done}/${tasks.length}`, status: 'running' });
      }
      setRefreshKey(k => k + 1);
      alert(`批量生成完成：成功 ${ok} 项${fail ? `，失败 ${fail} 项（原始数据不足/采集异常，可单独重测）` : ''}。`);
    } catch (e) {
      console.error('批量生成报告失败:', e);
      alert('批量生成报告失败：' + (e?.message || '未知错误'));
    } finally {
      setBatchGenerating(false);
      setTimeout(() => setBatchProgress(null), 600);
    }
  }, [batchGenerating, batchExporting, selectedCount, selectedRecords, searchTerm, dateFilter, total]);

  return (
    <div className="min-h-screen w-full flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <header className="h-16 flex items-center justify-between px-4 sm:px-8 shrink-0 z-10"
        style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-light)', boxShadow: 'var(--shadow-xs)' }}>
        <div className="flex items-center gap-3 min-w-0">
          <img src="/logo1.png" alt="Logo" className="w-9 h-9 rounded-lg object-contain shrink-0" />
          <div className="min-w-0">
            <h1 className="text-sm sm:text-[15px] font-bold tracking-tight truncate" style={{ color: 'var(--text-primary)' }}>
              肌少症/老年人评估及监测系统
            </h1>
            <p className="text-[10px] tracking-[0.15em] hidden sm:block" style={{ color: 'var(--text-muted)' }}>
              SARCOPENIA ASSESSMENT & MONITORING SYSTEM
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:gap-5 shrink-0">
          {patientInfo && (
            <span className="text-sm font-semibold hidden sm:inline" style={{ color: 'var(--text-primary)' }}>{patientInfo.name}</span>
          )}
          <button onClick={() => navigate('/dashboard')} className="zeiss-btn-ghost flex items-center gap-2 text-xs sm:text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            返回首页
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 p-3 sm:p-6 flex flex-col min-h-0">
        <div className="zeiss-card flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>历史记录</h2>
              <span className="text-xs px-2 py-1 rounded-md" style={{ background: 'var(--zeiss-blue-light)', color: 'var(--zeiss-blue)' }}>
                共 {total} 条
              </span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)}
                className="zeiss-input py-2 text-sm" style={{ width: 160 }} />
              <input type="text" placeholder="搜索姓名 / 编号 / 地区" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                className="zeiss-input py-2 text-sm" style={{ width: 180 }} />
              {total > 0 && selectedCount > 0 && (
                <span className="text-xs px-2 py-1 rounded-md" style={{ background: '#ECFDF5', color: '#059669' }}>
                  已选 {selectedCount} 人
                </span>
              )}
              {total > 0 && (
                <button onClick={handleBatchExportWorkbook} disabled={batchExporting}
                  className="text-xs px-3 py-2 rounded-lg transition-colors"
                  title={selectedCount > 0 ? '导出勾选的记录' : '未勾选则导出当前筛选下的全部记录'}
                  style={{ color: '#059669', background: '#ECFDF5', border: '1px solid #05966930', cursor: batchExporting ? 'not-allowed' : 'pointer', opacity: batchExporting ? 0.55 : 1 }}>
                  {batchExporting ? '批量导出中...' : (selectedCount > 0 ? `批量导出(${selectedCount})` : '批量导出数据')}
                </button>
              )}
              {total > 0 && (
                <button onClick={handleBatchGenerateReports} disabled={batchGenerating || batchExporting}
                  className="text-xs px-3 py-2 rounded-lg transition-colors"
                  title={selectedCount > 0 ? '为勾选的记录批量生成缺失的报告' : '为当前筛选下全部记录批量生成缺失的报告'}
                  style={{ color: 'var(--zeiss-blue)', background: 'var(--zeiss-blue-light)', border: '1px solid var(--zeiss-blue)30', cursor: (batchGenerating || batchExporting) ? 'not-allowed' : 'pointer', opacity: batchGenerating ? 0.55 : 1 }}>
                  {batchGenerating ? '批量生成中...' : (selectedCount > 0 ? `批量生成报告(${selectedCount})` : '批量生成报告')}
                </button>
              )}
              {total > 0 && selectedCount > 0 && (
                <button onClick={() => setSelectedRecords({})}
                  className="text-xs px-3 py-2 rounded-lg transition-colors"
                  style={{ color: 'var(--text-tertiary)', background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', cursor: 'pointer' }}>
                  清除选择
                </button>
              )}
              {total > 0 && (
                <button onClick={() => setShowClearConfirm(true)}
                  className="text-xs px-3 py-2 rounded-lg transition-colors"
                  style={{ color: 'var(--danger)', background: 'var(--danger-light)', border: 'none', cursor: 'pointer' }}>
                  清空全部
                </button>
              )}
            </div>
          </div>

          {/* Table Header */}
          <div className="grid grid-cols-12 gap-2 px-4 sm:px-6 py-3 text-xs font-semibold zeiss-table-header">
            <div className="col-span-1 flex items-center justify-center gap-1.5" style={{ color: 'var(--text-tertiary)' }}>
              <input type="checkbox"
                checked={items.length > 0 && items.every(it => selectedRecords[it.id])}
                onChange={(e) => toggleSelectAllPage(e.target.checked)}
                title="全选/取消本页"
                style={{ width: 13, height: 13, accentColor: '#059669', cursor: 'pointer' }} />
              序号
            </div>
            <div className="col-span-2" style={{ color: 'var(--text-tertiary)' }}>患者信息</div>
            <div className="col-span-1 text-center" style={{ color: 'var(--text-tertiary)' }}>日期</div>
            <div className="col-span-1 text-center" style={{ color: 'var(--text-tertiary)' }}>步态</div>
            <div className="col-span-1 text-center" style={{ color: 'var(--text-tertiary)' }}>站立</div>
            <div className="col-span-1 text-center" style={{ color: 'var(--text-tertiary)' }}>握力</div>
            <div className="col-span-1 text-center" style={{ color: 'var(--text-tertiary)' }}>起坐</div>
            <div className="col-span-2 text-center" style={{ color: 'var(--text-tertiary)' }}>完成度</div>
            <div className="col-span-2 text-center" style={{ color: 'var(--text-tertiary)' }}>操作</div>
          </div>

          {/* Table Body */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="w-8 h-8 border-2 rounded-full animate-spin mb-4"
                  style={{ borderColor: 'var(--border-light)', borderTopColor: 'var(--zeiss-blue)' }} />
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>加载中...</p>
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20">
                <svg className="w-16 h-16 mb-4" style={{ color: 'var(--border-light)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {searchTerm || dateFilter ? '未找到匹配的记录' : '暂无历史记录，完成评估后会自动保存'}
                </p>
              </div>
            ) : (
              items.map((item, idx) => {
                const completedCount = getCompletedCount(item.assessments);
                const globalIdx = (currentPage - 1) * pageSize + idx + 1;
                const isExpanded = expandedRow === item.id;

                return (
                  <React.Fragment key={item.id}>
                    <div className="grid grid-cols-12 gap-2 px-4 sm:px-6 py-3.5 text-sm items-center zeiss-table-row cursor-pointer"
                      onClick={() => setExpandedRow(isExpanded ? null : item.id)}>
                      <div className="col-span-1 flex items-center justify-center gap-1.5" style={{ color: 'var(--text-muted)' }}
                        onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox"
                          checked={!!selectedRecords[item.id]}
                          onChange={() => toggleSelect(item)}
                          style={{ width: 13, height: 13, accentColor: '#059669', cursor: 'pointer' }} />
                        <span>{globalIdx}</span>
                      </div>
                      <div className="col-span-2 min-w-0">
                        <div className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{item.patientName}</div>
                        <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                          {[
                            item.patientId && `编号${item.patientId}`,
                            item.patientRegion,
                            item.patientGender,
                            (item.patientAge !== '' && item.patientAge != null) && `${item.patientAge}岁`,
                          ].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </div>
                      <div className="col-span-1 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {item.dateStr}
                      </div>
                      {ASSESSMENT_KEYS.map(key => (
                        <div key={key} className="col-span-1 text-center">
                          {item.assessments?.[key]?.completed ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full" style={{ background: 'var(--success-light)' }}>
                              <svg className="w-3.5 h-3.5" style={{ color: 'var(--success)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                              </svg>
                            </span>
                          ) : (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full" style={{ background: '#FEE2E2' }} title="未测">
                              <svg className="w-3.5 h-3.5" style={{ color: '#DC2626' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </span>
                          )}
                        </div>
                      ))}
                      <div className="col-span-2 flex items-center justify-center gap-2">
                        <div className="w-20 h-2 rounded-full overflow-hidden" style={{ background: 'var(--border-light)' }}>
                          <div className="h-full rounded-full transition-all"
                            style={{
                              width: `${(completedCount / 4) * 100}%`,
                              background: completedCount === 4 ? 'var(--success)' : 'var(--zeiss-blue)'
                            }} />
                        </div>
                        <span className="text-xs font-medium" style={{ color: completedCount === 4 ? 'var(--success)' : 'var(--zeiss-blue)' }}>
                          {completedCount}/4
                        </span>
                      </div>
                      <div className="col-span-2 flex justify-center gap-2">
                        <button onClick={(e) => { e.stopPropagation(); setExpandedRow(isExpanded ? null : item.id); }}
                          className="text-xs px-3 py-1.5 rounded-md transition-colors"
                          style={{ color: 'var(--zeiss-blue)', background: 'var(--zeiss-blue-light)', border: 'none', cursor: 'pointer' }}>
                          {isExpanded ? '收起' : '详情'}
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(item.id); }}
                          className="text-xs px-3 py-1.5 rounded-md transition-colors"
                          style={{ color: 'var(--danger)', background: 'var(--danger-light)', border: 'none', cursor: 'pointer' }}>
                          删除
                        </button>
                      </div>
                    </div>

                    {/* 展开详情 - 每个评估都可以点击查看报告 */}
                    {isExpanded && (
                      <div className="px-4 sm:px-6 pb-4 animate-slideUp" style={{ background: 'var(--bg-tertiary)' }}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3">
                          {ASSESSMENT_KEYS.map(key => {
                            const assessment = item.assessments?.[key];
                            const hasReport = !!(assessment?.report?.reportData);
                            const hasData = !!(assessment?.assessmentId);
                            const completed = hasReport;
                            const generating = generatingKey === `${item.id}:${key}`;
                            return (
                              <div key={key} className="zeiss-card p-4 flex flex-col">
                                <div className="flex items-center justify-between mb-3">
                                  <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                                      style={{
                                        background: completed ? 'var(--zeiss-blue-light)' : 'var(--bg-tertiary)',
                                        color: completed ? 'var(--zeiss-blue)' : 'var(--text-muted)'
                                      }}>
                                      {ASSESSMENT_ICONS[key]}
                                    </div>
                                    <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                      {ASSESSMENT_LABELS[key]}
                                    </h4>
                                  </div>
                                  {hasReport ? (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--success-light)', color: 'var(--success)' }}>已完成</span>
                                  ) : hasData ? (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: '#FEF3C7', color: '#D97706' }}>待出报告</span>
                                  ) : (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: '#FEE2E2', color: '#DC2626' }}>未测</span>
                                  )}
                                </div>
                                {hasReport && assessment.completedAt && (
                                  <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
                                    完成时间: {new Date(assessment.completedAt).toLocaleString('zh-CN')}
                                  </p>
                                )}
                                {!hasReport && hasData && (
                                  <p className="text-[11px] mb-3" style={{ color: '#D97706' }}>已有采集数据、报告未生成，可补全报告或重测</p>
                                )}
                                {!hasData && (
                                  <p className="text-[11px] mb-3" style={{ color: '#DC2626' }}>该项未测，可点下方补测</p>
                                )}
                                {hasReport ? (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); viewReport(item.id, key); }}
                                    className="mt-auto w-full py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5"
                                    style={{ background: 'var(--zeiss-blue)', color: 'white', border: 'none', cursor: 'pointer' }}>
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    查看报告
                                  </button>
                                ) : hasData ? (
                                  <div className="mt-auto flex gap-2">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleGenerateReport(item, key); }}
                                      disabled={generating}
                                      className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
                                      style={{ background: '#059669', color: 'white', border: 'none', cursor: generating ? 'wait' : 'pointer', opacity: generating ? 0.6 : 1 }}>
                                      {generating ? '生成中…' : '补全报告'}
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); resumeSession(item); navigate(`/assessment/${key}`); }}
                                      className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
                                      style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FCA5A5', cursor: 'pointer' }}>
                                      重测
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); resumeSession(item); navigate(`/assessment/${key}`); }}
                                    className="mt-auto w-full py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5"
                                    style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FCA5A5', cursor: 'pointer' }}>
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                    </svg>
                                    去补测
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {/* 一键操作区 */}
                        {getCompletedCount(item.assessments) > 0 && (
                          <div className="mt-3 flex items-center gap-3 flex-wrap">
                            {/* 综合报告按钮 */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/history/comprehensive?id=${item.id}`);
                              }}
                              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all"
                              style={{ color: 'white', background: 'linear-gradient(135deg, #0066CC, #0891B2)', border: 'none', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,102,204,0.25)' }}>
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              生成综合报告
                            </button>
                            {/* 打开所有报告按钮 */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExportWorkbook(item);
                              }}
                              disabled={exportingId === item.id}
                              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all"
                              style={{ color: '#059669', background: '#ECFDF5', border: '1px solid #05966930', cursor: exportingId === item.id ? 'not-allowed' : 'pointer', opacity: exportingId === item.id ? 0.6 : 1 }}>
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              {exportingId === item.id ? '导出中...' : '导出四项数据'}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const completedTypes = ASSESSMENT_KEYS.filter(k => item.assessments?.[k]?.completed);
                                completedTypes.forEach((type, idx) => {
                                  setTimeout(() => {
                                    window.open(`/history/report?id=${item.id}&type=${type}`, '_blank');
                                  }, idx * 500);
                                });
                              }}
                              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all"
                              style={{ color: '#DC2626', background: '#FEF2F2', border: '1px solid #FCA5A530', cursor: 'pointer' }}>
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              打开单项报告（{getCompletedCount(item.assessments)}份）
                            </button>
                          </div>
                        )}
                        {item.institution && (
                          <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
                            评估机构: {item.institution}
                          </p>
                        )}
                      </div>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-4 sm:px-6 py-3 flex items-center justify-between shrink-0" style={{ borderTop: '1px solid var(--border-light)' }}>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                第 {currentPage} / {totalPages} 页，共 {total} 条记录
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="w-7 h-7 flex items-center justify-center rounded-md transition-colors"
                  style={{ color: currentPage <= 1 ? 'var(--border-light)' : 'var(--text-muted)', cursor: currentPage <= 1 ? 'not-allowed' : 'pointer' }}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }
                  return (
                    <button key={pageNum} onClick={() => setCurrentPage(pageNum)}
                      className="w-7 h-7 flex items-center justify-center rounded-md text-xs font-medium transition-all"
                      style={currentPage === pageNum
                        ? { background: 'var(--zeiss-blue)', color: 'white' }
                        : { color: 'var(--text-secondary)', cursor: 'pointer' }
                      }>
                      {pageNum}
                    </button>
                  );
                })}
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="w-7 h-7 flex items-center justify-center rounded-md transition-colors"
                  style={{ color: currentPage >= totalPages ? 'var(--border-light)' : 'var(--text-muted)', cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer' }}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      <div className="h-8 flex items-center px-4 sm:px-8 shrink-0">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>powered by 矩侨工业</span>
      </div>

      {/* 删除确认弹窗 */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
          <div className="zeiss-dialog p-8 w-[400px] max-w-[90vw] animate-scaleIn text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: 'var(--danger-light)' }}>
              <svg className="w-6 h-6" style={{ color: 'var(--danger)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <p className="text-base mb-6" style={{ color: 'var(--text-primary)' }}>确认删除此条记录？</p>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteConfirm(null)} className="zeiss-btn-secondary flex-1 py-3 text-sm">取消</button>
              <button onClick={() => handleDelete(showDeleteConfirm)}
                className="flex-1 py-3 rounded-[10px] text-sm font-semibold text-white border-none cursor-pointer"
                style={{ background: 'var(--danger)' }}>
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量导出进度 */}
      {batchProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
          <div className="zeiss-dialog p-8 w-[460px] max-w-[90vw] animate-scaleIn">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: '#ECFDF5' }}>
                <svg className="w-5 h-5" style={{ color: '#059669' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>批量导出数据</h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{batchProgress.message}</p>
              </div>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border-light)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${batchProgress.total ? Math.min(100, Math.round((batchProgress.current / batchProgress.total) * 100)) : 0}%`,
                  background: 'linear-gradient(135deg, #059669, #10B981)',
                }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
              <span>{batchProgress.current || 0} / {batchProgress.total || 0}</span>
              <span>{batchProgress.total ? Math.min(100, Math.round((batchProgress.current / batchProgress.total) * 100)) : 0}%</span>
            </div>
          </div>
        </div>
      )}

      {/* 清空确认弹窗 */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
          <div className="zeiss-dialog p-8 w-[400px] max-w-[90vw] animate-scaleIn text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: 'var(--danger-light)' }}>
              <svg className="w-6 h-6" style={{ color: 'var(--danger)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-base mb-2" style={{ color: 'var(--text-primary)' }}>确认清空所有历史记录？</p>
            <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>此操作不可恢复</p>
            <div className="flex gap-3">
              <button onClick={() => setShowClearConfirm(false)} className="zeiss-btn-secondary flex-1 py-3 text-sm">取消</button>
              <button onClick={handleClear}
                className="flex-1 py-3 rounded-[10px] text-sm font-semibold text-white border-none cursor-pointer"
                style={{ background: 'var(--danger)' }}>
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
