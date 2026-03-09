
import React, { forwardRef } from 'react';
import { ResumeData } from '../types';
import { abbreviateDate } from '../utils/dateUtils';

interface Props {
  data: ResumeData;
  id?: string;
  isOverPageLimit?: boolean;
  overflowPercentage?: number;
  fontFamily?: string;
  fontSize?: number;
}

export const ResumePreview = forwardRef<HTMLDivElement, Props>(({ data, id, isOverPageLimit, overflowPercentage, fontFamily = "'Times New Roman', Times, serif", fontSize = 11 }, ref) => {
  return (
    <div className="relative">
      {isOverPageLimit && (
        <div className="absolute -top-8 left-0 right-0 flex justify-center z-10">
          <div className="bg-red-100 text-red-700 px-4 py-1 rounded-full text-xs font-bold border border-red-200 flex items-center gap-2 shadow-sm">
            <span className="animate-pulse">●</span>
            Content exceeds one page by {overflowPercentage}%
          </div>
        </div>
      )}

      {/* Page Break Indicator */}
      {isOverPageLimit && (
        <div className="absolute top-[11in] left-0 right-0 border-t-2 border-dashed border-stone-300 pointer-events-none z-20 flex justify-center">
          <span className="bg-stone-200 text-stone-500 text-[10px] px-2 py-0.5 rounded-full -translate-y-1/2 font-bold uppercase tracking-widest">Page 2</span>
        </div>
      )}

      <div 
        id={id}
        ref={ref}
        className={`bg-white text-black p-[0.4in] shadow-lg mx-auto w-[8.5in] min-h-[11in] font-serif leading-tight transition-all relative ${isOverPageLimit ? 'ring-2 ring-red-200' : ''}`}
        style={{ fontFamily: fontFamily, fontSize: `${fontSize}pt` }}
      >
      {/* Heading */}
      <div id="preview-contact" className="text-center mb-4">
        <h1 className="text-[24pt] font-bold uppercase tracking-tight mb-1" style={{ fontVariantCaps: 'small-caps' }}>
          {data.name}
        </h1>
        <div className="text-[10pt]">
          {data.phone} | <a href={`mailto:${data.email}`} className="underline">{data.email}</a> | {' '}
          {data.linkedin && <><a href={`https://${data.linkedin}`} className="underline">{data.linkedin}</a> | </>}
          {data.github && <a href={`https://${data.github}`} className="underline">{data.github}</a>}
        </div>
      </div>

      {/* Education */}
      <section id="preview-education" className="mb-3">
        <h2 className="text-[12pt] font-bold uppercase border-b border-black mb-1 tracking-wider" style={{ fontVariantCaps: 'small-caps' }}>
          Education
        </h2>
        {data.education?.map((edu, i) => (
          <div key={i} className="mb-2">
            <div className="flex justify-between font-bold text-[11pt]">
              <span>{edu.school}</span>
            </div>
            <div className="flex justify-between italic text-[10.5pt]">
              <span>{edu.degree}</span>
              <span>{abbreviateDate(edu.date)}</span>
            </div>
          </div>
        ))}
      </section>

      {/* Skills */}
      <section id="preview-skills" className="mb-3">
        <h2 className="text-[12pt] font-bold uppercase border-b border-black mb-1 tracking-wider" style={{ fontVariantCaps: 'small-caps' }}>
          Technical Skills
        </h2>
        <div className="text-[10pt] space-y-0.5">
          {data.skills.languages && <div><span className="font-bold">Languages:</span> {data.skills.languages}</div>}
          {data.skills.frameworks && <div><span className="font-bold">Frameworks:</span> {data.skills.frameworks}</div>}
          {data.skills.tools && <div><span className="font-bold">Developer Tools:</span> {data.skills.tools}</div>}
          {data.skills.libraries && <div><span className="font-bold">Libraries:</span> {data.skills.libraries}</div>}
        </div>
      </section>

      {/* Experience */}
      <section id="preview-experience" className="mb-3">
        <h2 className="text-[12pt] font-bold uppercase border-b border-black mb-1 tracking-wider" style={{ fontVariantCaps: 'small-caps' }}>
          Experience
        </h2>
        {data.experience?.map((exp, i) => (
          <div key={i} className="mb-2">
            <div className="flex justify-between font-bold text-[11pt]">
              <span>{exp.role}</span>
              <span>{abbreviateDate(exp.date)}</span>
            </div>
            <div className="flex justify-between italic text-[10.5pt] mb-1">
              <span>{exp.company}</span>
            </div>
            <ul className="list-disc list-outside ml-5 text-[10pt] space-y-0.5">
              {exp.bullets.map((bullet, j) => (
                bullet && <li key={j}>{bullet}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* Projects */}
      <section id="preview-projects" className="mb-3">
        <h2 className="text-[12pt] font-bold uppercase border-b border-black mb-1 tracking-wider" style={{ fontVariantCaps: 'small-caps' }}>
          Projects
        </h2>
        {data.projects?.map((proj, i) => (
          <div key={i} className="mb-2">
            <div className="flex justify-between items-baseline text-[11pt] gap-2">
              <div className="flex items-baseline gap-1.5 min-w-0">
                <span className="font-bold shrink-0">{proj.name}</span>
                <span className="text-gray-400">|</span>
                <span className="italic">{proj.tech}</span>
              </div>
              <span className="shrink-0 text-[10.5pt]">{abbreviateDate(proj.date)}</span>
            </div>
            <ul className="list-disc list-outside ml-5 text-[10pt] space-y-0.5 mt-1">
              {proj.bullets.map((bullet, j) => (
                bullet && <li key={j}>{bullet}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* Custom Sections */}
      {data.customSections?.map((section, i) => (
        <section key={i} id={`preview-custom-${i}`} className="mb-3">
          <h2 className="text-[12pt] font-bold uppercase border-b border-black mb-1 tracking-wider" style={{ fontVariantCaps: 'small-caps' }}>
            {section.title}
          </h2>
          {section.items.map((item, j) => (
            <div key={j} className="mb-2">
              <div className="flex justify-between font-bold text-[11pt]">
                <span>{item.title}</span>
                <span>{abbreviateDate(item.date)}</span>
              </div>
              {item.subtitle && (
                <div className="flex justify-between italic text-[10.5pt] mb-1">
                  <span>{item.subtitle}</span>
                </div>
              )}
              <ul className="list-disc list-outside ml-5 text-[10pt] space-y-0.5">
                {item.bullets.map((bullet, k) => (
                  bullet && <li key={k}>{bullet}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
      </div>
    </div>
  );
});

ResumePreview.displayName = 'ResumePreview';
