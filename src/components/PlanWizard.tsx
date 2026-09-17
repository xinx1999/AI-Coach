import { useState, useMemo, useCallback } from 'react';
import {
  Ruler,
  Weight,
  MapPin,
  Gauge,
  Home,
  Dumbbell as DumbbellIcon,
  Sparkles,
  AlertTriangle,
  Info,
  Check,
  RefreshCw,
} from 'lucide-react';
import { generatePlan, type Level, type GeneratedPlan } from '../lib/planner';
import { muscleStats, countByMuscle, getAssetPath, type Location } from '../lib/store';
import { muscleName, equipmentName, exerciseName } from '../lib/zh';
import type { WorkoutExercise } from '../lib/types';

interface Props {
  /** 计划生成后写入编排页，并跳转过去 */
  onApply: (exercises: WorkoutExercise[]) => void;
}

/** 默认身高体重取常见值，让用户少改两下 */
const DEFAULT_HEIGHT = 170;
const DEFAULT_WEIGHT = 65;

/** 优先展示的常用肌群（其余按动作数量排在后面） */
const COMMON_MUSCLES = [
  'Chest',
  'Back',
  'Lats',
  'Shoulders',
  'Quads',
  'Hamstrings',
  'Glutes',
  'Biceps',
  'Triceps',
  'Core',
  'Calves',
];

export default function PlanWizard({ onApply }: Props) {
  const [heightCm, setHeightCm] = useState(DEFAULT_HEIGHT);
  const [weightKg, setWeightKg] = useState(DEFAULT_WEIGHT);
  const [muscles, setMuscles] = useState<string[]>([]);
  const [location, setLocation] = useState<Location>('home');
  const [level, setLevel] = useState<Level>('beginner');
  const [result, setResult] = useState<GeneratedPlan | null>(null);

  /** 输入合法性：身高体重必须落在合理区间，否则算出 BMI 会很离谱 */
  const heightValid = heightCm >= 120 && heightCm <= 220;
  const weightValid = weightKg >= 30 && weightKg <= 200;
  const canGenerate = heightValid && weightValid && muscles.length > 0;

  /**
   * 实时 BMI 预览：不必等生成就能看到自己在哪个区间。
   * 与 planner 中的分级保持一致（<18.5 偏瘦 / <24 正常 / <28 超重 / 其余偏胖）。
   */
  const bmiPreview = useMemo(() => {
    if (!heightValid || !weightValid) return null;
    const v = weightKg / (heightCm / 100) ** 2;
    const rounded = Math.round(v * 10) / 10;
    const label = v < 18.5 ? '偏瘦' : v < 24 ? '正常' : v < 28 ? '超重' : '偏胖';
    return { value: rounded, label };
  }, [heightCm, weightKg, heightValid, weightValid]);

  /** 肌群列表：常用部位在前，其余按动作数量降序 */
  const muscleOptions = useMemo(() => {
    const rank = (m: string) => {
      const i = COMMON_MUSCLES.indexOf(m);
      return i === -1 ? COMMON_MUSCLES.length : i;
    };
    return [...muscleStats].sort((a, b) => {
      const d = rank(a.muscle) - rank(b.muscle);
      return d !== 0 ? d : b.total - a.total;
    });
  }, []);

  const toggleMuscle = useCallback((m: string) => {
    setMuscles((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
    );
    setResult(null);
  }, []);

  const handleGenerate = () => {
    setResult(generatePlan({ heightCm, weightKg, muscles, location, level }));
  };

  const handleApply = () => {
    if (!result || result.exercises.length === 0) return;
    onApply(result.exercises);
  };

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <div className="section-row">
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>
          生成训练计划
        </h2>
      </div>
      <p className="wizard-intro">
        填写下面几项，按你的身体数据和场地自动排一份计划，生成后可直接开始训练。
      </p>

      {/* ---------- 身体数据 ---------- */}
      <div className="wizard-block">
        <div className="wizard-block-head">
          <Ruler size={14} /> 身体数据
        </div>
        <div className="wizard-field-row">
          <label className="wizard-field">
            <span className="wizard-field-label">
              <Ruler size={12} /> 身高（cm）
            </span>
            <input
              className={`wizard-input ${heightValid ? '' : 'invalid'}`}
              type="number"
              inputMode="numeric"
              min="120"
              max="220"
              value={heightCm || ''}
              onChange={(e) => {
                setHeightCm(parseInt(e.target.value, 10) || 0);
                setResult(null);
              }}
            />
          </label>
          <label className="wizard-field">
            <span className="wizard-field-label">
              <Weight size={12} /> 体重（kg）
            </span>
            <input
              className={`wizard-input ${weightValid ? '' : 'invalid'}`}
              type="number"
              inputMode="decimal"
              min="30"
              max="200"
              value={weightKg || ''}
              onChange={(e) => {
                setWeightKg(parseFloat(e.target.value) || 0);
                setResult(null);
              }}
            />
          </label>
        </div>

        {bmiPreview ? (
          <div className="bmi-preview">
            <span className="bmi-preview-value">BMI {bmiPreview.value}</span>
            <span className={`bmi-preview-badge bmi-${bmiPreview.label}`}>
              {bmiPreview.label}
            </span>
            <span className="bmi-preview-hint">组数与次数会按此调整</span>
          </div>
        ) : (
          <div className="bmi-preview bmi-preview-error">
            <AlertTriangle size={13} />
            身高需在 120–220cm、体重需在 30–200kg 之间
          </div>
        )}
      </div>

      {/* ---------- 训练场地 ---------- */}
      <div className="wizard-block">
        <div className="wizard-block-head">
          <MapPin size={14} /> 在哪里锻炼
        </div>
        <div className="wizard-seg">
          {(
            [
              { key: 'home' as const, label: '在家', icon: <Home size={14} /> },
              { key: 'gym' as const, label: '健身房', icon: <DumbbellIcon size={14} /> },
            ] as const
          ).map(({ key, label, icon }) => (
            <button
              key={key}
              className={`wizard-seg-btn ${location === key ? 'active' : ''}`}
              onClick={() => {
                setLocation(key);
                setResult(null);
              }}
              aria-pressed={location === key}
            >
              {icon} {label}
            </button>
          ))}
        </div>
      </div>

      {/* ---------- 训练水平 ---------- */}
      <div className="wizard-block">
        <div className="wizard-block-head">
          <Gauge size={14} /> 训练水平
        </div>
        <div className="wizard-seg">
          {(
            [
              { key: 'beginner' as const, label: '新手', hint: '3 组 × 12 次' },
              { key: 'intermediate' as const, label: '进阶', hint: '4 组 × 10 次' },
            ] as const
          ).map(({ key, label, hint }) => (
            <button
              key={key}
              className={`wizard-seg-btn ${level === key ? 'active' : ''}`}
              onClick={() => {
                setLevel(key);
                setResult(null);
              }}
              aria-pressed={level === key}
            >
              {label}
              <span className="wizard-seg-hint">{hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ---------- 想练的部位 ---------- */}
      <div className="wizard-block">
        <div className="wizard-block-head">
          <Sparkles size={14} /> 想练的部位
          <span className="wizard-block-note">
            已选 {muscles.length} 个{muscles.length === 0 && '（至少选 1 个）'}
          </span>
        </div>
        <div className="wizard-muscles">
          {muscleOptions.map(({ muscle }) => {
            const available = countByMuscle(muscle, location);
            const active = muscles.includes(muscle);
            // 该场地没有动作时不禁用、但标记出来，点选后由生成器替换并给出说明
            const unreachable = available === 0;
            return (
              <button
                key={muscle}
                className={`muscle-chip ${active ? 'active' : ''} ${
                  unreachable ? 'unreachable' : ''
                }`}
                onClick={() => toggleMuscle(muscle)}
                aria-pressed={active}
                title={
                  unreachable
                    ? `${muscleName(muscle)} 在${location === 'home' ? '家' : '健身房'}没有可用动作，会改用其他场地动作`
                    : `${muscleName(muscle)} · 该场地 ${available} 个动作`
                }
              >
                {active && <Check size={11} />}
                {muscleName(muscle)}
                <span className="muscle-chip-count">{available}</span>
              </button>
            );
          })}
        </div>
        <p className="wizard-hint">
          <Info size={12} /> 数字表示该部位在当前场地可用的动作数，0 表示会从其他场地补。
        </p>
      </div>

      {/* ---------- 生成按钮 ---------- */}
      <button
        className="btn btn-primary wizard-generate"
        onClick={handleGenerate}
        disabled={!canGenerate}
      >
        <Sparkles size={16} />
        {result ? '重新生成' : '生成计划'}
      </button>

      {/* ---------- 结果预览 ---------- */}
      {result && (
        <div className="wizard-result">
          <div className="wizard-result-head">
            <div>
              <div className="wizard-result-summary">{result.summary}</div>
              <div className="wizard-result-sub">
                共 {result.exercises.reduce((s, w) => s + w.sets.length, 0)} 组
              </div>
            </div>
            <button
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: '7px 12px' }}
              onClick={handleGenerate}
              title="换一批动作"
            >
              <RefreshCw size={12} /> 换一批
            </button>
          </div>

          <div className="wizard-result-advice">
            <span className={`bmi-preview-badge bmi-${result.bmi.label}`}>
              BMI {result.bmi.value} · {result.bmi.label}
            </span>
            <span>{result.bmi.advice}</span>
          </div>

          {result.warnings.length > 0 && (
            <div className="wizard-warnings">
              {result.warnings.map((w) => (
                <div key={w} className="wizard-warning">
                  <AlertTriangle size={12} /> {w}
                </div>
              ))}
            </div>
          )}

          <div className="wizard-plan-list">
            {result.exercises.map((w, i) => {
              const first = w.sets[0];
              return (
                <div key={`${w.slug}-${i}`} className="wizard-plan-item">
                  <span className="wizard-plan-index">{i + 1}</span>
                  <img
                    src={getAssetPath(w.slug, 1)}
                    alt={w.exercise.name}
                    width="40"
                    height="40"
                  />
                  <div className="wizard-plan-info">
                    <div className="wizard-plan-name">
                      {exerciseName(w.slug, w.exercise.name)}
                    </div>
                    <div className="wizard-plan-meta">
                      {muscleName(w.exercise.primaryMuscle)} ·{' '}
                      {equipmentName(w.exercise.equipment)} ·{' '}
                      {w.sets.length} 组 ×{' '}
                      {first?.durationSec ? `${first.durationSec} 秒` : `${first?.reps ?? '-'} 次`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            className="btn btn-primary wizard-apply"
            onClick={handleApply}
            disabled={result.exercises.length === 0}
          >
            <Check size={16} /> 用这份计划（写入编排页）
          </button>
          <p className="wizard-hint" style={{ marginTop: 8, justifyContent: 'center' }}>
            会替换「编排」页现有的动作，之后仍可自由增删调整。
          </p>
        </div>
      )}
    </div>
  );
}
