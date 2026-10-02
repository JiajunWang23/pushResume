/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Upload, 
  FileText, 
  Download, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  Sparkles,
  Share2,
  ExternalLink,
  Trash2,
  X,
  Undo2,
  Redo2,
  ArrowRight,
  Link as LinkIcon,
  Type as TypeIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { INITIAL_RESUME, ResumeData, ensureResumeData, Suggestion } from './types';
import { ResumePreview } from './components/ResumePreview';
import { generateLatex } from './latexUtils';
import { parseResume, analyzeResume, optimizeResumeForJD, improveBullet, fetchJobDescriptionFromUrl, extractJdKeywords, JdKeywords, condenseResume, applyCondensePlan, weaveSkillsIntoBullets, BulletRewrite } from './geminiService';
import { computeAtsScore, computeJdMatch, isResumeEmpty, findMissingFields, MissingField } from './atsScore';
import { ScoreBreakdown, ImprovementList, MissingInfoBanner } from './components/ScoreBreakdown';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ExternalHyperlink } from 'docx';
import { saveAs } from 'file-saver';
import { merge, cloneDeep } from 'lodash';

import * as pdfjs from 'pdfjs-dist';
import mammoth from 'mammoth';

// Initialize PDF.js worker
const PDFJS_VERSION = '3.11.174'; // Stable 3.x version
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`;

import { abbreviateDate } from './utils/dateUtils';

const SECTION_ORDER = ['contact', 'education', 'skills', 'experience', 'projects', 'format'];
const SECTION_LABELS: Record<string, string> = {
  contact: 'Contact', education: 'Education', skills: 'Technical Skills',
  experience: 'Experience', projects: 'Projects', format: 'Format & length',
};
const sectionOf = (s: any) => {
  const c = String(s?.category || '').toLowerCase();
  if (c.startsWith('contact')) return 'contact';
  if (c.startsWith('edu')) return 'education';
  if (c.startsWith('skill')) return 'skills';
  if (c.startsWith('exp') || c === 'metrics') return 'experience';
  if (c.startsWith('proj')) return 'projects';
  return 'format';
};
const sortBySection = (list: any[] = []) =>
  [...list].sort((a, b) => SECTION_ORDER.indexOf(sectionOf(a)) - SECTION_ORDER.indexOf(sectionOf(b)));

export default function App() {
  const [resumeData, setResumeData] = useState<ResumeData>(INITIAL_RESUME);
  const [history, setHistory] = useState<ResumeData[]>([cloneDeep(INITIAL_RESUME)]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [fontFamily, setFontFamily] = useState("'Times New Roman', Times, serif");
  const [fontSize, setFontSize] = useState(11);
  const [latexCode, setLatexCode] = useState(generateLatex(INITIAL_RESUME));
  const [isParsing, setIsParsing] = useState(false);
  const [parsingStep, setParsingStep] = useState<string>('');
  const [parsingProgress, setParsingProgress] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  const [jdAnalysis, setJdAnalysis] = useState<any>(null);
  const [jd, setJd] = useState('');
  const [jdUrl, setJdUrl] = useState('');
  const [isFetchingJd, setIsFetchingJd] = useState(false);
  const [jdKeywords, setJdKeywords] = useState<(JdKeywords & { forJd: string }) | null>(null);
  const [activeTab, setActiveTab] = useState<'import' | 'editor' | 'analysis' | 'jd' | 'latex'>('import');
  const [isImprovingBullet, setIsImprovingBullet] = useState<{i: number, j: number} | null>(null);
  const [editingSuggestion, setEditingSuggestion] = useState<{id: string, text: string, suggestedValue?: string} | null>(null);
  const [zoom, setZoom] = useState(0.85);
  const [isOverPageLimit, setIsOverPageLimit] = useState(false);
  const [overflowPercentage, setOverflowPercentage] = useState(0);
  const [isFitting, setIsFitting] = useState(false);
  const [rewrites, setRewrites] = useState<Record<string, BulletRewrite | 'loading'>>({});
  const [isApplyingAll, setIsApplyingAll] = useState(false);

  // Scores are computed from the resume with fixed rules (see atsScore.ts), so they update live,
  // an empty resume scores 0, and every point comes with a reason. Gemini only writes suggestions.
  const atsScore = useMemo(() => computeAtsScore(resumeData, { overPageLimit: isOverPageLimit }), [resumeData, isOverPageLimit]);
  const missingFields = useMemo(() => findMissingFields(resumeData), [resumeData]);
  const flag = (section: string, index: number | undefined, field: string) =>
    missingFields.some((m) => m.section === section && m.index === index && m.field === field);
  const jumpToField = (m: MissingField) => {
    setActiveTab('editor');
    const id = m.index === undefined ? `contact-${m.field}` : `${m.section}-${m.index}-${m.field}`;
    setTimeout(() => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus({ preventScroll: true });
    }, 350);
  };
  const jdMatch = useMemo(() => (jdKeywords ? computeJdMatch(resumeData, jdKeywords) : null), [resumeData, jdKeywords]);
  const [hasApiKey, setHasApiKey] = useState(true);
  
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkApiKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(hasKey);
      }
    };
    checkApiKey();
  }, []);

  const handleOpenKeyDialog = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  const undo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setResumeData(cloneDeep(history[newIndex]));
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setResumeData(cloneDeep(history[newIndex]));
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      const currentHistoryState = history[historyIndex];
      if (JSON.stringify(resumeData) !== JSON.stringify(currentHistoryState)) {
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(cloneDeep(resumeData));
        
        if (newHistory.length > 50) {
          newHistory.shift();
          setHistoryIndex(newHistory.length - 1);
        } else {
          setHistoryIndex(newHistory.length - 1);
        }
        setHistory(newHistory);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [resumeData]);

  const calculateEstimatedHeight = (data: ResumeData) => {
    const margin = 36;
    const pageWidth = 612; // Letter width in pt
    const contentWidth = pageWidth - (margin * 2);
    let totalHeight = margin;

    const estimateTextHeight = (text: string, width: number, fontSize: number = 10) => {
      if (!text) return 0;
      // Very rough estimation: average char width is ~0.5 * fontSize
      const charsPerLine = Math.floor(width / (fontSize * 0.5));
      const lines = Math.ceil(text.length / charsPerLine) || 1;
      return lines * (fontSize + 2);
    };

    // Header
    totalHeight += 25 + 20; // Name + Contact

    // Education
    if (data.education.length > 0) {
      totalHeight += 40; // Section header
      data.education.forEach(() => {
        totalHeight += 12 + 15; // School + Degree/Date
      });
    }

    // Skills
    if (data.skills.languages || data.skills.frameworks || data.skills.tools || data.skills.libraries) {
      totalHeight += 40;
      const skills = [
        { label: 'Languages', value: data.skills.languages },
        { label: 'Frameworks', value: data.skills.frameworks },
        { label: 'Developer Tools', value: data.skills.tools },
        { label: 'Libraries', value: data.skills.libraries }
      ].filter(s => s.value);
      
      skills.forEach(s => {
        totalHeight += estimateTextHeight(s.value, contentWidth - 80); // Subtract label width
      });
    }

    // Experience
    if (data.experience.length > 0) {
      totalHeight += 40;
      data.experience.forEach(exp => {
        totalHeight += 12 + 12; // Role + Company
        exp.bullets.forEach(b => {
          totalHeight += estimateTextHeight(b, contentWidth - 25);
        });
        totalHeight += 8; // Spacer
      });
    }

    // Projects
    if (data.projects.length > 0) {
      totalHeight += 40;
      data.projects.forEach(proj => {
        totalHeight += 12; // Name/Tech/Date
        proj.bullets.forEach(b => {
          totalHeight += estimateTextHeight(b, contentWidth - 25);
        });
        totalHeight += 8; // Spacer
      });
    }

    return totalHeight;
  };

  useEffect(() => {
    const checkHeight = () => {
      if (previewRef.current) {
        const scrollHeight = previewRef.current.scrollHeight;
        const clientHeight = 1056; // 11in * 96dpi
        const isOver = scrollHeight > clientHeight + 2; // Add 2px buffer for rendering differences
        setIsOverPageLimit(isOver);
        if (isOver) {
          setOverflowPercentage(Math.round(((scrollHeight - clientHeight) / clientHeight) * 100));
        } else {
          setOverflowPercentage(0);
        }
      }
    };

    // Initial check
    checkHeight();

    // Use ResizeObserver for real-time monitoring
    const observer = new ResizeObserver(() => {
      checkHeight();
    });

    if (previewRef.current) {
      observer.observe(previewRef.current);
    }

    return () => observer.disconnect();
  }, [resumeData]);

  useEffect(() => {
    setLatexCode(generateLatex(resumeData));
  }, [resumeData]);

  const applySuggestion = (suggestion: Suggestion, type: 'ats' | 'jd' = 'ats') => {
    console.log('Applying suggestion:', suggestion);
    
    let finalProposedChange = { ...suggestion.proposedChange };

    // If suggestedValue was modified, try to update it in the proposedChange object
    if (suggestion.suggestedValue && (suggestion as any).originalSuggestedValue) {
      const oldVal = (suggestion as any).originalSuggestedValue;
      const newVal = suggestion.suggestedValue;
      
      const updateDeep = (obj: any): any => {
        if (typeof obj === 'string') return obj === oldVal ? newVal : obj;
        if (Array.isArray(obj)) return obj.map(updateDeep);
        if (typeof obj === 'object' && obj !== null) {
          const res: any = {};
          for (const k in obj) res[k] = updateDeep(obj[k]);
          return res;
        }
        return obj;
      };
      
      finalProposedChange = updateDeep(finalProposedChange);
    }

    setResumeData(prev => {
      const newData = cloneDeep(prev);
      
      const hasProposedChange = Object.keys(finalProposedChange).length > 0;
      
      if (hasProposedChange) {
        // Custom merge logic for ResumeData to handle arrays better
        const applyDeep = (target: any, source: any) => {
          for (const key in source) {
            if (source[key] === undefined) continue;
            
            if (Array.isArray(source[key])) {
              // For arrays in ResumeData (experience, projects, education), 
              // we usually want to replace them if they are top-level,
              // or handle them specifically if they are nested.
              if (key === 'experience' || key === 'projects' || key === 'education' || key === 'bullets') {
                target[key] = cloneDeep(source[key]);
              } else {
                target[key] = cloneDeep(source[key]);
              }
            } else if (typeof source[key] === 'object' && source[key] !== null) {
              if (!target[key]) target[key] = {};
              applyDeep(target[key], source[key]);
            } else {
              target[key] = source[key];
            }
          }
        };

        applyDeep(newData, finalProposedChange);
      } else if (suggestion.originalValue && suggestion.suggestedValue) {
        // Fallback string replacement
        const replaceDeep = (obj: any): any => {
          if (typeof obj === 'string') {
            // Use global replace if possible, but be careful
            if (obj.includes(suggestion.originalValue!)) {
              return obj.replace(suggestion.originalValue!, suggestion.suggestedValue!);
            }
            return obj;
          }
          if (Array.isArray(obj)) return obj.map(replaceDeep);
          if (typeof obj === 'object' && obj !== null) {
            const res: any = {};
            for (const k in obj) res[k] = replaceDeep(obj[k]);
            return res;
          }
          return obj;
        };
        return replaceDeep(newData);
      }
      
      return newData;
    });

    // Remove the applied suggestion. Scores recompute live from the updated resume.
    const setter = type === 'ats' ? setAnalysis : setJdAnalysis;
    setter((prev: any) => prev ? { ...prev, suggestions: prev.suggestions.filter((s: Suggestion) => s.id !== suggestion.id) } : null);
  };

  const handleImproveBullet = async (i: number, j: number, type: 'experience' | 'projects') => {
    if (!(await checkAndPromptApiKey())) return;
    setIsImprovingBullet({ i, j });
    try {
      const currentBullet = type === 'experience' 
        ? resumeData.experience[i].bullets[j] 
        : resumeData.projects[i].bullets[j];
      
      const improved = await improveBullet(currentBullet, jd || undefined);
      
      setResumeData(prev => {
        const newData = cloneDeep(prev);
        if (type === 'experience') {
          newData.experience[i].bullets[j] = improved;
        } else {
          newData.projects[i].bullets[j] = improved;
        }
        return newData;
      });
    } catch (error) {
      handleApiError(error, 'Bullet improvement');
    } finally {
      setIsImprovingBullet(null);
    }
  };

  const handleApiError = (error: any, context: string) => {
    console.error(`${context} error:`, error);
    const errorMsg = typeof error === 'string' ? error : (error.message || JSON.stringify(error));
    
    // Check for suspended key, 403, or permission denied
    if (
      errorMsg.includes('403') || 
      errorMsg.includes('suspended') || 
      errorMsg.includes('PERMISSION_DENIED') || 
      errorMsg.includes('Permission denied')
    ) {
      if (confirm(`The API key context seems to have permission issues or is suspended. This usually means the default platform key is restricted or your provided key is invalid.\n\nWould you like to open the API key settings to provide a valid key?`)) {
        handleOpenKeyDialog();
      }
      return;
    }

    // Gemini overloaded (503): the service layer already retried and tried a fallback model.
    if (error?.name === 'GeminiBusyError' || /\b503\b|UNAVAILABLE|high demand|overloaded/i.test(errorMsg)) {
      alert(`${context} failed: Google's AI service is overloaded right now. We retried automatically, but it's still busy. Please try again in a minute.`);
      return;
    }

    if (errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('quota')) {
      if (confirm('You have exceeded the API quota. Would you like to set your own API key to continue? (Requires a paid cloud project)')) {
        handleOpenKeyDialog();
      }
    } else {
      alert(`${context} failed: ${errorMsg}`);
    }
  };

  const dismissSuggestion = (suggestionId: string, type: 'ats' | 'jd' = 'ats') => {
    if (type === 'ats') {
      setAnalysis((prev: any) => {
        if (!prev) return null;
        return {
          ...prev,
          suggestions: prev.suggestions.filter((s: Suggestion) => s.id !== suggestionId)
        };
      });
    } else {
      setJdAnalysis((prev: any) => {
        if (!prev) return null;
        return {
          ...prev,
          suggestions: prev.suggestions.filter((s: Suggestion) => s.id !== suggestionId)
        };
      });
    }
  };

  const checkAndPromptApiKey = async (): Promise<boolean> => {
    // Check if we have a key in process.env that isn't a placeholder
    const envKey = process.env.GEMINI_API_KEY;
    const isEnvKeyValid = envKey && envKey !== "MY_GEMINI_API_KEY" && envKey !== "undefined" && envKey.trim() !== "";
    
    if (isEnvKeyValid) return true;

    // Check if user has selected a key in AI Studio
    if (window.aistudio?.hasSelectedApiKey) {
      const platformKey = await window.aistudio.hasSelectedApiKey();
      if (platformKey) return true;
    }

    if (confirm("Gemini API Key is required for this feature. Would you like to provide your own API key in the 'Settings > Secrets' menu? (This will enable resume parsing and analysis)")) {
      handleOpenKeyDialog();
    }
    return false;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    if (!(await checkAndPromptApiKey())) return;
    let file: File | undefined;
    if ('files' in e.target && e.target.files) {
      file = e.target.files[0];
    } else if ('dataTransfer' in e && e.dataTransfer.files) {
      e.preventDefault();
      file = e.dataTransfer.files[0];
    }

    if (!file) return;

    setIsParsing(true);
    setParsingStep('Extracting text from file...');
    setParsingProgress(10);
    try {
      let text = '';
      if (file.type === 'application/pdf') {
        const arrayBuffer = await file.arrayBuffer();
        try {
          const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
          
          setParsingStep(`Processing ${pdf.numPages} pages...`);
          setParsingProgress(20);
          // Parallelize page processing for speed
          const pagePromises = Array.from({ length: pdf.numPages }, (_, i) => i + 1).map(async (pageNum) => {
            const page = await pdf.getPage(pageNum);
            const content = await page.getTextContent();
            
            // Sort items by vertical position (top to bottom) and then horizontal position (left to right)
            const items = content.items as any[];
            items.sort((a, b) => {
              if (Math.abs(a.transform[5] - b.transform[5]) < 5) {
                return a.transform[4] - b.transform[4];
              }
              return b.transform[5] - a.transform[5];
            });

            // Insert a space only where there is a visible gap between text runs. Always adding one
            // turns "real-time" into "real - time"; never adding one glues "Veracity registries".
            let lastY = -1;
            let lastEnd = -1;
            let pageText = '';
            for (const item of items) {
              if (!item.str) continue;
              const x = item.transform[4];
              const fontSize = Math.abs(item.transform[0]) || 10;
              if (lastY !== -1 && Math.abs(item.transform[5] - lastY) > 5) {
                pageText += '\n';
              } else if (lastEnd !== -1 && x - lastEnd > fontSize * 0.15 && !/\s$/.test(pageText) && !/^\s/.test(item.str)) {
                pageText += ' ';
              }
              pageText += item.str;
              lastY = item.transform[5];
              lastEnd = x + (item.width || 0);
            }
            return pageText;
          });

          const pageTexts = await Promise.all(pagePromises);
          text = pageTexts.join('\n\n');
          setParsingProgress(40);

          if (text.trim().length < 100) {
            setParsingStep('Refining text extraction...');
            setParsingProgress(45);
            const simplePagePromises = Array.from({ length: pdf.numPages }, (_, i) => i + 1).map(async (pageNum) => {
              const page = await pdf.getPage(pageNum);
              const content = await page.getTextContent();
              return content.items.map((item: any) => item.str).join(' ');
            });
            const simplePageTexts = await Promise.all(simplePagePromises);
            const simpleText = simplePageTexts.join('\n');
            
            if (simpleText.trim().length > text.trim().length) {
              text = simpleText;
            }
          }
        } catch (pdfError: any) {
          console.error('PDF.js error:', pdfError);
          throw new Error('Failed to extract text from PDF. Please try a different file.');
        }
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        text = result.value;
        setParsingProgress(40);
      } else {
        text = await file.text();
        setParsingProgress(40);
      }

      if (!text.trim()) {
        throw new Error('Could not extract text from file.');
      }

      setParsingStep('AI is analyzing your resume structure...');
      setParsingProgress(50);
      
      // Simulate progress while AI is working
      const progressInterval = setInterval(() => {
        setParsingProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 2;
        });
      }, 500);

      const parsed = await parseResume(text);
      clearInterval(progressInterval);
      
      setParsingStep('Finalizing data...');
      setParsingProgress(95);
      const validated = ensureResumeData(parsed);
      
      if (!validated.name && validated.experience.length === 0 && validated.education.length === 0) {
        throw new Error('AI failed to extract meaningful data. Please ensure the file is a readable resume.');
      }

      setResumeData(validated);
      setParsingProgress(100);
      setTimeout(() => {
        setActiveTab('editor');
      }, 500);
    } catch (error: any) {
      handleApiError(error, 'Parsing');
    } finally {
      setIsParsing(false);
    }
  };

  const handlePasteText = async (text: string) => {
    if (!text.trim()) return;
    if (!(await checkAndPromptApiKey())) return;
    setIsParsing(true);
    setParsingStep('AI is analyzing your text...');
    setParsingProgress(20);
    
    // Simulate progress
    const progressInterval = setInterval(() => {
      setParsingProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + 5;
      });
    }, 400);

    try {
      const parsed = await parseResume(text);
      clearInterval(progressInterval);
      setParsingStep('Finalizing data...');
      setParsingProgress(95);
      const validated = ensureResumeData(parsed);
      setResumeData(validated);
      setParsingProgress(100);
      setTimeout(() => {
        setActiveTab('editor');
      }, 500);
    } catch (error) {
      handleApiError(error, 'Paste parsing');
    } finally {
      setIsParsing(false);
    }
  };

  const handleAnalyze = async () => {
    if (isResumeEmpty(resumeData)) {
      setAnalysis({ suggestions: [], missingKeywords: [] });
      setActiveTab('analysis');
      return;
    }
    if (!(await checkAndPromptApiKey())) return;
    setIsAnalyzing(true);
    try {
      const result = await analyzeResume(resumeData, jd || undefined);
      
      // Filter out timeline/location suggestions
      if (result.suggestions) {
        result.suggestions = result.suggestions.filter((s: any) => {
          const text = (s.text || '').toLowerCase();
          const isTimeline = text.includes('date') || text.includes('timeline') || text.includes('year') || text.includes('month');
          const isLocation = text.includes('location') || text.includes('city') || text.includes('state') || text.includes('address');
          return !isTimeline && !isLocation;
        });
      }
      
      setAnalysis(result);
      setActiveTab('analysis');
    } catch (error) {
      handleApiError(error, 'Analysis');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ---------------- Fit to one page ----------------
  // 1) shrink the font (content untouched), down to MIN_FIT_FONT;
  // 2) if still too long, ask Gemini to tighten/remove bullets (undoable with ↶);
  // 3) grow the font back up as far as it still fits.
  const PAGE_PX = 1056; // 11in at 96dpi, same as the overflow check
  const MIN_FIT_FONT = 10;
  const overflowPx = () => new Promise<number>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() =>
      resolve(previewRef.current ? previewRef.current.scrollHeight - (PAGE_PX + 2) : 0), 60))));

  const fitToOnePage = async () => {
    if (isFitting) return;
    if ((await overflowPx()) <= 0) { alert('Your resume already fits on one page.'); return; }
    setIsFitting(true);
    const originalFont = fontSize;
    let size = fontSize;
    try {
      // Step 1: typography only
      while (size - 0.25 >= MIN_FIT_FONT - 1e-9) {
        size = Math.round((size - 0.25) * 100) / 100;
        setFontSize(size);
        if ((await overflowPx()) <= 0) {
          alert(`Done: fits on one page at ${size}pt. Only the font size changed; your content is untouched.`);
          return;
        }
      }
      // Step 2: content (needs Gemini)
      if (!(await checkAndPromptApiKey())) { setFontSize(originalFont); return; }
      let data = resumeData;
      const before = { bullets: [...data.experience, ...data.projects].reduce((n, e) => n + e.bullets.length, 0), projects: data.projects.length };
      for (let round = 0; round < 2; round++) {
        const over = await overflowPx();
        if (over <= 0) break;
        // bullets are roughly 2/3 of the page, so trim proportionally more than the raw overflow
        const reducePct = (over / PAGE_PX) * 100 * 1.5 + 5;
        const plan = await condenseResume(data, reducePct, jd || undefined);
        data = applyCondensePlan(data, plan);
        setResumeData(data);
      }
      // Step 3: give back font size while it still fits
      while (size + 0.25 <= originalFont + 1e-9) {
        setFontSize(size + 0.25);
        if ((await overflowPx()) > 0) { setFontSize(size); break; }
        size = Math.round((size + 0.25) * 100) / 100;
      }
      const after = { bullets: [...data.experience, ...data.projects].reduce((n, e) => n + e.bullets.length, 0), projects: data.projects.length };
      const fits = (await overflowPx()) <= 0;
      alert(`${fits ? 'Done: fits on one page.' : 'Shortened, but it is still slightly over one page. Run it again or remove a section manually.'}\n\n` +
            `Font: ${size}pt\nBullets: ${before.bullets} → ${after.bullets}` +
            (after.projects !== before.projects ? `\nProjects: ${before.projects} → ${after.projects}` : '') +
            `\n\nBullets were tightened by AI. Review them, or press Undo (↶) to restore the previous version.`);
    } catch (error) {
      setFontSize(originalFont);
      handleApiError(error, 'Fit to one page');
    } finally {
      setIsFitting(false);
    }
  };

  // ---------------- JD Optimizer: one-click fixes ----------------
  const addSkill = (term: string, field: string) => {
    setResumeData((prev) => {
      const key = field as keyof ResumeData['skills'];
      const current = (prev.skills?.[key] || '').trim();
      const exists = current.toLowerCase().split(/[,;]/).map((x) => x.trim()).includes(term.toLowerCase());
      if (exists) return prev;
      return { ...prev, skills: { ...prev.skills, [key]: current ? `${current}, ${term}` : term } };
    });
  };

  const applyRewrite = (rw: BulletRewrite) => {
    if (rw.section === 'none') return;
    setResumeData((prev) => {
      const list = [...(prev[rw.section] as any[])];
      const entry = list[rw.entryIndex];
      if (!entry || entry.bullets[rw.bulletIndex] !== rw.before) return prev; // resume changed since the preview
      const bullets = [...entry.bullets];
      bullets[rw.bulletIndex] = rw.after;
      list[rw.entryIndex] = { ...entry, bullets };
      return { ...prev, [rw.section]: list };
    });
  };

  const previewRewrite = async (term: string) => {
    if (!(await checkAndPromptApiKey())) return;
    setRewrites((r) => ({ ...r, [term]: 'loading' }));
    try {
      const [rw] = await weaveSkillsIntoBullets(resumeData, [term], jd || undefined);
      setRewrites((r) => ({ ...r, [term]: rw || { term, section: 'none', entryIndex: -1, bulletIndex: -1, before: '', after: '' } }));
    } catch (error) {
      setRewrites((r) => { const n = { ...r }; delete n[term]; return n; });
      handleApiError(error, 'Rewriting a bullet');
    }
  };

  const discardRewrite = (term: string) => setRewrites((r) => { const n = { ...r }; delete n[term]; return n; });

  const applyAllImprovements = async () => {
    if (!jdMatch) return;
    const adds = jdMatch.improvements.filter((i) => i.action.kind === 'add-skill');
    const weaves = jdMatch.improvements.filter((i) => i.action.kind === 'mention-in-bullet').map((i) => i.action.term);
    const msg = [
      adds.length ? `Add to Skills: ${adds.map((i) => i.action.term).join(', ')}` : '',
      weaves.length ? `Rewrite bullets to mention: ${weaves.join(', ')}` : '',
    ].filter(Boolean).join('\n\n');
    if (!confirm(`${msg}\n\nOnly add skills you have actually used. You can undo (↶) afterwards.\n\nApply all?`)) return;
    for (const i of adds) if (i.action.kind === 'add-skill') addSkill(i.action.term, i.action.field);
    if (!weaves.length) return;
    if (!(await checkAndPromptApiKey())) return;
    setIsApplyingAll(true);
    try {
      const results = await weaveSkillsIntoBullets(resumeData, weaves, jd || undefined);
      // bullets are replaced in place (never removed), so indexes stay valid; one rewrite per bullet
      const used = new Set<string>();
      for (const rw of results) {
        const k = `${rw.section}:${rw.entryIndex}:${rw.bulletIndex}`;
        if (rw.section !== 'none' && !used.has(k)) { used.add(k); applyRewrite(rw); }
      }
      setRewrites({});
      const skipped = results.filter((r) => r.section === 'none').map((r) => r.term);
      if (skipped.length) alert(`No existing bullet clearly used: ${skipped.join(', ')}. Add a bullet about those manually.`);
    } catch (error) {
      handleApiError(error, 'Apply all');
    } finally {
      setIsApplyingAll(false);
    }
  };

  const handleFetchJd = async () => {
    if (!(await checkAndPromptApiKey())) return;
    setIsFetchingJd(true);
    try {
      const text = await fetchJobDescriptionFromUrl(jdUrl);
      setJd(text);
      setJdAnalysis(null);
    } catch (error: any) {
      if (error?.name === 'JdFetchError') alert(error.message);
      else handleApiError(error, 'Fetching the job posting');
    } finally {
      setIsFetchingJd(false);
    }
  };

  const handleOptimize = async () => {
    if (!jd) {
      alert('Please provide a Job Description first.');
      return;
    }
    if (!(await checkAndPromptApiKey())) return;
    setIsParsing(true);
    try {
      const needKeywords = !jdKeywords || jdKeywords.forJd !== jd;
      const [result, kw] = await Promise.all([
        isResumeEmpty(resumeData) ? Promise.resolve({ suggestions: [] }) : optimizeResumeForJD(resumeData, jd),
        needKeywords ? extractJdKeywords(jd) : Promise.resolve(null),
      ]);
      if (kw) setJdKeywords({ ...kw, forJd: jd });
      
      // Filter out timeline/location suggestions
      if (result.suggestions) {
        result.suggestions = result.suggestions.filter((s: any) => {
          const text = (s.text || '').toLowerCase();
          const isTimeline = text.includes('date') || text.includes('timeline') || text.includes('year') || text.includes('month');
          const isLocation = text.includes('location') || text.includes('city') || text.includes('state') || text.includes('address');
          return !isTimeline && !isLocation;
        });
      }
      
      setJdAnalysis(result);
    } catch (error) {
      handleApiError(error, 'Optimization');
    } finally {
      setIsParsing(false);
    }
  };

  const locateSection = (category: string, suggestion?: Suggestion) => {
    setActiveTab('editor');
    // Use a slightly longer delay to ensure the tab content is rendered
    setTimeout(() => {
      let id = '';
      let cat = category.toLowerCase();

      // Priority: Infer from proposedChange keys for precision
      if (suggestion?.proposedChange) {
        const keys = Object.keys(suggestion.proposedChange);
        if (keys.includes('experience')) id = 'experience-section';
        else if (keys.includes('projects')) id = 'projects-section';
        else if (keys.includes('skills')) id = 'skills-section';
        else if (keys.includes('education')) id = 'education-section';
        else if (keys.includes('name') || keys.includes('email') || keys.includes('phone')) id = 'basic-info-section';
      }

      // Fallback: Use category keyword matching
      if (!id) {
        if (cat.includes('contact') || cat.includes('basic') || cat.includes('info') || cat.includes('header') || cat.includes('name')) id = 'basic-info-section';
        else if (cat.includes('skill') || cat.includes('tech') || cat.includes('tool') || cat.includes('language')) id = 'skills-section';
        else if (cat.includes('edu') || cat.includes('school') || cat.includes('college') || cat.includes('university')) id = 'education-section';
        else if (cat.includes('exp') || cat.includes('work') || cat.includes('job') || cat.includes('professional')) id = 'experience-section';
        else if (cat.includes('proj')) id = 'projects-section';
      }
      
      if (id) {
        const el = document.getElementById(id);
        const container = document.getElementById('editor-container');
        if (el && container) {
          const containerRect = container.getBoundingClientRect();
          const elRect = el.getBoundingClientRect();
          
          // Calculate relative scroll position
          const scrollPos = elRect.top - containerRect.top + container.scrollTop - 20;

          container.scrollTo({
            top: scrollPos,
            behavior: 'smooth'
          });

          el.classList.add('ring-4', 'ring-black', 'ring-offset-4', 'transition-all', 'duration-500');
          setTimeout(() => el.classList.remove('ring-4', 'ring-black', 'ring-offset-4'), 3000);
        } else {
          console.warn(`Element with id ${id} or container not found`);
        }
      }
    }, 150);
  };

  const exportPDF = () => {
    const doc = new jsPDF('p', 'pt', 'letter');
    const margin = 36; // 0.5 inch
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let y = margin;

    const checkPageBreak = (neededHeight: number) => {
      if (y + neededHeight > pageHeight - margin) {
        doc.addPage();
        y = margin;
        return true;
      }
      return false;
    };

    const getPdfFont = () => {
      if (fontFamily.includes('Times New Roman')) return 'times';
      if (fontFamily.includes('Arial') || fontFamily.includes('Helvetica')) return 'helvetica';
      if (fontFamily.includes('Courier')) return 'courier';
      return 'times';
    };

    const pdfFont = getPdfFont();

    const addSection = (title: string) => {
      checkPageBreak(40);
      y += 10;
      doc.setFontSize(fontSize + 1);
      doc.setFont(pdfFont, 'bold');
      doc.text(title.toUpperCase(), margin, y);
      y += 4;
      doc.setLineWidth(0.5);
      doc.line(margin, y, pageWidth - margin, y);
      y += 12;
    };

    // Header
    doc.setFontSize(fontSize * 2.2);
    doc.setFont(pdfFont, 'bold');
    doc.text(resumeData.name, pageWidth / 2, y + 10, { align: 'center' });
    y += 25;
    
    // Contact Info
    const parts = [
      { text: resumeData.phone, link: null },
      { text: resumeData.email, link: `mailto:${resumeData.email}` },
      { text: resumeData.linkedin, link: `https://${resumeData.linkedin}` },
      { text: resumeData.github, link: `https://${resumeData.github}` }
    ].filter(p => p.text);

    doc.setFontSize(fontSize - 2);
    doc.setFont(pdfFont, 'normal');
    const combinedText = parts.map(p => p.text).join(' | ');
    const combinedWidth = doc.getTextWidth(combinedText);
    let currentX = (pageWidth - combinedWidth) / 2;

    parts.forEach((part, index) => {
      if (part.link) {
        doc.setTextColor(0, 0, 255);
        doc.text(part.text, currentX, y);
        doc.link(currentX, y - 7, doc.getTextWidth(part.text), 10, { url: part.link });
        doc.setTextColor(0, 0, 0);
      } else {
        doc.text(part.text, currentX, y);
      }
      currentX += doc.getTextWidth(part.text);
      if (index < parts.length - 1) {
        doc.text(' | ', currentX, y);
        currentX += doc.getTextWidth(' | ');
      }
    });
    
    y += 20;

    // Education
    if (resumeData.education.length > 0) {
      addSection(resumeData.sectionTitles?.education || 'Education');
      resumeData.education.forEach(edu => {
        checkPageBreak(30);
        doc.setFont(pdfFont, 'bold');
        doc.setFontSize(fontSize - 1);
        doc.text(edu.school, margin, y);
        y += 12;
        doc.setFont(pdfFont, 'italic');
        const degreeText = edu.gpa ? `${edu.degree}; GPA: ${edu.gpa}` : edu.degree;
        doc.text(degreeText, margin, y);
        doc.text(abbreviateDate(edu.date), pageWidth - margin, y, { align: 'right' });
        y += 15;
      });
    }

    // Skills
    if (resumeData.skills.languages || resumeData.skills.frameworks || resumeData.skills.tools || resumeData.skills.libraries) {
      addSection(resumeData.sectionTitles?.skills || 'Technical Skills');
      const skills = [
        { label: 'Languages', value: resumeData.skills.languages },
        { label: 'Frameworks', value: resumeData.skills.frameworks },
        { label: 'Developer Tools', value: resumeData.skills.tools },
        { label: 'Libraries', value: resumeData.skills.libraries }
      ].filter(s => s.value);

      skills.forEach(skill => {
        const label = `${skill.label}: `;
        doc.setFont(pdfFont, 'bold');
        doc.setFontSize(fontSize - 1);
        const labelWidth = doc.getTextWidth(label);
        
        // Combine label and value to split correctly
        const fullText = label + skill.value;
        const lines = doc.splitTextToSize(fullText, pageWidth - (margin * 2));
        
        checkPageBreak(lines.length * 12);
        
        lines.forEach((line: string, index: number) => {
          if (index === 0) {
            // First line: render label in bold, then rest in normal
            doc.setFont(pdfFont, 'bold');
            doc.text(label, margin, y);
            doc.setFont(pdfFont, 'normal');
            // The rest of the first line
            const restOfFirstLine = line.substring(label.length);
            doc.text(restOfFirstLine, margin + labelWidth, y);
          } else {
            // Subsequent lines: render entirely in normal at margin
            doc.setFont(pdfFont, 'normal');
            doc.text(line, margin, y);
          }
          y += 12;
        });
      });
      y += 5;
    }

    // Experience
    if (resumeData.experience.length > 0) {
      addSection(resumeData.sectionTitles?.experience || 'Experience');
      resumeData.experience.forEach(exp => {
        checkPageBreak(40);
        doc.setFont(pdfFont, 'bold');
        doc.setFontSize(fontSize - 1);
        doc.text(exp.role, margin, y);
        doc.text(abbreviateDate(exp.date), pageWidth - margin, y, { align: 'right' });
        y += 12;
        doc.setFont(pdfFont, 'italic');
        doc.text(exp.company, margin, y);
        y += 12;
        
        doc.setFont(pdfFont, 'normal');
        exp.bullets.forEach(bullet => {
          if (!bullet) return;
          const lines = doc.splitTextToSize(bullet, pageWidth - (margin * 2) - 25);
          checkPageBreak(lines.length * 12);
          doc.text('•', margin + 10, y);
          // Render each line individually to avoid character spacing issues
          lines.forEach((line: string, index: number) => {
            doc.text(line, margin + 20, y + (index * 12));
          });
          y += (lines.length * 12);
        });
        y += 8;
      });
    }

    // Projects
    if (resumeData.projects.length > 0) {
      addSection(resumeData.sectionTitles?.projects || 'Projects');
      resumeData.projects.forEach(proj => {
        checkPageBreak(40);
        doc.setFont(pdfFont, 'bold');
        doc.setFontSize(fontSize - 1);
        
        if (proj.link) {
          const linkUrl = proj.link.startsWith('http') ? proj.link : `https://${proj.link}`;
          doc.setTextColor(0, 0, 255);
          doc.text(proj.name, margin, y);
          const nameWidth = doc.getTextWidth(proj.name);
          doc.link(margin, y - 7, nameWidth, 10, { url: linkUrl });
          // Draw underline
          doc.setDrawColor(0, 0, 255);
          doc.line(margin, y + 1, margin + nameWidth, y + 1);
          doc.setTextColor(0, 0, 0);
          doc.setDrawColor(0, 0, 0);
        } else {
          doc.text(proj.name, margin, y);
        }
        
        const nameWidth = doc.getTextWidth(proj.name);
        doc.setFont(pdfFont, 'normal');
        doc.text(' | ', margin + nameWidth, y);
        const pipeWidth = doc.getTextWidth(' | ');
        doc.setFont(pdfFont, 'italic');
        doc.text(proj.tech, margin + nameWidth + pipeWidth, y);
        doc.setFont(pdfFont, 'normal');
        doc.text(abbreviateDate(proj.date), pageWidth - margin, y, { align: 'right' });
        y += 12;

        proj.bullets.forEach(bullet => {
          if (!bullet) return;
          const lines = doc.splitTextToSize(bullet, pageWidth - (margin * 2) - 25);
          checkPageBreak(lines.length * 12);
          doc.text('•', margin + 10, y);
          lines.forEach((line: string, index: number) => {
            doc.text(line, margin + 20, y + (index * 12));
          });
          y += (lines.length * 12);
        });
        y += 8;
      });
    }

    const downloadLink = doc.output('bloburl');
    window.open(downloadLink, '_blank');
  };

  const openInOverleaf = () => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = 'https://www.overleaf.com/docs';
    form.target = '_blank';

    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'snip';
    input.value = latexCode;

    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      alert('App link copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F4] text-[#1C1917] font-sans">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-black rounded-2xl flex items-center justify-center text-white shadow-xl transform -rotate-2 hover:rotate-0 transition-all duration-500 group cursor-pointer">
              <svg 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2.5" 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                className="w-6 h-6 group-hover:scale-110 transition-transform"
              >
                {/* Stylized P that is also an arrow */}
                <path d="M7 21V3h7a5 5 0 0 1 0 10H7" />
                <path d="M14 8l3-3m0 0h-3m3 0v3" className="text-white/80" />
              </svg>
            </div>
            <h1 className="font-bold text-xl leading-none">PushResume</h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 bg-stone-100 p-1 rounded-full">
              <button 
                onClick={undo}
                disabled={historyIndex === 0}
                className="p-1.5 hover:bg-white rounded-full transition-all disabled:opacity-30 disabled:hover:bg-transparent"
                title="Undo"
              >
                <Undo2 size={16} />
              </button>
              <button 
                onClick={redo}
                disabled={historyIndex === history.length - 1}
                className="p-1.5 hover:bg-white rounded-full transition-all disabled:opacity-30 disabled:hover:bg-transparent"
                title="Redo"
              >
                <Redo2 size={16} />
              </button>
            </div>

            <div className="h-6 w-px bg-stone-200" />

            <div className="flex items-center gap-2 bg-stone-100 px-3 py-1.5 rounded-full">
              <TypeIcon size={14} className="text-stone-500" />
              <select 
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="bg-transparent text-sm font-medium focus:outline-none cursor-pointer"
              >
                <option value="'Times New Roman', Times, serif">Times New Roman</option>
                <option value="Arial, Helvetica, sans-serif">Arial</option>
                <option value="'Georgia', serif">Georgia</option>
                <option value="'Helvetica Neue', Helvetica, Arial, sans-serif">Helvetica</option>
                <option value="'Courier New', Courier, monospace">Courier New</option>
                <option value="'Garamond', serif">Garamond</option>
              </select>
            </div>

            <div className="h-6 w-px bg-stone-200" />

            <div className="flex items-center gap-2 bg-stone-100 px-3 py-1.5 rounded-full">
              <span className="text-[10px] font-bold text-stone-400 uppercase">Size</span>
              <input 
                type="range" 
                min="8" 
                max="16" 
                step="0.5"
                value={fontSize}
                onChange={(e) => setFontSize(parseFloat(e.target.value))}
                className="w-20 h-1 bg-stone-200 rounded-lg appearance-none cursor-pointer accent-black"
              />
              <span className="text-xs font-medium w-8 text-center">{fontSize}pt</span>
            </div>

            <div className="h-6 w-px bg-stone-200" />

            <label className="flex items-center gap-2 px-4 py-2 bg-stone-100 hover:bg-stone-200 rounded-full cursor-pointer transition-colors text-sm font-medium">
              <Upload size={16} />
              <span>Upload Resume</span>
              <input type="file" className="hidden" onChange={handleFileUpload} accept=".txt,.pdf,.docx" />
            </label>
            
            <div className="h-6 w-px bg-stone-200 mx-2" />

            <div className="flex bg-stone-100 p-1 rounded-full">
              <div className="flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium bg-white shadow-sm text-black">
                <FileText size={14} />
                Preview
              </div>
            </div>

            <div className="flex items-center gap-2">
              {!hasApiKey && (
                <button 
                  onClick={handleOpenKeyDialog}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-full border border-amber-100 hover:bg-amber-100 transition-colors text-xs font-bold"
                >
                  <AlertCircle size={14} />
                  API Settings
                </button>
              )}
              {isOverPageLimit && (
                <div className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-full border border-red-100 animate-pulse mr-2">
                  <AlertCircle size={16} />
                  <span className="text-xs font-bold">Exceeds 1 Page by {overflowPercentage}%</span>
                </div>
              )}
              {(isOverPageLimit || isFitting) && (
                <button
                  onClick={fitToOnePage}
                  disabled={isFitting}
                  title="Shrink the font first; if that's not enough, AI tightens your bullets (undoable)"
                  className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-full text-xs font-bold mr-2 disabled:opacity-60"
                >
                  {isFitting ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {isFitting ? 'Fitting…' : 'Fit to 1 page'}
                </button>
              )}
              
              <div className="flex items-center gap-2 bg-black text-white rounded-full px-1 py-1 shadow-lg">
                <button 
                  onClick={exportPDF}
                  className="flex items-center gap-2 px-6 py-2 hover:bg-white/10 rounded-full transition-colors text-sm font-medium"
                >
                  <Download size={16} />
                  Download PDF
                </button>
                <div className="w-px h-4 bg-white/20" />
                <button 
                  onClick={openInOverleaf}
                  className="flex items-center gap-2 px-6 py-2 hover:bg-white/10 rounded-full transition-colors text-sm font-medium"
                  title="Open in Overleaf"
                >
                  Open in Overleaf
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto p-6 grid grid-cols-12 gap-6 h-[calc(100vh-80px)]">
        {/* Left Panel: Editor & Analysis */}
        <div className="col-span-12 lg:col-span-5 flex flex-col gap-6 overflow-hidden">
          <div className="bg-white rounded-3xl border border-stone-200 flex flex-col overflow-hidden shadow-sm flex-1">
            <div className="flex border-b border-stone-100 p-2">
              <button 
                onClick={() => setActiveTab('import')}
                className={`flex-1 py-3 text-sm font-semibold rounded-2xl transition-all ${activeTab === 'import' ? 'bg-stone-50 text-black' : 'text-stone-400 hover:text-stone-600'}`}
              >
                Import
              </button>
              <button 
                onClick={() => setActiveTab('editor')}
                className={`flex-1 py-3 text-sm font-semibold rounded-2xl transition-all ${activeTab === 'editor' ? 'bg-stone-50 text-black' : 'text-stone-400 hover:text-stone-600'}`}
              >
                Editor
              </button>
              <button 
                onClick={() => setActiveTab('analysis')}
                className={`flex-1 py-3 text-sm font-semibold rounded-2xl transition-all ${activeTab === 'analysis' ? 'bg-stone-50 text-black' : 'text-stone-400 hover:text-stone-600'}`}
              >
                ATS Analysis
              </button>
              <button 
                onClick={() => setActiveTab('jd')}
                className={`flex-1 py-3 text-sm font-semibold rounded-2xl transition-all ${activeTab === 'jd' ? 'bg-stone-50 text-black' : 'text-stone-400 hover:text-stone-600'}`}
              >
                JD Optimizer
              </button>
              <button 
                onClick={() => setActiveTab('latex')}
                className={`flex-1 py-3 text-sm font-semibold rounded-2xl transition-all ${activeTab === 'latex' ? 'bg-stone-50 text-black' : 'text-stone-400 hover:text-stone-600'}`}
              >
                LaTeX
              </button>
            </div>

            <div id="editor-container" className="flex-1 overflow-y-auto p-6">
              <AnimatePresence mode="wait">
                {activeTab === 'import' && (
                  <motion.div 
                    key="import"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-8"
                  >
                    <div className="text-center py-10">
                      <div className="w-20 h-20 bg-black rounded-3xl flex items-center justify-center text-white shadow-2xl mb-6 mx-auto">
                        <svg 
                          viewBox="0 0 24 24" 
                          fill="none" 
                          stroke="currentColor" 
                          strokeWidth="2.5" 
                          strokeLinecap="round" 
                          strokeLinejoin="round" 
                          className="w-10 h-10"
                        >
                          <path d="M7 21V3h7a5 5 0 0 1 0 10H7" />
                          <path d="M14 8l3-3m0 0h-3m3 0v3" className="text-white/80" />
                        </svg>
                      </div>
                      <h2 className="text-3xl font-bold">PushResume</h2>
                      <p className="text-stone-500 max-w-xs mx-auto mt-2">Free Resume Review. Professional LaTeX-style resume builder with ATS scoring and JD optimization.</p>
                    </div>

                    <div 
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={handleFileUpload}
                      className="border-2 border-dashed border-stone-200 rounded-3xl p-12 text-center hover:border-black transition-colors group cursor-pointer"
                      onClick={() => document.getElementById('file-upload-main')?.click()}
                    >
                      <div className="w-16 h-16 bg-stone-50 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:bg-black group-hover:text-white transition-all">
                        <Upload size={32} />
                      </div>
                      <h3 className="font-bold text-lg">Upload your resume</h3>
                      <p className="text-sm text-stone-500 mt-2">Drag and drop PDF, DOCX, or TXT files</p>
                      <input 
                        id="file-upload-main"
                        type="file" 
                        className="hidden" 
                        onChange={handleFileUpload} 
                        accept=".txt,.pdf,.docx" 
                      />
                    </div>

                    <div className="space-y-4">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400">Or paste your resume text</h3>
                      <textarea 
                        id="paste-text"
                        placeholder="Paste your resume content here..."
                        className="w-full h-64 p-4 bg-stone-50 border border-stone-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all text-sm leading-relaxed resize-none"
                      />
                      <button 
                        onClick={() => {
                          const text = (document.getElementById('paste-text') as HTMLTextAreaElement).value;
                          handlePasteText(text);
                        }}
                        className="w-full py-4 bg-black text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-stone-800 transition-all"
                      >
                        <Sparkles size={18} />
                        Parse Pasted Text
                      </button>
                    </div>
                  </motion.div>
                )}

                {activeTab === 'editor' && (
                  <motion.div 
                    key="editor"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-8"
                  >
                    <MissingInfoBanner items={missingFields} onJump={jumpToField} />
                    {/* Basic Info */}
                    <section id="basic-info-section">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-4">Basic Information</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-stone-500 ml-1">Full Name</label>
                          <input 
                            value={resumeData.name}
                            onChange={(e) => setResumeData({...resumeData, name: e.target.value})}
                            id="contact-name"
                            className={`w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all ${flag('contact', undefined, 'name') ? '!border-amber-400 !bg-amber-50' : ''}`}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-stone-500 ml-1">Phone</label>
                          <input 
                            value={resumeData.phone}
                            onChange={(e) => setResumeData({...resumeData, phone: e.target.value})}
                            id="contact-phone"
                            className={`w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all ${flag('contact', undefined, 'phone') ? '!border-amber-400 !bg-amber-50' : ''}`}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-stone-500 ml-1">Email</label>
                          <input 
                            value={resumeData.email}
                            onChange={(e) => setResumeData({...resumeData, email: e.target.value})}
                            id="contact-email"
                            className={`w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all ${flag('contact', undefined, 'email') ? '!border-amber-400 !bg-amber-50' : ''}`}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-stone-500 ml-1">LinkedIn</label>
                          <input 
                            value={resumeData.linkedin}
                            onChange={(e) => setResumeData({...resumeData, linkedin: e.target.value})}
                            className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-stone-500 ml-1">GitHub</label>
                          <input 
                            value={resumeData.github}
                            onChange={(e) => setResumeData({...resumeData, github: e.target.value})}
                            className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all"
                          />
                        </div>
                      </div>
                    </section>

                    {/* Skills */}
                    <section id="skills-section">
                      <div className="flex items-center gap-4 mb-4">
                        <input 
                          value={resumeData.sectionTitles?.skills}
                          onChange={(e) => setResumeData({...resumeData, sectionTitles: {...resumeData.sectionTitles!, skills: e.target.value}})}
                          className="text-xs font-bold uppercase tracking-widest text-stone-400 bg-transparent border-b border-transparent hover:border-stone-200 focus:border-black focus:text-black outline-none transition-all w-fit"
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-4">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-stone-500 ml-1">Languages</label>
                          <input 
                            value={resumeData.skills.languages}
                            onChange={(e) => setResumeData({...resumeData, skills: {...resumeData.skills, languages: e.target.value}})}
                            className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-stone-500 ml-1">Frameworks</label>
                          <input 
                            value={resumeData.skills.frameworks}
                            onChange={(e) => setResumeData({...resumeData, skills: {...resumeData.skills, frameworks: e.target.value}})}
                            className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-stone-500 ml-1">Developer Tools</label>
                          <input 
                            value={resumeData.skills.tools}
                            onChange={(e) => setResumeData({...resumeData, skills: {...resumeData.skills, tools: e.target.value}})}
                            className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-stone-500 ml-1">Libraries</label>
                          <input 
                            value={resumeData.skills.libraries}
                            onChange={(e) => setResumeData({...resumeData, skills: {...resumeData.skills, libraries: e.target.value}})}
                            className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all"
                          />
                        </div>
                      </div>
                    </section>

                    {/* Education */}
                    <section id="education-section">
                      <div className="flex justify-between items-center mb-4">
                        <input 
                          value={resumeData.sectionTitles?.education}
                          onChange={(e) => setResumeData({...resumeData, sectionTitles: {...resumeData.sectionTitles!, education: e.target.value}})}
                          className="text-xs font-bold uppercase tracking-widest text-stone-400 bg-transparent border-b border-transparent hover:border-stone-200 focus:border-black focus:text-black outline-none transition-all w-fit"
                        />
                        <div className="flex gap-4">
                          <button 
                            onClick={() => setResumeData(INITIAL_RESUME)}
                            className="text-xs font-bold text-stone-400 hover:text-black"
                          >
                            Reset to Sample
                          </button>
                          <button 
                            onClick={() => setResumeData({
                              ...INITIAL_RESUME,
                              name: "", phone: "", email: "", linkedin: "", github: "",
                              education: [], skills: { languages: "", frameworks: "", tools: "", libraries: "" },
                              experience: [], projects: []
                            })}
                            className="text-xs font-bold text-red-400 hover:text-red-600"
                          >
                            Clear All
                          </button>
                          <button 
                            onClick={() => setResumeData({
                              ...resumeData, 
                              education: [...resumeData.education, { school: '', degree: '', date: '' }]
                            })}
                            className="text-xs font-bold text-black hover:underline"
                          >
                            + Add Education
                          </button>
                        </div>
                      </div>
                      {resumeData.education.map((edu, i) => (
                        <div key={i} className="p-4 bg-stone-50 border border-stone-200 rounded-2xl mb-4 relative group">
                          <button 
                            onClick={() => setResumeData({
                              ...resumeData, 
                              education: resumeData.education.filter((_, idx) => idx !== i)
                            })}
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 text-stone-400 hover:text-red-500 transition-all"
                          >
                            <X size={14} />
                          </button>
                          <div className="grid grid-cols-2 gap-3">
                            <input 
                              placeholder="School"
                              value={edu.school}
                              onChange={(e) => {
                                const newEdu = [...resumeData.education];
                                newEdu[i].school = e.target.value;
                                setResumeData({...resumeData, education: newEdu});
                              }}
                              id={`education-${i}-school`}
                              className={`col-span-2 px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm ${flag('education', i, 'school') ? '!border-amber-400 !bg-amber-50' : ''}`}
                            />
                            <input 
                              placeholder="Degree"
                              value={edu.degree}
                              onChange={(e) => {
                                const newEdu = [...resumeData.education];
                                newEdu[i].degree = e.target.value;
                                setResumeData({...resumeData, education: newEdu});
                              }}
                              id={`education-${i}-degree`}
                              className={`px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm ${flag('education', i, 'degree') ? '!border-amber-400 !bg-amber-50' : ''}`}
                            />
                            <input 
                              placeholder="Date (e.g. Aug. 2018 -- May 2021)"
                              value={edu.date}
                              onChange={(e) => {
                                const newEdu = [...resumeData.education];
                                newEdu[i].date = e.target.value;
                                setResumeData({...resumeData, education: newEdu});
                              }}
                              id={`education-${i}-date`}
                              className={`px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm ${flag('education', i, 'date') ? '!border-amber-400 !bg-amber-50' : ''}`}
                            />
                            <input 
                              placeholder="GPA (e.g. 3.9/4.0)"
                              value={edu.gpa || ''}
                              onChange={(e) => {
                                const newEdu = [...resumeData.education];
                                newEdu[i].gpa = e.target.value;
                                setResumeData({...resumeData, education: newEdu});
                              }}
                              className="col-span-2 px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm"
                            />
                          </div>
                        </div>
                      ))}
                    </section>

                    {/* Experience */}
                    <section id="experience-section">
                      <div className="flex justify-between items-center mb-4">
                        <input 
                          value={resumeData.sectionTitles?.experience}
                          onChange={(e) => setResumeData({...resumeData, sectionTitles: {...resumeData.sectionTitles!, experience: e.target.value}})}
                          className="text-xs font-bold uppercase tracking-widest text-stone-400 bg-transparent border-b border-transparent hover:border-stone-200 focus:border-black focus:text-black outline-none transition-all w-fit"
                        />
                        <button 
                          onClick={() => setResumeData({
                            ...resumeData, 
                            experience: [...resumeData.experience, { role: '', company: '', date: '', bullets: [''] }]
                          })}
                          className="text-xs font-bold text-black hover:underline"
                        >
                          + Add Experience
                        </button>
                      </div>
                      {resumeData.experience.map((exp, i) => (
                        <div key={i} className="p-4 bg-stone-50 border border-stone-200 rounded-2xl mb-4 relative group">
                          <button 
                            onClick={() => setResumeData({
                              ...resumeData, 
                              experience: resumeData.experience.filter((_, idx) => idx !== i)
                            })}
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 text-stone-400 hover:text-red-500 transition-all"
                          >
                            <X size={14} />
                          </button>
                          <div className="grid grid-cols-2 gap-3 mb-3">
                            <input 
                              placeholder="Role"
                              value={exp.role}
                              onChange={(e) => {
                                const newExp = [...resumeData.experience];
                                newExp[i].role = e.target.value;
                                setResumeData({...resumeData, experience: newExp});
                              }}
                              id={`experience-${i}-role`}
                              className={`px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm font-bold ${flag('experience', i, 'role') ? '!border-amber-400 !bg-amber-50' : ''}`}
                            />
                            <input 
                              placeholder="Company"
                              value={exp.company}
                              onChange={(e) => {
                                const newExp = [...resumeData.experience];
                                newExp[i].company = e.target.value;
                                setResumeData({...resumeData, experience: newExp});
                              }}
                              id={`experience-${i}-company`}
                              className={`px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm ${flag('experience', i, 'company') ? '!border-amber-400 !bg-amber-50' : ''}`}
                            />
                            <input 
                              placeholder="Date"
                              value={exp.date}
                              onChange={(e) => {
                                const newExp = [...resumeData.experience];
                                newExp[i].date = e.target.value;
                                setResumeData({...resumeData, experience: newExp});
                              }}
                              id={`experience-${i}-date`}
                              className={`px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm ${flag('experience', i, 'date') ? '!border-amber-400 !bg-amber-50' : ''}`}
                            />
                          </div>
                          <div className="space-y-2">
                            {exp.bullets.map((bullet, j) => (
                              <div key={j} className="relative group/bullet">
                                <textarea 
                                  value={bullet}
                                  onChange={(e) => {
                                    const newExp = [...resumeData.experience];
                                    newExp[i].bullets[j] = e.target.value;
                                    setResumeData({...resumeData, experience: newExp});
                                  }}
                                  className="w-full px-3 py-2 bg-white border border-stone-200 rounded-lg text-xs leading-relaxed min-h-[60px] pr-10"
                                  placeholder="Achievement bullet point..."
                                />
                                <button 
                                  onClick={() => handleImproveBullet(i, j, 'experience')}
                                  disabled={isImprovingBullet?.i === i && isImprovingBullet?.j === j}
                                  className="absolute top-2 right-2 p-1.5 bg-stone-50 hover:bg-black hover:text-white rounded-lg transition-all opacity-0 group-hover/bullet:opacity-100 disabled:opacity-50"
                                  title="AI Improve"
                                >
                                  {isImprovingBullet?.i === i && isImprovingBullet?.j === j ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                </button>
                              </div>
                            ))}
                            <button 
                              onClick={() => {
                                const newExp = [...resumeData.experience];
                                newExp[i].bullets.push('');
                                setResumeData({...resumeData, experience: newExp});
                              }}
                              className="text-[10px] font-bold text-stone-400 hover:text-black"
                            >
                              + Add Bullet
                            </button>
                          </div>
                        </div>
                      ))}
                    </section>

                    {/* Projects */}
                    <section id="projects-section">
                      <div className="flex justify-between items-center mb-4">
                        <input 
                          value={resumeData.sectionTitles?.projects}
                          onChange={(e) => setResumeData({...resumeData, sectionTitles: {...resumeData.sectionTitles!, projects: e.target.value}})}
                          className="text-xs font-bold uppercase tracking-widest text-stone-400 bg-transparent border-b border-transparent hover:border-stone-200 focus:border-black focus:text-black outline-none transition-all w-fit"
                        />
                        <button 
                          onClick={() => setResumeData({
                            ...resumeData, 
                            projects: [...resumeData.projects, { name: '', tech: '', date: '', bullets: [''] }]
                          })}
                          className="text-xs font-bold text-black hover:underline"
                        >
                          + Add Project
                        </button>
                      </div>
                      {resumeData.projects.map((proj, i) => (
                        <div key={i} className="p-4 bg-stone-50 border border-stone-200 rounded-2xl mb-4 relative group">
                          <button 
                            onClick={() => setResumeData({
                              ...resumeData, 
                              projects: resumeData.projects.filter((_, idx) => idx !== i)
                            })}
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 text-stone-400 hover:text-red-500 transition-all"
                          >
                            <X size={14} />
                          </button>
                          <div className="grid grid-cols-2 gap-3 mb-3">
                            <input 
                              placeholder="Project Name"
                              value={proj.name}
                              onChange={(e) => {
                                const newProj = [...resumeData.projects];
                                newProj[i].name = e.target.value;
                                setResumeData({...resumeData, projects: newProj});
                              }}
                              id={`projects-${i}-name`}
                              className={`px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm font-bold ${flag('projects', i, 'name') ? '!border-amber-400 !bg-amber-50' : ''}`}
                            />
                            <input 
                              placeholder="Technologies"
                              value={proj.tech}
                              onChange={(e) => {
                                const newProj = [...resumeData.projects];
                                newProj[i].tech = e.target.value;
                                setResumeData({...resumeData, projects: newProj});
                              }}
                              className="px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm"
                            />
                            <input 
                              placeholder="Project Link (e.g. github.com/user/repo)"
                              value={proj.link || ''}
                              onChange={(e) => {
                                const newProj = [...resumeData.projects];
                                newProj[i].link = e.target.value;
                                setResumeData({...resumeData, projects: newProj});
                              }}
                              className="px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm"
                            />
                            <input 
                              placeholder="Date"
                              value={proj.date}
                              onChange={(e) => {
                                const newProj = [...resumeData.projects];
                                newProj[i].date = e.target.value;
                                setResumeData({...resumeData, projects: newProj});
                              }}
                              className="px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm"
                            />
                          </div>
                          <div className="space-y-2">
                            {proj.bullets.map((bullet, j) => (
                              <div key={j} className="relative group/bullet">
                                <textarea 
                                  value={bullet}
                                  onChange={(e) => {
                                    const newProj = [...resumeData.projects];
                                    newProj[i].bullets[j] = e.target.value;
                                    setResumeData({...resumeData, projects: newProj});
                                  }}
                                  className="w-full px-3 py-2 bg-white border border-stone-200 rounded-lg text-xs leading-relaxed min-h-[60px] pr-10"
                                  placeholder="Project achievement..."
                                />
                                <button 
                                  onClick={() => handleImproveBullet(i, j, 'projects')}
                                  disabled={isImprovingBullet?.i === i && isImprovingBullet?.j === j}
                                  className="absolute top-2 right-2 p-1.5 bg-stone-50 hover:bg-black hover:text-white rounded-lg transition-all opacity-0 group-hover/bullet:opacity-100 disabled:opacity-50"
                                  title="AI Improve"
                                >
                                  {isImprovingBullet?.i === i && isImprovingBullet?.j === j ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                </button>
                              </div>
                            ))}
                            <button 
                              onClick={() => {
                                const newProj = [...resumeData.projects];
                                newProj[i].bullets.push('');
                                setResumeData({...resumeData, projects: newProj});
                              }}
                              className="text-[10px] font-bold text-stone-400 hover:text-black"
                            >
                              + Add Bullet
                            </button>
                          </div>
                        </div>
                      ))}
                    </section>

                    {/* Custom Sections */}
                    <section id="custom-sections-editor">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400">Custom Sections</h3>
                        <button 
                          onClick={() => setResumeData({
                            ...resumeData, 
                            customSections: [...(resumeData.customSections || []), { title: 'New Section', items: [{ title: '', subtitle: '', date: '', bullets: [''] }] }]
                          })}
                          className="text-xs font-bold text-black hover:underline"
                        >
                          + Add Section
                        </button>
                      </div>
                      {(resumeData.customSections || []).map((section, i) => (
                        <div key={i} className="p-6 bg-stone-50 border border-stone-200 rounded-3xl mb-6 relative group">
                          <button 
                            onClick={() => {
                              const newSections = [...(resumeData.customSections || [])];
                              newSections.splice(i, 1);
                              setResumeData({...resumeData, customSections: newSections});
                            }}
                            className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 p-2 text-stone-400 hover:text-red-500 transition-all"
                          >
                            <X size={16} />
                          </button>
                          
                          <div className="mb-6">
                            <label className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-2 block">Section Title</label>
                            <input 
                              value={section.title}
                              onChange={(e) => {
                                const newSections = [...(resumeData.customSections || [])];
                                newSections[i].title = e.target.value;
                                setResumeData({...resumeData, customSections: newSections});
                              }}
                              className="w-full px-4 py-2.5 bg-white border border-stone-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all font-bold"
                              placeholder="e.g. Leadership, Publications, Awards"
                            />
                          </div>

                          <div className="space-y-4">
                            {section.items.map((item, j) => (
                              <div key={j} className="p-4 bg-white border border-stone-100 rounded-2xl relative group/item">
                                <button 
                                  onClick={() => {
                                    const newSections = [...(resumeData.customSections || [])];
                                    newSections[i].items.splice(j, 1);
                                    setResumeData({...resumeData, customSections: newSections});
                                  }}
                                  className="absolute top-2 right-2 opacity-0 group-hover/item:opacity-100 p-1 text-stone-300 hover:text-red-500 transition-all"
                                >
                                  <X size={12} />
                                </button>
                                
                                <div className="grid grid-cols-2 gap-3 mb-3">
                                  <input 
                                    placeholder="Title"
                                    value={item.title}
                                    onChange={(e) => {
                                      const newSections = [...(resumeData.customSections || [])];
                                      newSections[i].items[j].title = e.target.value;
                                      setResumeData({...resumeData, customSections: newSections});
                                    }}
                                    className="px-3 py-2 bg-stone-50 border border-stone-100 rounded-lg text-sm font-semibold"
                                  />
                                  <input 
                                    placeholder="Date"
                                    value={item.date}
                                    onChange={(e) => {
                                      const newSections = [...(resumeData.customSections || [])];
                                      newSections[i].items[j].date = e.target.value;
                                      setResumeData({...resumeData, customSections: newSections});
                                    }}
                                    className="px-3 py-2 bg-stone-50 border border-stone-100 rounded-lg text-sm"
                                  />
                                  <input 
                                    placeholder="Subtitle/Organization"
                                    value={item.subtitle}
                                    onChange={(e) => {
                                      const newSections = [...(resumeData.customSections || [])];
                                      newSections[i].items[j].subtitle = e.target.value;
                                      setResumeData({...resumeData, customSections: newSections});
                                    }}
                                    className="col-span-2 px-3 py-2 bg-stone-50 border border-stone-100 rounded-lg text-sm italic"
                                  />
                                </div>

                                <div className="space-y-2">
                                  {item.bullets.map((bullet, k) => (
                                    <div key={k} className="relative group/bullet">
                                      <textarea 
                                        value={bullet}
                                        onChange={(e) => {
                                          const newSections = [...(resumeData.customSections || [])];
                                          newSections[i].items[j].bullets[k] = e.target.value;
                                          setResumeData({...resumeData, customSections: newSections});
                                        }}
                                        className="w-full px-3 py-2 bg-stone-50 border border-stone-100 rounded-lg text-xs leading-relaxed min-h-[50px]"
                                        placeholder="Detail..."
                                      />
                                    </div>
                                  ))}
                                  <button 
                                    onClick={() => {
                                      const newSections = [...(resumeData.customSections || [])];
                                      newSections[i].items[j].bullets.push('');
                                      setResumeData({...resumeData, customSections: newSections});
                                    }}
                                    className="text-[10px] font-bold text-stone-400 hover:text-black"
                                  >
                                    + Add Detail
                                  </button>
                                </div>
                              </div>
                            ))}
                            <button 
                              onClick={() => {
                                const newSections = [...(resumeData.customSections || [])];
                                newSections[i].items.push({ title: '', subtitle: '', date: '', bullets: [''] });
                                setResumeData({...resumeData, customSections: newSections});
                              }}
                              className="w-full py-2 border-2 border-dashed border-stone-200 rounded-xl text-xs font-bold text-stone-400 hover:border-stone-400 hover:text-stone-600 transition-all"
                            >
                              + Add Item to {section.title}
                            </button>
                          </div>
                        </div>
                      ))}
                    </section>
                  </motion.div>
                )}
                {activeTab === 'analysis' && (
                  <motion.div 
                    key="analysis"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-6"
                  >
                    <MissingInfoBanner items={missingFields} onJump={jumpToField} />
                    {isAnalyzing && (
                      <div className="flex flex-col items-center justify-center py-12">
                        <RefreshCw className="animate-spin text-stone-400 mb-4" size={32} />
                        <p className="text-sm font-medium text-stone-600">Analyzing your resume...</p>
                      </div>
                    )}

                    {(
                      <div className="space-y-6">
                        <div className="bg-stone-50 p-6 rounded-3xl border border-stone-200 text-center relative group">
                          <div className="text-5xl font-black mb-2">{atsScore.score}</div>
                          <div className="text-xs font-bold uppercase tracking-widest text-stone-400">ATS Score</div>
                          <p className="text-[11px] text-stone-400 mt-1">Calculated from your resume with fixed rules and updated as you edit. See the breakdown below.</p>
                          <button 
                            onClick={handleAnalyze}
                            disabled={isAnalyzing || atsScore.isEmpty}
                            className="mt-4 px-4 py-1.5 bg-black hover:bg-stone-800 text-white rounded-full text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-2 mx-auto disabled:opacity-40"
                          >
                            {isAnalyzing ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
                            {analysis ? 'Refresh AI suggestions' : 'Get AI suggestions'}
                          </button>
                          <div className="mt-4 h-2 bg-stone-200 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${atsScore.score}%` }}
                              className="h-full bg-black"
                            />
                          </div>
                        </div>

                        {atsScore.isEmpty && (
                          <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl text-sm text-amber-800">
                            Your resume is empty, so the score is 0. Import a resume or fill in the Editor, then analyze again.
                          </div>
                        )}

                        <ScoreBreakdown categories={atsScore.categories} />

                        {analysis?.suggestions?.length > 0 && <section>
                          <h4 className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-3 flex items-center gap-2">
                            <CheckCircle2 size={14} className="text-green-500" />
                            AI Suggestions
                          </h4>
                          <ul className="space-y-3">
                            {sortBySection(analysis.suggestions).map((s: Suggestion, i: number, arr: Suggestion[]) => (
                              <React.Fragment key={s.id || i}>
                              {(i === 0 || sectionOf(arr[i - 1]) !== sectionOf(s)) && (
                                <li className="pt-3 pb-1 text-[11px] font-bold uppercase tracking-widest text-stone-500">
                                  {SECTION_LABELS[sectionOf(s)] || sectionOf(s)}
                                  <span className="ml-2 text-stone-300 font-medium normal-case tracking-normal">
                                    {arr.filter((x) => sectionOf(x) === sectionOf(s)).length} suggestion(s)
                                  </span>
                                </li>
                              )}
                              <li 
                                id={`suggestion-${s.id}`}
                                className="p-5 bg-white border border-stone-100 rounded-2xl shadow-sm space-y-4 transition-all hover:border-black/20"
                              >
                                <div className="flex items-start justify-between gap-4">
                                  <div className="space-y-1 flex-1">
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-stone-400">{s.category || 'Improvement'}</h4>
                                    {editingSuggestion?.id === s.id ? (
                                      <div className="space-y-4">
                                        <div className="space-y-1">
                                          <label className="text-[10px] font-bold uppercase text-stone-400">Suggestion Description</label>
                                          <textarea 
                                            value={editingSuggestion.text}
                                            onChange={(e) => setEditingSuggestion({...editingSuggestion, text: e.target.value})}
                                            className="w-full text-sm text-stone-700 leading-relaxed p-3 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:ring-2 focus:ring-black/5 min-h-[60px]"
                                          />
                                        </div>
                                        {s.suggestedValue && (
                                          <div className="space-y-1">
                                            <label className="text-[10px] font-bold uppercase text-stone-400">Suggested Content (Editable)</label>
                                            <textarea 
                                              value={editingSuggestion.suggestedValue || s.suggestedValue}
                                              onChange={(e) => setEditingSuggestion({...editingSuggestion, suggestedValue: e.target.value})}
                                              className="w-full text-sm text-green-700 leading-relaxed p-3 bg-green-50/30 border border-green-100 rounded-xl outline-none focus:ring-2 focus:ring-green-500/10 min-h-[100px]"
                                            />
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="space-y-3">
                                        <p className="text-sm text-stone-800 font-medium">{s.text}</p>
                                        {s.originalValue && (
                                          <div className="p-3 bg-red-50/50 border border-red-100 rounded-xl text-[11px] text-red-700">
                                            <span className="font-bold uppercase mr-2 opacity-50">Current:</span>
                                            {s.originalValue}
                                          </div>
                                        )}
                                        {s.suggestedValue && (
                                          <div className="p-3 bg-green-50/50 border border-green-100 rounded-xl text-[11px] text-green-700">
                                            <span className="font-bold uppercase mr-2 opacity-50">Suggested:</span>
                                            {s.suggestedValue}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex flex-col items-end gap-2 shrink-0">
                                    <button 
                                      onClick={() => dismissSuggestion(s.id, 'ats')}
                                      className="p-1.5 text-stone-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"
                                      title="Dismiss Suggestion"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                      s.category === 'contact' ? 'bg-blue-50 text-blue-600' :
                                      s.category === 'metrics' ? 'bg-green-50 text-green-600' :
                                      s.category === 'format' ? 'bg-purple-50 text-purple-600' :
                                      'bg-stone-100 text-stone-500'
                                    }`}>
                                      {s.category || 'General'}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  {editingSuggestion?.id === s.id ? (
                                    <>
                                      <button 
                                        onClick={() => {
                                          applySuggestion({
                                            ...s, 
                                            text: editingSuggestion.text,
                                            suggestedValue: editingSuggestion.suggestedValue || s.suggestedValue,
                                            originalSuggestedValue: s.suggestedValue
                                          } as any, 'ats');
                                          setEditingSuggestion(null);
                                        }}
                                        className="flex-1 py-3 bg-black text-white hover:bg-stone-800 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-black/10"
                                      >
                                        Apply Modified
                                      </button>
                                      <button 
                                        onClick={() => setEditingSuggestion(null)}
                                        className="px-6 py-3 bg-stone-100 text-stone-600 hover:bg-stone-200 rounded-xl text-xs font-bold transition-all"
                                      >
                                        Cancel
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button 
                                        onClick={() => applySuggestion(s, 'ats')}
                                        className="flex-1 py-3 bg-black text-white hover:bg-stone-800 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-black/10"
                                      >
                                        <Sparkles size={14} />
                                        Approve & Apply
                                      </button>
                                      <button 
                                        onClick={() => setEditingSuggestion({id: s.id, text: s.text, suggestedValue: s.suggestedValue})}
                                        className="px-4 py-3 bg-stone-100 text-stone-600 hover:bg-stone-200 rounded-xl text-xs font-bold transition-all"
                                      >
                                        Modify
                                      </button>
                                      <button 
                                        onClick={() => locateSection(s.category || 'general', s)}
                                        className="px-4 py-3 bg-stone-100 text-stone-600 hover:bg-stone-200 rounded-xl text-xs font-bold transition-all"
                                        title="Locate in Editor"
                                      >
                                        Locate
                                      </button>
                                    </>
                                  )}
                                </div>
                              </li>
                              </React.Fragment>
                            ))}
                          </ul>
                        </section>}

                        {analysis?.missingKeywords?.length > 0 && (
                          <section>
                            <h4 className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-3 flex items-center gap-2">
                              <AlertCircle size={14} className="text-amber-500" />
                              Missing Keywords
                            </h4>
                            <div className="flex flex-wrap gap-2">
                              {analysis.missingKeywords.map((k: string, i: number) => (
                                <span key={i} className="px-3 py-1 bg-stone-100 text-stone-600 rounded-full text-xs font-medium">
                                  {k}
                                </span>
                              ))}
                            </div>
                          </section>
                        )}
                      </div>
                    )}
                  </motion.div>
                )}

                {activeTab === 'jd' && (
                  <motion.div 
                    key="jd"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-6"
                  >
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-stone-400">Job posting link</label>
                      <div className="flex gap-2">
                        <div className="flex-1 flex items-center gap-2 px-4 bg-stone-50 border border-stone-200 rounded-2xl focus-within:ring-2 focus-within:ring-black">
                          <LinkIcon size={16} className="text-stone-400 shrink-0" />
                          <input
                            type="url"
                            value={jdUrl}
                            onChange={(e) => setJdUrl(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && jdUrl && !isFetchingJd) handleFetchJd(); }}
                            placeholder="https://boards.greenhouse.io/... or any job page"
                            className="w-full py-3 bg-transparent outline-none text-sm"
                          />
                        </div>
                        <button
                          onClick={handleFetchJd}
                          disabled={!jdUrl || isFetchingJd}
                          className="px-5 bg-stone-900 text-white rounded-2xl text-sm font-bold flex items-center gap-2 disabled:opacity-50"
                        >
                          {isFetchingJd ? <RefreshCw className="animate-spin" size={16} /> : <ArrowRight size={16} />}
                          {isFetchingJd ? 'Reading…' : 'Fetch'}
                        </button>
                      </div>
                      <p className="text-[11px] text-stone-400">Paste a link and we'll pull the job description in. Pages behind a login (like LinkedIn) can't be read; paste the text below instead.</p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-stone-400">Target Job Description</label>
                      <textarea 
                        value={jd}
                        onChange={(e) => setJd(e.target.value)}
                        placeholder="Paste the job description here..."
                        className="w-full h-64 p-4 bg-stone-50 border border-stone-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all text-sm leading-relaxed"
                      />
                    </div>
                    
                    <button 
                      onClick={handleOptimize}
                      disabled={!jd || isParsing}
                      className="w-full py-4 bg-black text-white rounded-2xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-all shadow-xl shadow-black/10"
                    >
                      {isParsing ? <RefreshCw className="animate-spin" size={18} /> : <Sparkles size={18} />}
                      {jdAnalysis ? 'Re-Analyze Match' : 'Analyze Match Rate'}
                    </button>

                    {jdAnalysis && (
                      <div className="space-y-8 mt-8">
                        <div className="p-6 bg-stone-900 rounded-3xl text-white">
                          <div className="flex justify-between items-end mb-4">
                            <div>
                              <h4 className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-1">JD Match Score</h4>
                              <div className="text-4xl font-bold">{jdMatch?.score ?? 0}%</div>
                            </div>
                            <div className="text-right">
                              <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">Status</div>
                              <div className={`text-xs font-bold ${(jdMatch?.score ?? 0) >= 80 ? 'text-green-400' : 'text-amber-400'}`}>
                                {(jdMatch?.score ?? 0) >= 80 ? 'Strong Match' : 'Needs Optimization'}
                              </div>
                            </div>
                          </div>
                          <div className="w-full h-2 bg-stone-800 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${jdMatch?.score ?? 0}%` }}
                              className={`h-full ${(jdMatch?.score ?? 0) >= 80 ? 'bg-green-500' : 'bg-amber-500'}`}
                            />
                          </div>
                        </div>

                        {jdMatch && jdKeywords && (
                          <>
                            {jdKeywords.jobTitle && (
                              <p className="text-sm text-stone-500 -mt-4">
                                Matched against <span className="font-semibold text-stone-800">{jdKeywords.jobTitle}</span>
                                {jdKeywords.company ? <> at <span className="font-semibold text-stone-800">{jdKeywords.company}</span></> : null}
                                {jdKeywords.forJd !== jd && <span className="text-amber-600"> · the JD text changed, click Re-Analyze to update</span>}
                              </p>
                            )}
                            <ImprovementList
                              items={jdMatch.improvements}
                              rewrites={rewrites}
                              busyAll={isApplyingAll}
                              onAddSkill={addSkill}
                              onPreviewRewrite={previewRewrite}
                              onApplyRewrite={(term) => { const rw = rewrites[term]; if (rw && rw !== 'loading') { applyRewrite(rw); discardRewrite(term); } }}
                              onDiscardRewrite={discardRewrite}
                              onApplyAll={applyAllImprovements}
                            />
                            <ScoreBreakdown categories={jdMatch.categories} />
                          </>
                        )}

                        {jdAnalysis.suggestions?.length > 0 && <section className="space-y-4">
                          <h4 className="text-xs font-bold uppercase tracking-widest text-stone-400 flex items-center gap-2">
                            <Sparkles size={14} className="text-amber-500" />
                            AI rewrite suggestions
                          </h4>
                          <ul className="space-y-4">
                            {jdAnalysis.suggestions.map((s: Suggestion, i: number) => (
                              <li 
                                key={s.id || i} 
                                id={`suggestion-${s.id}`}
                                className="p-5 bg-white border border-stone-100 rounded-2xl shadow-sm space-y-4 transition-all hover:border-black/20"
                              >
                                <div className="flex items-start justify-between gap-4">
                                  <div className="space-y-1 flex-1">
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-stone-400">Optimization</h4>
                                    {editingSuggestion?.id === s.id ? (
                                      <div className="space-y-4">
                                        <div className="space-y-1">
                                          <label className="text-[10px] font-bold uppercase text-stone-400">Optimization Description</label>
                                          <textarea 
                                            value={editingSuggestion.text}
                                            onChange={(e) => setEditingSuggestion({...editingSuggestion, text: e.target.value})}
                                            className="w-full text-sm text-stone-700 leading-relaxed p-3 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:ring-2 focus:ring-black/5 min-h-[60px]"
                                          />
                                        </div>
                                        {s.suggestedValue && (
                                          <div className="space-y-1">
                                            <label className="text-[10px] font-bold uppercase text-stone-400">Suggested Content (Editable)</label>
                                            <textarea 
                                              value={editingSuggestion.suggestedValue || s.suggestedValue}
                                              onChange={(e) => setEditingSuggestion({...editingSuggestion, suggestedValue: e.target.value})}
                                              className="w-full text-sm text-green-700 leading-relaxed p-3 bg-green-50/30 border border-green-100 rounded-xl outline-none focus:ring-2 focus:ring-green-500/10 min-h-[100px]"
                                            />
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="space-y-3">
                                        <p className="text-sm text-stone-800 font-medium">{s.text}</p>
                                        {s.originalValue && (
                                          <div className="p-3 bg-red-50/50 border border-red-100 rounded-xl text-[11px] text-red-700">
                                            <span className="font-bold uppercase mr-2 opacity-50">Current:</span>
                                            {s.originalValue}
                                          </div>
                                        )}
                                        {s.suggestedValue && (
                                          <div className="p-3 bg-green-50/50 border border-green-100 rounded-xl text-[11px] text-green-700">
                                            <span className="font-bold uppercase mr-2 opacity-50">Suggested:</span>
                                            {s.suggestedValue}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex flex-col items-end gap-2 shrink-0">
                                    <button 
                                      onClick={() => dismissSuggestion(s.id, 'jd')}
                                      className="p-1.5 text-stone-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"
                                      title="Dismiss Suggestion"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                    <span className="px-2 py-0.5 bg-green-50 text-green-600 rounded-full text-[10px] font-bold uppercase tracking-wider">
                                      +{ (s as any).scoreImpact || 5 }% Match
                                    </span>
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  {editingSuggestion?.id === s.id ? (
                                    <>
                                      <button 
                                        onClick={() => {
                                          applySuggestion({
                                            ...s, 
                                            text: editingSuggestion.text,
                                            suggestedValue: editingSuggestion.suggestedValue || s.suggestedValue,
                                            originalSuggestedValue: s.suggestedValue
                                          } as any, 'jd');
                                          setEditingSuggestion(null);
                                        }}
                                        className="flex-1 py-3 bg-black text-white hover:bg-stone-800 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-black/10"
                                      >
                                        Apply Modified
                                      </button>
                                      <button 
                                        onClick={() => setEditingSuggestion(null)}
                                        className="px-6 py-3 bg-stone-100 text-stone-600 hover:bg-stone-200 rounded-xl text-xs font-bold transition-all"
                                      >
                                        Cancel
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button 
                                        onClick={() => applySuggestion(s, 'jd')}
                                        className="flex-1 py-3 bg-black text-white hover:bg-stone-800 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-black/10"
                                      >
                                        <Sparkles size={14} />
                                        Approve & Apply
                                      </button>
                                      <button 
                                        onClick={() => setEditingSuggestion({id: s.id, text: s.text, suggestedValue: s.suggestedValue})}
                                        className="px-4 py-3 bg-stone-100 text-stone-600 hover:bg-stone-200 rounded-xl text-xs font-bold transition-all"
                                      >
                                        Modify
                                      </button>
                                      <button 
                                        onClick={() => locateSection(s.category || 'experience', s)}
                                        className="px-4 py-3 bg-stone-100 text-stone-600 hover:bg-stone-200 rounded-xl text-xs font-bold transition-all"
                                        title="Locate in Editor"
                                      >
                                        Locate
                                      </button>
                                    </>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </section>}
                      </div>
                    )}
                  </motion.div>
                )}

                {activeTab === 'latex' && (
                  <motion.div 
                    key="latex"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="h-full flex flex-col gap-4"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400">Generated LaTeX Source</h3>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(latexCode);
                          alert('LaTeX code copied to clipboard!');
                        }}
                        className="px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all"
                      >
                        Copy Code
                      </button>
                    </div>
                    <div className="flex-1 bg-stone-900 rounded-2xl p-4 overflow-hidden flex flex-col">
                      <pre className="flex-1 overflow-auto text-[11px] font-mono text-stone-300 leading-relaxed custom-scrollbar selection:bg-white/20">
                        {latexCode}
                      </pre>
                    </div>
                    <p className="text-[10px] text-stone-400 italic">
                      This code is automatically updated as you edit. You can copy it directly into Overleaf if the "Open in Overleaf" button fails.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Right Panel: Preview */}
        <div className="col-span-12 lg:col-span-7 bg-stone-200 rounded-3xl overflow-hidden relative border border-stone-300 shadow-inner flex flex-col">
          <div className="flex-1 overflow-auto p-12 flex justify-center items-start">
            <div 
              style={{ 
                transform: `scale(${zoom})`, 
                transformOrigin: 'top center',
                transition: 'transform 0.2s ease-out'
              }}
              className="h-fit"
            >
              <ResumePreview 
                data={resumeData} 
                id="resume-preview" 
                ref={previewRef}
                isOverPageLimit={isOverPageLimit}
                overflowPercentage={overflowPercentage}
                fontFamily={fontFamily}
                fontSize={fontSize}
              />
              {/* Hidden clone for high-quality export */}
              <div className="fixed -left-[2000px] top-0">
                <ResumePreview 
                  data={resumeData} 
                  id="resume-export" 
                  fontFamily={fontFamily} 
                  fontSize={fontSize}
                />
              </div>
            </div>
          </div>

          {/* Floating Controls */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 px-6 py-3 bg-white/90 backdrop-blur-md rounded-full border border-stone-200 shadow-2xl z-50">
            <div className="flex items-center gap-4">
              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Zoom</span>
              <input 
                type="range" 
                min="0.5" 
                max="1.5" 
                step="0.05" 
                value={zoom} 
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                className="w-32 h-1 bg-stone-200 rounded-full appearance-none cursor-pointer accent-black"
              />
              <span className="text-[10px] font-bold text-stone-600 w-8">{Math.round(zoom * 100)}%</span>
            </div>
            <div className="w-px h-4 bg-stone-200 mx-2" />
            <button 
              onClick={handleShare}
              className="p-2 hover:bg-stone-100 rounded-full transition-colors text-stone-600"
              title="Copy App Link"
            >
              <Share2 size={18} />
            </button>
            <button 
              onClick={exportPDF}
              className="p-2 hover:bg-stone-100 rounded-full transition-colors text-stone-600"
              title="Open PDF in New Tab"
            >
              <ExternalLink size={18} />
            </button>
          </div>
        </div>
      </main>

      {/* Parsing Overlay */}
      <AnimatePresence>
        {isParsing && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[100] flex items-center justify-center"
          >
            <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl flex flex-col items-center gap-6 max-w-sm w-full mx-4">
              <div className="relative">
                <div className="w-16 h-16 border-4 border-stone-100 border-t-black rounded-full animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles size={20} className="text-stone-300" />
                </div>
              </div>
              <div className="text-center space-y-4 w-full">
                <div className="space-y-1">
                  <p className="font-bold text-xl">Processing Resume</p>
                  <p className="text-stone-500 text-sm animate-pulse">{parsingStep || 'AI is working its magic...'}</p>
                </div>
                
                <div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${parsingProgress}%` }}
                    className="h-full bg-black transition-all duration-300"
                  />
                </div>
                <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">{parsingProgress}% Complete</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
