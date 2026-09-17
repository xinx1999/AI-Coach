import { useState, useMemo, useCallback } from 'react';
import {
  Ruler,
  Weight,
  MapPin,
  Gauge,
  Home,
  User as UserIcon,
  Dumbbell as DumbbellIcon,
  Wrench,
  Sparkles,
  AlertTriangle,
  Info,
  Check,
  RefreshCw,
} from 'lucide-react';
import { generatePlan, type Level, type GeneratedPlan } from '../lib/planner';
import {
  BODYWEIGHT_EQUIPMENT,
  muscleStats,
  countByMuscleAndEquipment,
  countByLocation,
  equipmentAllowed,
  equipmentOptionsByLocation,
  defaultEquipmentFor,
  thumbPath,
  displayName,
  locationTag,
  type LocationTag,
  type Location,
} from '../lib/store';
import type { WorkoutExercise } from '../lib/types';

interface Props {
  /** 计划生成后写入编排页，并跳转过去 */
  onApply: (exercises: WorkoutExercise[]) => void;
}

/** 默认身高体重取常见值，让用户少改两下 */
const DEFAULT_HEIGHT = 170;
const DEFAULT_WEIGHT = 65;

/** 优先展示的常用肌群（其余按动作数量排在后面） */
/** 常用肌群排前面。key 是数据集里的 target 字段值 */
const COMMON_MUSCLES = [
  'pectorals',
  'lats',
  'upper back',
  'delts',
  'quads',
  'hamstrings',
  'glutes',
  'biceps',
  'triceps',
  'abs',
  'calves',
];

/** 场地标签文案。浏览页用「在家/健身房」，这里保持一致，避免两处各叫一套 */
function labelOf(loc: Location): string {
  return loc === 'home' ? '在家' : '健身房';
}

/**
 * 计划结果里那一列场地标签的文案。
 *
 * `both` 是自重动作：两边都能做，标「在家」或「健身房」都是错的。
 * 只用 toLocation 判会让健身房计划里每个俯卧撑都写着「在家」，
 * 用户会以为生成器把场地搞混了。
 */
function tagLabel(tag: LocationTag): string {
  if (tag === 'both') return '自重';
  return labelOf(tag);
}

function tagTitle(tag: LocationTag, current: Location): string {
  if (tag === 'both') return '自重动作，在家和健身房都能做';
  return tag === current
    ? `可在${tag === 'home' ? '家' : '健身房'}完成`
    : `${labelOf(tag)}动作，本次由其他场地补入`;
}


export default function PlanWizard({ onApply }: Props) {
  const [heightCm, setHeightCm] = useState(DEFAULT_HEIGHT);
  const [weightKg, setWeightKg] = useState(DEFAULT_WEIGHT);
  const [muscles, setMuscles] = useState<string[]>([]);
  const [location, setLocation] = useState<Location>('home');
  /**
   * 拥有的器械。初始为「在家 + 自重 + 哑铃」。
   *
   * 惰性初始化而不是 useEffect 同步：切换场地时要整组换掉（在家选哑铃、
   * 去健身房选杠铃），用 effect 同步会出现「先渲染出健身房的器械列表、
   * 再被 effect 改成默认值」的一帧闪烁。
   */
  const [equipment, setEquipment] = useState<string[]>(() => defaultEquipmentFor('home'));
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

  /**
   * 肌群列表：常用部位在前，其余按动作数量降序。
   * 只保留动作数够多的——动作太少的肌群（如颈部 2 个）排进来只会让选择器很乱，
   * 且「颈部计划」本身也没什么意义。
   */
  const muscleOptions = useMemo(() => {
    const rank = (m: string) => {
      const i = COMMON_MUSCLES.indexOf(m);
      return i === -1 ? COMMON_MUSCLES.length : i;
    };
    return [...muscleStats]
      .filter((m) => m.total >= 5)
      .sort((a, b) => {
        const d = rank(a.key) - rank(b.key);
        return d !== 0 ? d : b.total - a.total;
      });
  }, []);

  /** 当前场地下可选的器械（含每个器械的动作数） */
  const equipOptions = useMemo(() => equipmentOptionsByLocation(location), [location]);

  /**
   * 切换场地时整组换掉器械。
   *
   * 不能只是「保留交集」——在家选的哑铃到了健身房全都不适用，
   * 保留下来的空集合会让用户看到一个全未选中的选择器，且生成不出任何动作。
   * 直接换成该场地的默认配置（在家=自重+哑铃，健身房=自重+杠铃）更符合直觉。
   */
  const changeLocation = useCallback((loc: Location) => {
    setLocation(loc);
    setEquipment(defaultEquipmentFor(loc));
    setResult(null);
  }, []);

  const toggleMuscle = useCallback((m: string) => {
    setMuscles((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
    );
    setResult(null);
  }, []);

  /**
   * 器械开关。自重不可取消——它不是什么器械，而是兜底，
   * 取消掉就可能出现「一个动作都排不出来」。所以点击自重时直接忽略。
   */
  const toggleEquipment = useCallback((key: string, isBodyweight: boolean) => {
    if (isBodyweight) return;
    setEquipment((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key],
    );
    setResult(null);
  }, []);

  /** 已选的额外器械数（不含自重），用于标题上的计数提示 */
  const extraEquipCount = equipment.filter((k) => k !== BODYWEIGHT_EQUIPMENT).length;

  const handleGenerate = () => {
    setResult(generatePlan({ heightCm, weightKg, muscles, location, level, equipment }));
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
          <span className="wizard-block-note">决定可选动作范围</span>
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
              onClick={() => changeLocation(key)}
              aria-pressed={location === key}
            >
              {icon} {label}
              {/* 与浏览页的场地标签同口径：该场地一共多少个动作可用 */}
              <span className="wizard-seg-count">{countByLocation(key)} 个动作</span>
            </button>
          ))}
        </div>
      </div>

      {/* ---------- 拥有的器械 ---------- */}
      <div className="wizard-block">
        <div className="wizard-block-head">
          <Wrench size={14} /> 你有哪些器械
          <span className="wizard-block-note">
            {extraEquipCount > 0 ? `已选 ${extraEquipCount} 种 + 自重` : '仅自重'}
          </span>
        </div>
        <div className="wizard-muscles">
          {equipOptions.map(({ key, label, count, isBodyweight }) => {
            const active = isBodyweight || equipment.includes(key);
            return (
              <button
                key={key}
                className={`muscle-chip equip-chip ${active ? 'active' : ''} ${
                  isBodyweight ? 'locked' : ''
                }`}
                onClick={() => toggleEquipment(key, isBodyweight)}
                aria-pressed={active}
                title={
                  isBodyweight
                    ? '自重动作不依赖任何器械，任何地方都能做，因此始终可用'
                    : `${label} · 该场地 ${count} 个动作`
                }
              >
                {active && <Check size={11} />}
                {label}
                <span className="muscle-chip-count">{count}</span>
              </button>
            );
          })}
        </div>
        <p className="wizard-hint">
          <Info size={12} />{' '}
          只勾选你实际拥有的。自重始终可用，不勾也不会影响。
          某项器械没勾时，该器械的动作不会出现在计划里。
        </p>
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
          {muscleOptions.map(({ key, label }) => {
            /**
             * 数量必须跟着器械走。
             * 若仍用旧的 countByMuscle（只按场地），用户会看到「胸大肌 97」
             * 却在只选自重时只拿到几个动作——数字与实际生成结果对不上，
             * 是最容易被投诉的那类不一致。
             */
            const available = countByMuscleAndEquipment(key, location, equipment);
            const active = muscles.includes(key);
            // 该器械组合没有动作时不禁用、但标记出来，点选后由生成器放宽并给出说明
            const unreachable = available === 0;
            return (
              <button
                key={key}
                /*
                 * muscle-chip-target 是给测试与无障碍用的语义标记。
                 *
                 * 器械 chip 为了复用样式也带了 muscle-chip，
                 * 于是 `.muscle-chip` 会同时命中两组（26 个），
                 * `.muscle-chip` 的第一个其实是「自重」器械 —— 测试点它会选不中任何部位，
                 * 屏幕阅读器也分不清这两组。加一个只属于「想练的部位」的类来区分。
                 */
                className={`muscle-chip muscle-chip-target ${active ? 'active' : ''} ${
                  unreachable ? 'unreachable' : ''
                }`}
                onClick={() => toggleMuscle(key)}
                aria-pressed={active}
                title={
                  unreachable
                    ? `${label} 在${location === 'home' ? '家' : '健身房'}没用你选的器械能做的动作，会放宽到该场地其他器械`
                    : `${label} · 当前器械下 ${available} 个动作`
                }
              >
                {active && <Check size={11} />}
                {label}
                <span className="muscle-chip-count">{available}</span>
              </button>
            );
          })}
        </div>
        <p className="wizard-hint">
          <Info size={12} /> 数字表示该部位在你所选器械下可用的动作数，0 表示会放宽到该场地其他器械。
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
              /**
               * 标出动作的场地。
               *
               * 这一列不是装饰：生成器在「该肌群在本场地没有动作」时会回退到另一场地
               * （内收肌在家 0 个、后三角肌全站仅 4 个），此时用户选了「在家」却拿到
               * 一个健身房动作，必须让他一眼看见原因，否则会以为生成器出错了。
               * 与所选场地一致时也标出来，是为了「一致」这件事本身可见。
               *
               * 自重动作走 `both`：它的 home 全为 true，按 toLocation 会一律标成
               * 「在家」，在健身房计划里就是错的。
               */
              const exLoc = locationTag(w.exercise);
              /**
               * 该动作用的器械是否在用户勾选范围内——不在就高亮出来，
               * 别让用户到练的时候才发现没有。
               * 必须走 equipmentAllowed（别名已归一）：用户勾「弹力带」时，
               * `band` 与 `resistance band` 两种写法都算拥有。
               */
              const owned = equipmentAllowed(w.exercise.equipment, equipment);
              return (
                <div key={`${w.slug}-${i}`} className="wizard-plan-item">
                  <span className="wizard-plan-index">{i + 1}</span>
                  <img
                    src={thumbPath(w.exercise) ?? undefined}
                    alt={w.exercise.name}
                    width="40"
                    height="40"
                  />
                  <div className="wizard-plan-info">
                    <div className="wizard-plan-name">
                      {displayName(w.exercise)}
                    </div>
                    <div className="wizard-plan-meta">
                      <span
                        className={`wizard-plan-loc wizard-plan-loc-${exLoc}`}
                        title={tagTitle(exLoc, location)}
                      >
                        {exLoc === 'both' ? (
                          <UserIcon size={11} />
                        ) : exLoc === 'home' ? (
                          <Home size={11} />
                        ) : (
                          <DumbbellIcon size={11} />
                        )}
                        {tagLabel(exLoc)}
                      </span>
                      <span>{w.exercise.targetZh}</span>
                      <span className={owned ? undefined : 'wizard-plan-eq-warn'}>
                        {w.exercise.equipmentZh}
                        {!owned && ' *'}
                      </span>
                      <span>
                        {w.sets.length} 组 ×{' '}
                        {first?.durationSec ? `${first.durationSec} 秒` : `${first?.reps ?? '-'} 次`}
                      </span>
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
