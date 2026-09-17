import { useState, useMemo, useCallback } from 'react';
import { Search, X, Home, Dumbbell, LayoutGrid, Star } from 'lucide-react';
import { classifiedExercises, getAssetPath, countByLocation, type ClassifiedExercise, type Location } from '../lib/store';
import { exerciseName, equipmentName, muscleName } from '../lib/zh';
import ExerciseDetail from './ExerciseDetail';

interface Props {
  onSelect: (ex: ClassifiedExercise) => void;
  selectedSlugs: string[];
  favorites: string[];
  onToggleFavorite: (slug: string) => void;
}

type LocationTab = 'all' | Location;

const TABS: { key: LocationTab; label: string; icon: typeof Home }[] = [
  { key: 'all', label: '全部', icon: LayoutGrid },
  { key: 'home', label: '在家', icon: Home },
  { key: 'gym', label: '健身房', icon: Dumbbell },
];

const MUSCLES = [...new Set(classifiedExercises.map((e) => e.primaryMuscle))].sort();
const EQUIPMENT = [...new Set(classifiedExercises.map((e) => e.equipment))].sort();

// 每个动作预先算好一份可搜索的中英文字符串，避免每次输入都重算
const SEARCH_INDEX = new Map(
  classifiedExercises.map((e) => [
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

export default function BrowseView({ onSelect, selectedSlugs, favorites, onToggleFavorite }: Props) {
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState('');
  const [equipment, setEquipment] = useState('');
  const [locTab, setLocTab] = useState<LocationTab>('all');
  const [favOnly, setFavOnly] = useState(false);
  const [detail, setDetail] = useState<ClassifiedExercise | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return classifiedExercises.filter((e) => {
      if (locTab !== 'all' && e.location !== locTab) return false;
      if (favOnly && !favorites.includes(e.slug)) return false;
      if (muscle && e.primaryMuscle !== muscle) return false;
      if (equipment && e.equipment !== equipment) return false;
      if (q && !SEARCH_INDEX.get(e.slug)?.includes(q)) return false;
      return true;
    });
  }, [query, muscle, equipment, locTab, favOnly, favorites]);

  const handleAdd = useCallback(
    (e: ClassifiedExercise) => {
      if (!selectedSlugs.includes(e.slug)) onSelect(e);
      setDetail(null);
    },
    [onSelect, selectedSlugs],
  );

  const hasFilter = Boolean(query || muscle || equipment || locTab !== 'all' || favOnly);

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div className="section-row">
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>浏览动作</h2>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{filtered.length} 个动作</span>
      </div>

      {/* 场地分类 */}
      <div className="loc-tabs">
        {TABS.map(({ key, label, icon: Icon }) => {
          const n = key === 'all' ? classifiedExercises.length : countByLocation(key);
          return (
            <button
              key={key}
              className={`loc-tab ${locTab === key ? 'active' : ''}`}
              onClick={() => setLocTab(key)}
            >
              <Icon size={15} />
              <span>{label}</span>
              <span className="loc-tab-count">{n}</span>
            </button>
          );
        })}
        {/* 收藏与场地并列，因为它是用户自己划出的「常用集合」，不只是筛选条件 */}
        {favorites.length > 0 && (
          <button
            className={`loc-tab ${favOnly ? 'active' : ''}`}
            onClick={() => setFavOnly((v) => !v)}
            aria-pressed={favOnly}
          >
            <Star size={15} />
            <span>收藏</span>
            <span className="loc-tab-count">{favorites.length}</span>
          </button>
        )}
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
          <button className="search-clear" onClick={() => setQuery('')} title="清空" aria-label="清空搜索">
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
                setLocTab('all');
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
                onClick={() => setDetail(e)}
                role="button"
                tabIndex={0}
                aria-label={`查看 ${exerciseName(e.slug, e.name)} 详情`}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    setDetail(e);
                  }
                }}
              >
                <img src={getAssetPath(e.slug, 1)} alt={e.name} loading="lazy" />
                {/* 星标：独立于卡片点击，避免「想收藏却打开了详情」 */}
                <button
                  className={`card-fav ${favorites.includes(e.slug) ? 'on' : ''}`}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onToggleFavorite(e.slug);
                  }}
                  title={favorites.includes(e.slug) ? '取消收藏' : '收藏'}
                  aria-pressed={favorites.includes(e.slug)}
                  aria-label={favorites.includes(e.slug) ? '取消收藏' : '收藏'}
                >
                  <Star size={13} fill={favorites.includes(e.slug) ? 'currentColor' : 'none'} />
                </button>
                <div className="exercise-card-info">
                  <div className="exercise-card-name">{exerciseName(e.slug, e.name)}</div>
                  <div className="exercise-card-meta">
                    {muscleName(e.primaryMuscle)} · {equipmentName(e.equipment)}
                  </div>
                </div>
                <span className={`loc-badge ${e.location}`}>
                  {e.location === 'home' ? '在家' : '健身房'}
                </span>
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

      {detail && (
        <ExerciseDetail
          exercise={detail}
          alreadyAdded={selectedSlugs.includes(detail.slug)}
          onAdd={handleAdd}
          onClose={() => setDetail(null)}
          isFavorite={favorites.includes(detail.slug)}
          onToggleFavorite={onToggleFavorite}
        />
      )}
    </div>
  );
}

