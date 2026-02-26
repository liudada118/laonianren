import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
      <h1 className="text-6xl font-bold mb-4" style={{ color: 'var(--border-medium)' }}>404</h1>
      <p className="text-xl mb-8" style={{ color: 'var(--text-tertiary)' }}>页面未找到</p>
      <button onClick={() => navigate('/')} className="zeiss-btn-primary px-8 py-3 text-sm">
        返回首页
      </button>
    </div>
  );
}
