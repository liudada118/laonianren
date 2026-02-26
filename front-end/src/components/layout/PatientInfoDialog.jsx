import React, { useState } from 'react';
import { useAssessment } from '../../contexts/AssessmentContext';

export default function PatientInfoDialog({ onStart, onCancel }) {
  const { patientInfo, setPatientInfo } = useAssessment();
  const [name, setName] = useState(patientInfo?.name || '');
  const [gender, setGender] = useState(patientInfo?.gender || '');
  const [age, setAge] = useState(patientInfo?.age || '');
  const [weight, setWeight] = useState(patientInfo?.weight || '');

  const isValid = name.trim() && gender && age && weight;

  const handleStart = () => {
    const info = { name: name.trim(), gender, age: parseInt(age), weight: parseInt(weight) };
    setPatientInfo(info);
    onStart(info);
  };

  const ages = Array.from({ length: 41 }, (_, i) => 50 + i);
  const weights = Array.from({ length: 81 }, (_, i) => 30 + i);

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 zeiss-overlay animate-fadeIn">
      <div className="zeiss-dialog p-8 w-[480px] max-w-[90vw] animate-scaleIn">
        <h3 className="text-xl font-bold text-center mb-6" style={{ color: 'var(--text-primary)' }}>输入评估对象信息</h3>

        <div className="mb-4">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>姓名</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="请输入姓名" className="zeiss-input" />
        </div>

        <div className="mb-4">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>性别</label>
          <div className="flex gap-3">
            {['男', '女'].map(g => (
              <button key={g} onClick={() => setGender(g)}
                className="flex-1 py-3 rounded-[10px] font-medium transition-all text-sm"
                style={{
                  border: `2px solid ${gender === g ? 'var(--zeiss-blue)' : 'var(--border-light)'}`,
                  background: gender === g ? 'var(--zeiss-blue-light)' : 'white',
                  color: gender === g ? 'var(--zeiss-blue)' : 'var(--text-tertiary)',
                }}>
                {g}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>年龄</label>
          <select value={age} onChange={(e) => setAge(e.target.value)} className="zeiss-select">
            <option value="">请选择年龄</option>
            {ages.map(a => <option key={a} value={a}>{a}岁</option>)}
          </select>
        </div>

        <div className="mb-6">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>体重</label>
          <select value={weight} onChange={(e) => setWeight(e.target.value)} className="zeiss-select">
            <option value="">请选择体重</option>
            {weights.map(w => <option key={w} value={w}>{w}kg</option>)}
          </select>
        </div>

        <div className="flex gap-3">
          <button onClick={onCancel} className="zeiss-btn-secondary flex-1 py-3">取消</button>
          <button onClick={handleStart} disabled={!isValid}
            className="flex-1 py-3 rounded-[10px] font-semibold text-sm transition-all"
            style={{
              background: isValid ? 'var(--zeiss-blue)' : '#E8ECF0',
              color: isValid ? 'white' : 'var(--text-muted)',
              cursor: isValid ? 'pointer' : 'not-allowed',
              border: 'none',
            }}>
            开始评估
          </button>
        </div>
      </div>
    </div>
  );
}
