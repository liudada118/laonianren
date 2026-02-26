import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAssessment } from '../contexts/AssessmentContext';
import { searchHistory, deleteRecord, clearHistory } from '../lib/historyService';

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

const ASSESSMENT_KEYS = ['grip', 'sitstand', 'standing', 'gait'];

export default function AssessmentHistory() {
  const navigate = useNavigate();
  const { institution, patientInfo } = useAssessment();
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null);
  const pageSize = 10;

  const result = useMemo(() => {
    return searchHistory({
      keyword: searchTerm,
      date: dateFilter,
      page: currentPage,
      pageSize,
    });
    // eslint-disable-next-line
  }, [searchTerm, dateFilter, currentPage, refreshKey]);

  const { items, total, totalPages } = result;

  useEffect(() => { setCurrentPage(1); }, [searchTerm, dateFilter]);

  const handleDelete = useCallback((id) => {
    deleteRecord(id);
    setShowDeleteConfirm(null);
    setRefreshKey(k => k + 1);
  }, []);

  const handleClear = useCallback(() => {
    clearHistory();
    setShowClearConfirm(false);
    setRefreshKey(k => k + 1);
  }, []);

  const getCompletedCount = (assessments) => {
    if (!assessments) return 0;
    return ASSESSMENT_KEYS.filter(k => assessments[k]?.completed).length;
  };

  const viewReport = (recordId, type) => {
    navigate(`/history/report?id=${recordId}&type=${type}`);
  };

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
              <input type="text" placeholder="搜索姓名或机构" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                className="zeiss-input py-2 text-sm" style={{ width: 180 }} />
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
            <div className="col-span-1 text-center" style={{ color: 'var(--text-tertiary)' }}>序号</div>
            <div className="col-span-2" style={{ color: 'var(--text-tertiary)' }}>患者信息</div>
            <div className="col-span-1 text-center" style={{ color: 'var(--text-tertiary)' }}>日期</div>
            <div className="col-span-1 text-center" style={{ color: 'var(--text-tertiary)' }}>握力</div>
            <div className="col-span-1 text-center" style={{ color: 'var(--text-tertiary)' }}>起坐</div>
            <div className="col-span-1 text-center" style={{ color: 'var(--text-tertiary)' }}>站立</div>
            <div className="col-span-1 text-center" style={{ color: 'var(--text-tertiary)' }}>步态</div>
            <div className="col-span-2 text-center" style={{ color: 'var(--text-tertiary)' }}>完成度</div>
            <div className="col-span-2 text-center" style={{ color: 'var(--text-tertiary)' }}>操作</div>
          </div>

          {/* Table Body */}
          <div className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
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
                      <div className="col-span-1 text-center" style={{ color: 'var(--text-muted)' }}>{globalIdx}</div>
                      <div className="col-span-2 min-w-0">
                        <div className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{item.patientName}</div>
                        <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                          {item.patientGender} · {item.patientAge}岁 · {item.patientWeight}kg
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
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full" style={{ background: 'var(--bg-tertiary)' }}>
                              <span className="w-2 h-2 rounded-full" style={{ background: 'var(--border-medium)' }} />
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
                            const completed = assessment?.completed;
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
                                  {completed ? (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--success-light)', color: 'var(--success)' }}>已完成</span>
                                  ) : (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>未完成</span>
                                  )}
                                </div>
                                {completed && assessment.completedAt && (
                                  <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
                                    完成时间: {new Date(assessment.completedAt).toLocaleString('zh-CN')}
                                  </p>
                                )}
                                {!completed && (
                                  <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>暂未完成此项评估</p>
                                )}
                                {/* 查看报告按钮 */}
                                {completed ? (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); viewReport(item.id, key); }}
                                    className="mt-auto w-full py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5"
                                    style={{ background: 'var(--zeiss-blue)', color: 'white', border: 'none', cursor: 'pointer' }}>
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    查看报告
                                  </button>
                                ) : (
                                  <button disabled
                                    className="mt-auto w-full py-2 rounded-lg text-xs font-medium"
                                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px solid var(--border-light)', cursor: 'not-allowed' }}>
                                    暂无报告
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
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

      {/* 清空确认弹窗 */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
          <div className="zeiss-dialog p-8 w-[400px] max-w-[90vw] animate-scaleIn text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: 'var(--danger-light)' }}>
              <svg className="w-6 h-6" style={{ color: 'var(--danger)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
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
