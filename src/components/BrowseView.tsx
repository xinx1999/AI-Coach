import { useState, useMemo, useCallback } from 'react';
import { Search, Plus, X } from 'lucide-react';
import { allExercises, getAssetPath } from '../lib/store';
import { exerciseName, equipmentName, muscleName } from '../lib/zh';
import type { Exercise } from '../lib/types';

interface Props {
  onSelect: (ex: Exercise) => void;
  selectedSlugs: string[];
}

const MUSCLES = [...new Set(allExercises.map((e) => e.primaryMuscle))].sort();
const EQUIPMENT = [...new Set(allExercises.map((e) => e.equipment))].sort();

// 每个动作预先算好一份可搜索的中英文字符串，避免每次输入都重算
const SEARCH_INDEX = new Map(
  allExercises.map((e) => [
    e.slug,
    [
      exerciseName(e.slug, e.name),
      e.name,
      muscleName(e.primaryMuscle),
      e.primaryMuscle,
      equipmentName(e.equipment),
      e.equipment,
      ...e.secondaryMuscles,
      ...e.secondaryMuscles.map(muscleName),
    ]
      .join(' ')
      .toLowerCase(),
  ]),
);

export default function BrowseView({ onSelect, selectedSlugs }: Props) {
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState('');
  const [equipment, setEquipment] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allExercises.filter((e) => {
      if (muscle && e.primaryMuscle !== muscle) return false;
      if (equipment && e.equipment !== equipment) return false;
      if (q && !SEARCH_INDEX.get(e.slug)?.includes(q)) return false;
      return true;
    });
  }, [query, muscle, equipment]);

  const handleSelect = useCallback(
    (e: Exercise) => {
      if (!selectedSlugs.includes(e.slug)) onSelect(e);
    },
    [onSelect, selectedSlugs],
  );

  const hasFilter = Boolean(query || muscle || equipment);

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div className="section-row">
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>浏览动作</h2>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{filtered.length} 个动作</span>
      </div>

      <div className="search-wrap">
        <Search size={16} />
        <input
          className="search-input"
          placeholder="搜索动作名（中英文均可）、肌群或器械…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="search-clear" onClick={() => setQuery('')} title="清空">
            <X size={14} />
          </button>
        )}
      </div>

      <div>
        <p className="section-label">肌群</p>
        <div className="filter-row" style={{ marginBottom: 12 }}>
          <button className={`pill ${!muscle ? 'active' : ''}`} onClick={() => setMuscle('')}>
            全部
          </button>
          {MUSCLES.map((m) => (
            <button
              key={m}
              className={`pill ${muscle === m ? 'active' : ''}`}
              onClick={() => setMuscle(m)}
            >
              {muscleName(m)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="section-label">器械</p>
        <div className="filter-row" style={{ marginBottom: 20 }}>
          <button
            className={`pill ${!equipment ? 'active' : ''}`}
            onClick={() => setEquipment('')}
          >
            全部
          </button>
          {EQUIPMENT.map((eq) => (
            <button
              key={eq}
              className={`pill ${equipment === eq ? 'active' : ''}`}
              onClick={() => setEquipment(eq)}
            >
              {equipmentName(eq)}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <p>没有找到匹配的动作，试试更宽泛的关键词。</p>
          {hasFilter && (
            <button
              className="btn btn-secondary"
              style={{ marginTop: 8 }}
              onClick={() => {
                setQuery('');
                setMuscle('');
                setEquipment('');
              }}
            >
              清空筛选
            </button>
          )}
        </div>
      ) : (
        <div className="exercise-grid">
          {filtered.map((e) => {
            const alreadyAdded = selectedSlugs.includes(e.slug);
            return (
              <div
                key={e.slug}
                className="exercise-card"
                onClick={() => handleSelect(e)}
                style={alreadyAdded ? { opacity: 0.45, pointerEvents: 'none' } : undefined}
              >
                <img src={getAssetPath(e.slug, 1)} alt={e.name} loading="lazy" />
                <div className="exercise-card-info">
                  <div className="exercise-card-name">{exerciseName(e.slug, e.name)}</div>
                  <div className="exercise-card-meta">
                    {muscleName(e.primaryMuscle)} · {equipmentName(e.equipment)}
                  </div>
                </div>
                {!alreadyAdded && (
                  <button className="exercise-card-add" aria-label="添加到训练">
                    <Plus size={14} strokeWidth={3} />
                  </button>
                )}
                {alreadyAdded && (
                  <div className="exercise-card-checked">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
