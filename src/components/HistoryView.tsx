import { useState, useMemo } from 'react';
import { Trash2, ChevronDown, ChevronUp, BarChart3 } from 'lucide-react';
import { loadData, saveData, countSets, type PersistedData } from '../lib/store';
import { exerciseName } from '../lib/zh';
import type { WorkoutSession } from '../lib/types';

function sessionVolume(s: WorkoutSession): number {
  return s.exercises.reduce(
    (sum, w) => sum + w.sets.reduce((acc, set) => acc + (set.reps ?? 0) * (set.weight ?? 0), 0),
    0,
  );
}

function sessionDuration(s: WorkoutSession): string {
  if (!s.completedAt) return '—';
  const ms = new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime();
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} 分钟`;
  return `${Math.floor(min / 60)} 小时 ${min % 60} 分`;
}

export default function HistoryView() {
  const [data, setData] = useState<PersistedData>(loadData);
  const [expanded, setExpanded] = useState<number | null>(null);

  // 每周训练次数，最近 8 周
  const weekly = useMemo(() => {
    const buckets = new Map<string, number>();
    const now = Date.now();
    data.sessions.forEach((s) => {
      const days = Math.floor((now - new Date(s.startedAt).getTime()) / 86400000);
      if (days > 56) return;
      const week = Math.floor(days / 7);
      const key = week === 0 ? '本周' : `${week} 周前`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    });
    const order = ['本周', '1 周前', '2 周前', '3 周前', '4 周前', '5 周前', '6 周前', '7 周前'];
    return order.map((k) => ({ label: k, count: buckets.get(k) ?? 0 }));
  }, [data.sessions]);

  const handleDelete = (index: number) => {
    const next: PersistedData = {
      ...data,
      sessions: data.sessions.filter((_, i) => i !== index),
    };
    saveData(next);
    setData(next);
    setExpanded(null);
  };

  if (data.sessions.length === 0) {
    return (
      <div className="empty-state" style={{ maxWidth: 480, margin: '0 auto' }}>
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          color="var(--text-muted)"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <h3>还没有训练记录</h3>
        <p>完成一次训练后，记录会出现在这里。</p>
      </div>
    );
  }

  const maxWeek = Math.max(1, ...weekly.map((w) => w.count));
  const totalSetsAll = data.sessions.reduce((s, x) => s + countSets(x.exercises), 0);

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <div className="section-row">
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>历史记录</h2>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          共 {data.sessions.length} 次 · {totalSetsAll} 组
        </span>
      </div>

      <div className="stats-card">
        <div className="stats-title">
          <BarChart3 size={14} /> 近 8 周训练频次
        </div>
        <div className="stats-bars">
          {weekly.map((w) => (
            <div key={w.label} className="stats-col" title={`${w.label}：${w.count} 次`}>
              <div
                className="stats-bar"
                style={{ height: `${Math.max(4, (w.count / maxWeek) * 48)}px` }}
              />
              <span className="stats-label">{w.label.replace(' 周前', '')}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="history-list">
        {data.sessions.map((s, i) => {
          const isOpen = expanded === i;
          const vol = sessionVolume(s);
          return (
            <div key={`${s.startedAt}-${i}`} className="history-item">
              <div
                className="history-header"
                onClick={() => setExpanded(isOpen ? null : i)}
                style={{ cursor: 'pointer' }}
              >
                <span className="history-name">{s.name || '训练'}</span>
                <span className="history-date">
                  {new Date(s.startedAt).toLocaleDateString('zh-CN')}
                  {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </span>
              </div>

              <div className="history-summary">
                <span>{s.exercises.length} 个动作</span>
                <span>{countSets(s.exercises)} 组</span>
                <span>{sessionDuration(s)}</span>
                {vol > 0 && <span>{Math.round(vol)} kg 容量</span>}
              </div>

              {s.notes && <div className="history-notes">「{s.notes}」</div>}

              {isOpen && (
                <div className="history-detail">
                  {s.exercises.map((w, wi) => (
                    <div key={`${w.slug}-${wi}`} className="history-ex-row">
                      <span className="history-ex-name">{exerciseName(w.slug, w.exercise.name)}</span>
                      <span className="history-ex-sets">
                        {w.sets
                          .map((set) => {
                            const parts = [`${set.setNumber}`];
                            if (set.reps) parts.push(`${set.reps} 次`);
                            if (set.weight) parts.push(`${set.weight}kg`);
                            return parts.join(' · ');
                          })
                          .join('  |  ')}
                      </span>
                    </div>
                  ))}
                  <button
                    className="btn btn-secondary"
                    style={{ marginTop: 12, fontSize: 12, padding: '6px 12px' }}
                    onClick={() => handleDelete(i)}
                  >
                    <Trash2 size={12} /> 删除这条记录
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
