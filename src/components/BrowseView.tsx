import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Search, X, Home, Dumbbell, LayoutGrid, Star, SlidersHorizontal, ImageOff } from 'lucide-react';
import {
  classifiedExercises,
  thumbPath,
  displayName,
  countByLocation,
  partStats,
  equipmentStats,
  normalizeEquipment,
  equipmentLabel,
  type ClassifiedExercise,
  type Location,
} from '../lib/store';
import ExerciseDetail from './ExerciseDetail';

interface Props {
  onSelect: (ex: ClassifiedExercise) => void;
  selectedSlugs: string[];
  favorites: string[];
  onToggleFavorite: (slug: string) => void;
}

type LocTab = 'all' | Location;

const TABS: { key: LocTab; label: string; icon: typeof Home }[] = [
  { key: 'all', label: '全部', icon: LayoutGrid },
  { key: 'home', label: '在家', icon: Home },
  { key: 'gym', label: '健身房', icon: Dumbbell },
];

/** 一次渲染多少张卡片。1300+ 张同时挂到 DOM 上会明显卡顿 */
const PAGE_SIZE = 60;

/**
 * 卡片缩略图。
 *
 * 这里必须自己兜住加载失败：素材是本地文件，理论上不会 404，
 * 但用户可能是在媒体还没下齐、或静态资源被浏览器清掉的情况下打开，
 * 那时 <img> 会直接显示一个碎图标，整格网格看起来像坏了。
 * 失败就换成与「暂无演示」一致的空态，视觉上至少是完整的一片。
 */
function CardThumb({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="card-media-none">
        <ImageOff size={20} />
        暂无演示
      </div>
    );
  }
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

/**
 * 预建搜索索引。
 *
 * 1318 个动作，每次输入都重算拼接字符串会卡；提前算好一份，
 * 之后搜索只是一次 Map 取值 + includes。
 * 同时收录中英文名、肌群、器械，因为用户可能打「卧推」也可能打「bench」。
 */
const SEARCH_INDEX = new Map(
  classifiedExercises.map((e) => [
    e.slug,
    [
      displayName(e),
      e.name,
      e.targetZh,
      e.target,
      e.muscleGroupZh,
      e.muscleGroup,
      e.equipmentZh,
      e.equipment,
      e.bodyPartZh,
      ...e.secondary.map((m) => m.zh),
      ...e.secondary.map((m) => m.en),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  ]),
);

export default function BrowseView({ onSelect, selectedSlugs, favorites, onToggleFavorite }: Props) {
  const [query, setQuery] = useState('');
  const [part, setPart] = useState('');
  const [equipment, setEquipment] = useState('');
  const [locTab, setLocTab] = useState<LocTab>('all');
  const [favOnly, setFavOnly] = useState(false);
  const [detail, setDetail] = useState<ClassifiedExercise | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [showFilters, setShowFilters] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return classifiedExercises.filter((e) => {
      if (locTab !== 'all' && e.location !== locTab) return false;
      if (favOnly && !favorites.includes(e.slug)) return false;
      if (part && e.bodyPart !== part) return false;
      if (equipment && normalizeEquipment(e.equipment) !== equipment) return false;
      if (q && !SEARCH_INDEX.get(e.slug)?.includes(q)) return false;
      return true;
    });
  }, [query, part, equipment, locTab, favOnly, favorites]);

  // 筛选条件一变就回到第一页，否则会停在上一次的滚动深度上
  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [query, part, equipment, locTab, favOnly]);

  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit]);

  // 无限滚动：哨兵进入视口就加载下一页
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setLimit((n) => (n < filtered.length ? n + PAGE_SIZE : n));
        }
      },
      { rootMargin: '600px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length]);

  const handleAdd = useCallback(
    (e: ClassifiedExercise) => {
      if (!selectedSlugs.includes(e.slug)) onSelect(e);
      setDetail(null);
    },
    [onSelect, selectedSlugs],
  );

  const clearAll = () => {
    setQuery('');
    setPart('');
    setEquipment('');
    setLocTab('all');
    setFavOnly(false);
  };

  const hasFilter = Boolean(query || part || equipment || locTab !== 'all' || favOnly);
  const activeFilterCount = (part ? 1 : 0) + (equipment ? 1 : 0);

  return (
    <div className="browse">
      <div className="browse-head">
        <h2 className="page-title">动作库</h2>
        <span className="page-count">{filtered.length} 个动作</span>
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
        {/* 收藏与场地并列：它是用户自己划出的「常用集合」，不只是筛选条件 */}
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

      <div className="search-row">
        <div className="search-wrap">
          <Search size={16} />
          <input
            className="search-input"
            placeholder="搜索动作、肌群或器械（中英文均可）"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索动作"
          />
          {query && (
            <button
              className="search-clear"
              onClick={() => setQuery('')}
              title="清空"
              aria-label="清空搜索"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {/* 1318 个动作若把 10 个部位 + 30 种器械全铺开会占满整屏，所以收进抽屉 */}
        <button
          className={`filter-toggle ${showFilters ? 'active' : ''}`}
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
        >
          <SlidersHorizontal size={15} />
          筛选
          {activeFilterCount > 0 && <span className="filter-badge">{activeFilterCount}</span>}
        </button>
      </div>

      {showFilters && (
        <div className="filter-panel">
          <div className="filter-group">
            <p className="section-label">部位</p>
            <div className="filter-row">
              <button className={`pill ${!part ? 'active' : ''}`} onClick={() => setPart('')}>
                全部
              </button>
              {partStats.map((p) => (
                <button
                  key={p.key}
                  className={`pill ${part === p.key ? 'active' : ''}`}
                  onClick={() => setPart(p.key)}
                >
                  {p.label}
                  <span className="pill-count">{p.count}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <p className="section-label">器械</p>
            <div className="filter-row">
              <button
                className={`pill ${!equipment ? 'active' : ''}`}
                onClick={() => setEquipment('')}
              >
                全部
              </button>
              {equipmentStats.map((eq) => (
                <button
                  key={eq.key}
                  className={`pill ${equipment === eq.key ? 'active' : ''}`}
                  onClick={() => setEquipment(eq.key)}
                >
                  {eq.label}
                  <span className="pill-count">{eq.count}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty-state">
          <p>没有找到匹配的动作，试试更宽泛的关键词。</p>
          {hasFilter && (
            <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={clearAll}>
              清空筛选
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="exercise-grid">
            {visible.map((e) => {
              const alreadyAdded = selectedSlugs.includes(e.slug);
              const fav = favorites.includes(e.slug);
              const thumb = thumbPath(e);
              return (
                <div
                  key={e.slug}
                  className="exercise-card"
                  onClick={() => setDetail(e)}
                  role="button"
                  tabIndex={0}
                  aria-label={`查看 ${displayName(e)} 详情`}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      setDetail(e);
                    }
                  }}
                >
                  <div className="card-media">
                    <CardThumb src={thumb} alt="" />
                    {/* 星标：独立于卡片点击，避免「想收藏却打开了详情」 */}
                    <button
                      className={`card-fav ${fav ? 'on' : ''}`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onToggleFavorite(e.slug);
                      }}
                      title={fav ? '取消收藏' : '收藏'}
                      aria-pressed={fav}
                      aria-label={fav ? '取消收藏' : '收藏'}
                    >
                      <Star size={13} fill={fav ? 'currentColor' : 'none'} />
                    </button>
                    {alreadyAdded && (
                      <span className="card-added" title="已加入今日训练">
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
                      </span>
                    )}
                  </div>
                  <div className="exercise-card-info">
                    <div className="exercise-card-name">{displayName(e)}</div>
                    <div className="exercise-card-meta">
                      {e.targetZh || e.bodyPartZh}
                      {e.equipmentZh
                        ? ` · ${equipmentLabel(normalizeEquipment(e.equipment), e.equipmentZh)}`
                        : ''}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {limit < filtered.length && (
            <div ref={sentinelRef} className="load-more">
              正在加载更多…（已显示 {visible.length} / {filtered.length}）
            </div>
          )}
          {limit >= filtered.length && filtered.length > PAGE_SIZE && (
            <div className="load-more load-done">已显示全部 {filtered.length} 个动作</div>
          )}
        </>
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
