import { useState, useMemo, useRef } from 'react';
import { Trash2, ChevronDown, ChevronUp, BarChart3, Download, Upload, X, AlertTriangle, Check } from 'lucide-react';
import {
  loadData,
  saveData,
  countSets,
  importBackup,
  downloadBackup,
  type PersistedData,
  type ImportResult,
} from '../lib/store';
import { exerciseName } from '../lib/zh';
import type { WorkoutSession } from '../lib/types';

/**
 * 单次训练容量（kg）。
 * 优先用实际完成值——计划值算出来的是「打算练多少」，不是「练了多少」。
 * 只在用户确实记了实际值时才用它，否则回落到计划值，避免历史记录集体变 0。
 */
function sessionVolume(s: WorkoutSession): number {
  return s.exercises.reduce(
    (sum, w) =>
      sum +
      w.sets.reduce((acc, set) => {
        const reps = set.actualReps ?? set.reps ?? 0;
        const weight = set.actualWeight ?? set.weight ?? 0;
        return acc + reps * weight;
      }, 0),
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

/** 一组历史记录的可读描述，实际值与计划值不同时标出差异 */
function describeSet(set: WorkoutSession['exercises'][number]['sets'][number]): string {
  const parts = [`${set.setNumber}`];
  const reps = set.actualReps ?? set.reps;
  const weight = set.actualWeight ?? set.weight;
  // 时长类只显示秒，避免出现「12 次平板支撑」
  if (set.durationSec) parts.push(`${set.durationSec} 秒`);
  else {
    if (reps) parts.push(`${reps} 次`);
    if (weight) parts.push(`${weight}kg`);
  }
  // 实际值填补了计划值缺失的字段时，用 * 标出「这是实际数据」
  const wasActual = set.actualReps !== undefined || set.actualWeight !== undefined;
  return parts.join(' · ') + (wasActual ? ' *' : '');
}

export default function HistoryView() {
  const [data, setData] = useState<PersistedData>(loadData);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [panel, setPanel] = useState<'none' | 'import'>('none');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [pendingImport, setPendingImport] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

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

  const handleExport = () => {
    downloadBackup();
    setExported(true);
    setTimeout(() => setExported(false), 2500);
  };

  /** 选文件后先读进内存、展示预览，不直接落库——让用户确认后再决定合并还是覆盖 */
  const handleFilePicked = async (file: File) => {
    const text = await file.text();
    setPendingImport(text);
    setImportResult(null);
    setPanel('import');
  };

  /** 打开导入面板时清掉上一次的结果提示，避免旧文案误导 */
  const toggleImportPanel = () => {
    setImportResult(null);
    setPanel(panel === 'import' ? 'none' : 'import');
  };

  const confirmImport = (mode: 'merge' | 'replace') => {
    if (!pendingImport) return;
    const result = importBackup(pendingImport, mode);
    setImportResult(result);
    if (result.ok) {
      setData(loadData());
      setExpanded(null);
    }
    setPendingImport(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  /* ---------- 空状态：仍然要给导出/导入入口 ----------
     用户想「先备份再练」是完全合理的顺序，所以历史为空时不能把功能藏起来。 */
  if (data.sessions.length === 0) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div className="empty-state">
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
        <BackupPanel
          data={data}
          exported={exported}
          onExport={handleExport}
          panel={panel}
          onTogglePanel={toggleImportPanel}
          fileRef={fileRef}
          onFilePicked={handleFilePicked}
          pendingImport={pendingImport}
          onConfirmImport={confirmImport}
          onCancelImport={() => {
            setPendingImport(null);
            if (fileRef.current) fileRef.current.value = '';
          }}
          importResult={importResult}
          hasSessions={false}
        />
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

      <BackupPanel
        data={data}
        exported={exported}
        onExport={handleExport}
        panel={panel}
        onTogglePanel={toggleImportPanel}
        fileRef={fileRef}
        onFilePicked={handleFilePicked}
        pendingImport={pendingImport}
        onConfirmImport={confirmImport}
        onCancelImport={() => {
          setPendingImport(null);
          if (fileRef.current) fileRef.current.value = '';
        }}
        importResult={importResult}
        hasSessions
      />

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
                        {w.sets.map(describeSet).join('  |  ')}
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

/* ---------- 备份面板 ---------- */

interface BackupProps {
  data: PersistedData;
  exported: boolean;
  onExport: () => void;
  panel: 'none' | 'import';
  /** 切换导入面板（同时清掉上一次结果提示） */
  onTogglePanel: () => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onFilePicked: (f: File) => void;
  pendingImport: string | null;
  onConfirmImport: (mode: 'merge' | 'replace') => void;
  onCancelImport: () => void;
  importResult: ImportResult | null;
  hasSessions: boolean;
}

/**
 * 备份面板。
 *
 * 存在的理由：所有数据只躺在 localStorage 里，换手机、清缓存、
 * 或浏览器回收站点数据都会让几个月的记录无声消失。
 * 导出是成本最低的自救通道，所以放在历史页常驻，而不是藏进设置项。
 */
function BackupPanel({
  data,
  exported,
  onExport,
  panel,
  onTogglePanel,
  fileRef,
  onFilePicked,
  pendingImport,
  onConfirmImport,
  onCancelImport,
  importResult,
  hasSessions,
}: BackupProps) {
  // 导入预览：尽量在确认前就把「会进来多少条」摆清楚
  const preview = useMemo(() => {
    if (!pendingImport) return null;
    try {
      const parsed = JSON.parse(pendingImport);
      const arr = Array.isArray(parsed) ? parsed : parsed?.data?.sessions;
      if (!Array.isArray(arr)) return { count: 0, bad: true };
      return { count: arr.length, bad: false };
    } catch {
      return { count: 0, bad: true };
    }
  }, [pendingImport]);

  return (
    <div className="backup-card">
      <div className="backup-head">
        <span className="backup-title">
          <Download size={13} /> 数据备份
        </span>
        <span className="backup-note">
          记录只存在这台设备上，建议定期导出
        </span>
      </div>

      <div className="backup-actions">
        <button className="btn btn-secondary" onClick={onExport} disabled={!hasSessions}>
          {exported ? <Check size={14} /> : <Download size={14} />}
          {exported ? '已导出' : '导出备份'}
        </button>
        <button
          className="btn btn-secondary"
          onClick={onTogglePanel}
        >
          <Upload size={14} /> 导入
        </button>
      </div>

      {/* 导入完成后仍保留文件选择器，方便连续导入多份备份 */}
      {panel === 'import' && !pendingImport && (
        <div className="backup-import">
          <p className="backup-import-hint">
            选择之前导出的 <code>.json</code> 文件。导入会按训练时间自动去重，不会覆盖现有记录。
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="backup-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFilePicked(f);
            }}
          />
        </div>
      )}

      {pendingImport && preview && (
        <div className="backup-import">
          {preview.bad || preview.count === 0 ? (
            <div className="backup-alert">
              <AlertTriangle size={13} />
              这个文件里没有可识别的训练记录，请确认选的是本应用导出的备份。
            </div>
          ) : (
            <>
              <div className="backup-alert ok">
                <Check size={13} />
                读到 {preview.count} 条训练记录，当前已有 {data.sessions.length} 条。
              </div>
              <div className="backup-actions">
                <button className="btn btn-secondary" onClick={onCancelImport}>
                  <X size={14} /> 取消
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => onConfirmImport('merge')}
                  title="保留现有记录，只补充没有的"
                >
                  合并导入
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => onConfirmImport('replace')}
                  title="清空现有记录，完全用备份替换"
                >
                  覆盖导入
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {importResult && (
        <div className={`backup-alert ${importResult.ok ? 'ok' : ''}`}>
          {importResult.ok ? <Check size={13} /> : <AlertTriangle size={13} />}
          {importResult.ok
            ? `导入完成：新增 ${importResult.incoming - importResult.skipped} 条` +
              (importResult.skipped > 0 ? `，跳过 ${importResult.skipped} 条重复` : '') +
              `，共 ${importResult.total} 条。`
            : importResult.error}
        </div>
      )}
    </div>
  );
}
