import React from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { ScoreCategory, Improvement } from '../atsScore';

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

/** "How to raise your score": concrete actions, biggest/most important first, with estimated gain. */
export const ImprovementList: React.FC<{ items: Improvement[] }> = ({ items }) => (
  <section>
    <h4 className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-3">How to raise your score</h4>
    {items.length === 0 ? (
      <p className="text-sm text-stone-500">Nothing left to fix. Your resume covers everything this job asks for.</p>
    ) : (
      <ol className="space-y-2">
        {items.slice(0, 12).map((it, i) => (
          <li key={i} className="flex items-start gap-3 p-3 bg-white border border-stone-100 rounded-2xl">
            <span className="shrink-0 px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-[10px] font-bold tabular-nums">
              +{it.gain}
            </span>
            <span className="text-xs text-stone-700 leading-relaxed">{it.text}</span>
          </li>
        ))}
      </ol>
    )}
  </section>
);
