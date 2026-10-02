import React from 'react';
import { CheckCircle2, AlertCircle, RefreshCw, Wand2 } from 'lucide-react';
import { ScoreCategory, Improvement } from '../atsScore';
import { BulletRewrite } from '../geminiService';

/** "Why this score": one row per scoring category with points and the reasons behind them. */
export const ScoreBreakdown: React.FC<{ categories: ScoreCategory[]; title?: string }> = ({ categories, title = 'Why this score' }) => (
  <section>
    <h4 className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-3">{title}</h4>
    <ul className="space-y-2">
      {categories.map((c) => {
        const full = c.points >= c.max;
        return (
          <li key={c.id} className="p-4 bg-white border border-stone-100 rounded-2xl">
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="text-sm font-semibold text-stone-800">{c.label}</span>
              <span className={`text-xs font-bold tabular-nums ${full ? 'text-green-600' : 'text-stone-500'}`}>
                {c.points} / {c.max}
              </span>
            </div>
            <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden mb-2">
              <div className={`h-full ${full ? 'bg-green-500' : 'bg-stone-800'}`}
                   style={{ width: `${c.max ? (100 * c.points) / c.max : 0}%` }} />
            </div>
            <ul className="space-y-1">
              {c.checks.map((k, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-stone-600 leading-relaxed">
                  {k.ok
                    ? <CheckCircle2 size={13} className="text-green-500 shrink-0 mt-0.5" />
                    : <AlertCircle size={13} className="text-amber-500 shrink-0 mt-0.5" />}
                  <span>{k.text}</span>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  </section>
);

/** "How to raise your score": only changes the app can make for you, each with a one-click fix. */
export interface ImprovementListProps {
  items: Improvement[];
  rewrites: Record<string, BulletRewrite | 'loading'>;
  busyAll: boolean;
  onAddSkill: (term: string, field: string) => void;
  onPreviewRewrite: (term: string) => void;
  onApplyRewrite: (term: string) => void;
  onDiscardRewrite: (term: string) => void;
  onApplyAll: () => void;
}

export const ImprovementList: React.FC<ImprovementListProps> = ({
  items, rewrites, busyAll, onAddSkill, onPreviewRewrite, onApplyRewrite, onDiscardRewrite, onApplyAll,
}) => (
  <section>
    <div className="flex items-center justify-between mb-3">
      <h4 className="text-xs font-bold uppercase tracking-widest text-stone-400">How to raise your score</h4>
      {items.length > 1 && (
        <button onClick={onApplyAll} disabled={busyAll}
          className="px-3 py-1.5 bg-black text-white rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50">
          {busyAll ? <RefreshCw size={12} className="animate-spin" /> : <Wand2 size={12} />} Apply all
        </button>
      )}
    </div>
    {items.length === 0 ? (
      <p className="text-sm text-stone-500">Nothing left to fix automatically. See "Why this score" below for anything that needs a manual change.</p>
    ) : (
      <ol className="space-y-2">
        {items.slice(0, 20).map((it, i) => {
          const a = it.action;
          const rw = a.kind === 'mention-in-bullet' ? rewrites[a.term] : undefined;
          return (
            <li key={i} className="p-3 bg-white border border-stone-100 rounded-2xl space-y-2">
              <div className="flex items-start gap-3">
                <span className="shrink-0 px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-[10px] font-bold tabular-nums">+{it.gain}</span>
                <span className="flex-1 text-xs text-stone-700 leading-relaxed">{it.text}</span>
                {a.kind === 'add-skill' && (
                  <button onClick={() => onAddSkill(a.term, a.field)}
                    className="shrink-0 px-3 py-1 bg-stone-900 text-white rounded-full text-[10px] font-bold">Add to Skills</button>
                )}
                {a.kind === 'mention-in-bullet' && !rw && (
                  <button onClick={() => onPreviewRewrite(a.term)}
                    className="shrink-0 px-3 py-1 bg-stone-900 text-white rounded-full text-[10px] font-bold">Rewrite a bullet</button>
                )}
                {rw === 'loading' && <RefreshCw size={14} className="shrink-0 animate-spin text-stone-400 mt-0.5" />}
              </div>
              {rw && rw !== 'loading' && (rw.section === 'none' ? (
                <div className="ml-10 text-[11px] text-stone-500">
                  No existing bullet clearly used {rw.term}. Add a bullet about it manually.
                  <button onClick={() => onDiscardRewrite(rw.term)} className="ml-2 underline">Dismiss</button>
                </div>
              ) : (
                <div className="ml-10 space-y-2">
                  <div className="p-2.5 bg-red-50/50 border border-red-100 rounded-xl text-[11px] text-red-700">
                    <span className="font-bold uppercase mr-2 opacity-50">Before:</span>{rw.before}
                  </div>
                  <div className="p-2.5 bg-green-50/50 border border-green-100 rounded-xl text-[11px] text-green-700">
                    <span className="font-bold uppercase mr-2 opacity-50">After:</span>{rw.after}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => onApplyRewrite(rw.term)} className="px-3 py-1 bg-black text-white rounded-full text-[10px] font-bold">Apply</button>
                    <button onClick={() => onDiscardRewrite(rw.term)} className="px-3 py-1 bg-stone-100 text-stone-600 rounded-full text-[10px] font-bold">Discard</button>
                  </div>
                </div>
              ))}
            </li>
          );
        })}
      </ol>
    )}
  </section>
);
