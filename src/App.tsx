/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
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
  Type as TypeIcon,
  Globe,
  Link as LinkIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { INITIAL_RESUME, ResumeData, ensureResumeData, Suggestion } from './types';
import { ResumePreview } from './components/ResumePreview';
import { generateLatex } from './latexUtils';
import { parseResume, analyzeResume, optimizeResumeForJD, improveBullet } from './geminiService';
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
  const [activeTab, setActiveTab] = useState<'import' | 'editor' | 'analysis' | 'jd' | 'latex'>('import');
  const [hoveredSuggestion, setHoveredSuggestion] = useState<{ id: string, category: string } | null>(null);
  const [isImprovingBullet, setIsImprovingBullet] = useState<{i: number, j: number} | null>(null);
  const [editingSuggestion, setEditingSuggestion] = useState<{id: string, text: string, suggestedValue?: string} | null>(null);
  const [zoom, setZoom] = useState(0.85);
  const [isOverPageLimit, setIsOverPageLimit] = useState(false);
  const [overflowPercentage, setOverflowPercentage] = useState(0);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [isSharing, setIsSharing] = useState(false);
  const [sharedLink, setSharedLink] = useState<string | null>(null);
  const [isLoadingShared, setIsLoadingShared] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [isSharedView, setIsSharedView] = useState(false);
  
  const previewRef = useRef<HTMLDivElement>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const loadSharedResume = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const shareId = urlParams.get('share');
      if (shareId) {
        setIsLoadingShared(true);
        setIsSharedView(true);
        try {
          const response = await fetch(`/api/resumes/${shareId}`);
          if (response.ok) {
            const result = await response.json();
            if (result.data) {
              const validated = ensureResumeData(result.data);
              setResumeData(validated);
              setActiveTab('editor');
            }
          } else {
            console.error('Failed to fetch shared resume');
          }
        } catch (error) {
          console.error('Error loading shared resume:', error);
        } finally {
          setIsLoadingShared(false);
        }
      }
    };
    loadSharedResume();
  }, []);

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

    // Update score and remove suggestion
    if (type === 'ats') {
      setAnalysis((prev: any) => {
        if (!prev) return null;
        const impact = (suggestion as any).scoreImpact || 2;
        return {
          ...prev,
          score: Math.min(100, (prev.score || 0) + impact),
          suggestions: prev.suggestions.filter((s: Suggestion) => s.id !== suggestion.id)
        };
      });
    } else {
      setJdAnalysis((prev: any) => {
        if (!prev) return null;
        const impact = (suggestion as any).scoreImpact || 5;
        return {
          ...prev,
          overallMatchScore: Math.min(100, (prev.overallMatchScore || 0) + impact),
          suggestions: prev.suggestions.filter((s: Suggestion) => s.id !== suggestion.id)
        };
      });
    }
  };

  const handleImproveBullet = async (i: number, j: number, type: 'experience' | 'projects') => {
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
    
    if (errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('quota')) {
      if (confirm('You have exceeded the API quota. Would you like to set your own API key to continue? (Requires a paid cloud project)')) {
        handleOpenKeyDialog();
      }
    } else {
      showToast(`${context} failed: ${errorMsg}`, 'error');
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
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
          
          const pagePromises = Array.from({ length: pdf.numPages }, (_, i) => i + 1).map(async (pageNum) => {
            const page = await pdf.getPage(pageNum);
            const content = await page.getTextContent();
            return content.items
              .map((item: any) => typeof item.str === 'string' ? item.str : '')
              .filter(str => str.trim().length > 0)
              .join(' ');
          });

          const pageTexts = await Promise.all(pagePromises);
          text = pageTexts.join('\n\n');
          setParsingProgress(40);
          
          console.log("Extracted text length:", text.length);
          
          if (text.trim().length < 50) {
            throw new Error("Could not extract enough text from the PDF. Please try a different file or copy-paste the text.");
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

      console.log("Sending text to AI for parsing...");
      const parsed = await parseResume(text);
      clearInterval(progressInterval);
      
      console.log("AI parsing complete. Validating data...");
      setParsingStep('Finalizing data...');
      setParsingProgress(95);
      const validated = ensureResumeData(parsed);
      
      console.log("Parsed Experience count:", validated.experience.length);
      console.log("Parsed Education count:", validated.education.length);
      console.log("Parsed Skills:", validated.skills);

      // If only name is parsed or data is very sparse, it might be a parsing failure
      const hasContent = validated.experience.length > 0 || validated.education.length > 0 || validated.projects.length > 0 || (validated.skills.languages || validated.skills.frameworks);
      
      if (!hasContent) {
        throw new Error('AI failed to extract meaningful sections (Experience, Education, or Skills). This can happen with complex PDF layouts. Please try copy-pasting your resume text instead.');
      }

      console.log("Setting resume data with validated object:", validated);
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
    setIsAnalyzing(true);
    try {
      const result = await analyzeResume(resumeData, jd || undefined);
      
      // Filter out timeline/location suggestions
      if (result.suggestions) {
        const seenIds = new Set();
        result.suggestions = result.suggestions.map((s: any, i: number) => {
          let newId = s.id || `suggestion-${i}`;
          if (seenIds.has(newId)) {
            newId = `${newId}-${i}`;
          }
          seenIds.add(newId);
          return { ...s, id: newId };
        });
        
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

  const handleOptimize = async () => {
    if (!jd) {
      alert('Please provide a Job Description first.');
      return;
    }
    setIsParsing(true);
    try {
      const result = await optimizeResumeForJD(resumeData, jd);
      
      // Filter out timeline/location suggestions
      if (result.suggestions) {
        const seenIds = new Set();
        result.suggestions = result.suggestions.map((s: any, i: number) => {
          let newId = s.id || `suggestion-${i}`;
          if (seenIds.has(newId)) {
            newId = `${newId}-${i}`;
          }
          seenIds.add(newId);
          return { ...s, id: newId };
        });

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

  const handleFetchJdFromUrl = async () => {
    if (!jdUrl) return;
    
    setIsFetchingJd(true);
    try {
      const response = await fetch(`/api/fetch-jd?url=${encodeURIComponent(jdUrl)}`);
      if (!response.ok) {
        throw new Error('Failed to fetch job description from the provided URL');
      }
      const data = await response.json();
      if (data.text) {
        setJd(data.text);
        setJdUrl('');
      } else {
        throw new Error('No job description text found at the provided URL');
      }
    } catch (error: any) {
      alert(error.message || 'Failed to fetch JD');
    } finally {
      setIsFetchingJd(false);
    }
  };

  const handleShareLink = async () => {
    setIsSharing(true);
    try {
      const response = await fetch('/api/resumes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: resumeData }),
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to generate share link');
      }
      
      const id = result.id;
      const baseUrl = window.location.origin + window.location.pathname;
      const shareUrl = `${baseUrl}?share=${id}`;
      setSharedLink(shareUrl);
      setShowShareModal(true);
      
      // Try to copy to clipboard
      try {
        await navigator.clipboard.writeText(shareUrl);
        showToast('Link copied to clipboard!');
      } catch (err) {
        console.warn('Clipboard copy failed:', err);
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to share resume', 'error');
    } finally {
      setIsSharing(false);
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

  const ConnectionLines = () => {
    const [coords, setCoords] = useState<{ x1: number, y1: number, x2: number, y2: number } | null>(null);

    useEffect(() => {
      if (!hoveredSuggestion) {
        setCoords(null);
        return;
      }

      const updateCoords = () => {
        const suggestionEl = document.getElementById(`suggestion-${hoveredSuggestion.id}`);
        // Map category to preview ID
        let targetId = `preview-${hoveredSuggestion.category}`;
        if (hoveredSuggestion.category === 'metrics' || hoveredSuggestion.category === 'format') {
          // Default to experience or skills for these general categories
          targetId = 'preview-experience';
        }
        
        const previewEl = document.getElementById(targetId);

        if (suggestionEl && previewEl) {
          const sRect = suggestionEl.getBoundingClientRect();
          const pRect = previewEl.getBoundingClientRect();

          setCoords({
            x1: sRect.right,
            y1: sRect.top + (sRect.height / 2),
            x2: pRect.left,
            y2: pRect.top + (pRect.height / 2)
          });
        }
      };

      updateCoords();
      // Use capture phase for scroll to catch it from any scrollable container
      window.addEventListener('scroll', updateCoords, true);
      window.addEventListener('resize', updateCoords);
      
      return () => {
        window.removeEventListener('scroll', updateCoords, true);
        window.removeEventListener('resize', updateCoords);
      };
    }, [hoveredSuggestion]);

    if (!coords) return null;

    return (
      <div className="fixed inset-0 pointer-events-none z-[100]">
        <svg className="w-full h-full">
          <motion.path
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            d={`M ${coords.x1} ${coords.y1} C ${coords.x1 + 100} ${coords.y1}, ${coords.x2 - 100} ${coords.y2}, ${coords.x2} ${coords.y2}`}
            stroke="rgba(0,0,0,0.3)"
            strokeWidth="2"
            fill="none"
            strokeDasharray="5,5"
          />
          <circle cx={coords.x1} cy={coords.y1} r="4" fill="black" />
          <circle cx={coords.x2} cy={coords.y2} r="4" fill="black" />
        </svg>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#F5F5F4] text-[#1C1917] font-sans">
      <AnimatePresence mode="wait">
        {isLoadingShared && (
          <motion.div 
            key="loading-shared"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white/80 backdrop-blur-md z-[100] flex flex-col items-center justify-center gap-4"
          >
            <RefreshCw size={48} className="text-black animate-spin" />
            <p className="text-lg font-medium text-stone-600">Loading shared resume...</p>
          </motion.div>
        )}

        {toast && (
          <motion.div
            key="toast-notification"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className={`fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-2xl z-[100] flex items-center gap-3 ${
              toast.type === 'success' ? 'bg-black text-white' : 'bg-red-600 text-white'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span className="text-sm font-medium">{toast.message}</span>
          </motion.div>
        )}

        {showShareModal && sharedLink && (
          <motion.div
            key="share-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-6"
            onClick={() => setShowShareModal(false)}
          >
            <motion.div
              key="share-modal-content"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Share Resume</h2>
                <button onClick={() => setShowShareModal(false)} className="p-2 hover:bg-stone-100 rounded-full transition-colors">
                  <X size={20} />
                </button>
              </div>
              <p className="text-stone-500 mb-6">Anyone with this link can view your resume.</p>
              <div className="flex gap-2 mb-6">
                <a 
                  href={sharedLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm font-mono hover:bg-stone-100 transition-colors truncate block"
                  title="Click to open in new tab"
                >
                  {sharedLink}
                </a>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(sharedLink);
                    showToast('Copied!');
                  }}
                  className="bg-black text-white px-4 py-3 rounded-xl hover:bg-stone-800 transition-colors flex items-center gap-2"
                  title="Copy to clipboard"
                >
                  Copy
                </button>
              </div>
              <button 
                onClick={() => setShowShareModal(false)}
                className="w-full py-4 bg-stone-100 hover:bg-stone-200 rounded-2xl font-bold transition-colors"
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {isSharedView ? (
        <div className="min-h-screen bg-stone-100 py-12 flex flex-col items-center">
          <div className="mb-8 flex items-center gap-3">
            <div className="w-10 h-10 bg-black rounded-2xl flex items-center justify-center text-white shadow-xl transform -rotate-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                <path d="M7 21V3h7a5 5 0 0 1 0 10H7" />
                <path d="M14 8l3-3m0 0h-3m3 0v3" className="text-white/80" />
              </svg>
            </div>
            <h1 className="font-bold text-xl leading-none">PushResume</h1>
          </div>
          
          <div className="relative group">
            <ResumePreview 
              data={resumeData} 
              fontFamily={fontFamily}
              fontSize={fontSize}
            />
            
            <div className="mt-8 flex justify-center gap-4 no-print">
              <button 
                onClick={() => window.print()}
                className="px-6 py-3 bg-black text-white rounded-2xl font-bold flex items-center gap-2 hover:bg-stone-800 transition-all shadow-xl shadow-black/10"
              >
                <Download size={18} />
                Download PDF
              </button>
              <button 
                onClick={() => window.location.href = window.location.origin}
                className="px-6 py-3 bg-white text-black border border-stone-200 rounded-2xl font-bold flex items-center gap-2 hover:bg-stone-50 transition-all shadow-sm"
              >
                <Sparkles size={18} />
                Create Your Own
              </button>
            </div>
          </div>
          
          <style dangerouslySetInnerHTML={{ __html: `
            @media print {
              .no-print { display: none !important; }
              body { background: white !important; padding: 0 !important; }
              .min-h-screen { min-height: auto !important; padding: 0 !important; background: white !important; }
              .py-12 { padding: 0 !important; }
              .mb-8 { display: none !important; }
            }
          `}} />
        </div>
      ) : (
        <>
          <ConnectionLines />
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
                  onClick={handleShareLink}
                  disabled={isSharing}
                  className="flex items-center gap-2 px-6 py-2 hover:bg-white/10 rounded-full transition-colors text-sm font-medium"
                  title="Generate shareable link"
                >
                  {isSharing ? <RefreshCw size={16} className="animate-spin" /> : <Share2 size={16} />}
                  {isSharing ? 'Generating...' : 'Share Link'}
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
                    {/* Basic Info */}
                    <section id="basic-info-section">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-4">Basic Information</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-stone-500 ml-1">Full Name</label>
                          <input 
                            value={resumeData.name}
                            onChange={(e) => setResumeData({...resumeData, name: e.target.value})}
                            className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-stone-500 ml-1">Phone</label>
                          <input 
                            value={resumeData.phone}
                            onChange={(e) => setResumeData({...resumeData, phone: e.target.value})}
                            className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-stone-500 ml-1">Email</label>
                          <input 
                            value={resumeData.email}
                            onChange={(e) => setResumeData({...resumeData, email: e.target.value})}
                            className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all"
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
                        <div key={`editor-edu-${i}`} className="p-4 bg-stone-50 border border-stone-200 rounded-2xl mb-4 relative group">
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
                              className="col-span-2 px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm"
                            />
                            <input 
                              placeholder="Degree"
                              value={edu.degree}
                              onChange={(e) => {
                                const newEdu = [...resumeData.education];
                                newEdu[i].degree = e.target.value;
                                setResumeData({...resumeData, education: newEdu});
                              }}
                              className="px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm"
                            />
                            <input 
                              placeholder="Date (e.g. Aug. 2018 -- May 2021)"
                              value={edu.date}
                              onChange={(e) => {
                                const newEdu = [...resumeData.education];
                                newEdu[i].date = e.target.value;
                                setResumeData({...resumeData, education: newEdu});
                              }}
                              className="px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm"
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
                        <div key={`editor-exp-${i}`} className="p-4 bg-stone-50 border border-stone-200 rounded-2xl mb-4 relative group">
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
                              className="px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm font-bold"
                            />
                            <input 
                              placeholder="Company"
                              value={exp.company}
                              onChange={(e) => {
                                const newExp = [...resumeData.experience];
                                newExp[i].company = e.target.value;
                                setResumeData({...resumeData, experience: newExp});
                              }}
                              className="px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm"
                            />
                            <input 
                              placeholder="Date"
                              value={exp.date}
                              onChange={(e) => {
                                const newExp = [...resumeData.experience];
                                newExp[i].date = e.target.value;
                                setResumeData({...resumeData, experience: newExp});
                              }}
                              className="px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm"
                            />
                          </div>
                          <div className="space-y-2">
                            {exp.bullets.map((bullet, j) => (
                              <div key={`editor-exp-bullet-${i}-${j}`} className="relative group/bullet">
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
                        <div key={`editor-proj-${i}`} className="p-4 bg-stone-50 border border-stone-200 rounded-2xl mb-4 relative group">
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
                              className="px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm font-bold"
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
                              <div key={`editor-proj-bullet-${i}-${j}`} className="relative group/bullet">
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
                        <div key={`editor-custom-section-${i}`} className="p-6 bg-stone-50 border border-stone-200 rounded-3xl mb-6 relative group">
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
                              <div key={`editor-custom-item-${i}-${j}`} className="p-4 bg-white border border-stone-100 rounded-2xl relative group/item">
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
                                    <div key={`editor-custom-bullet-${i}-${j}-${k}`} className="relative group/bullet">
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
                    {!analysis && !isAnalyzing && (
                      <div className="text-center py-12">
                        <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-4">
                          <Sparkles className="text-stone-300" />
                        </div>
                        <h4 className="font-bold">Ready to Analyze?</h4>
                        <p className="text-sm text-stone-500 mt-2 mb-6">Get your ATS score and improvement suggestions.</p>
                        <button 
                          onClick={handleAnalyze}
                          className="px-6 py-2 bg-black text-white rounded-full text-sm font-bold"
                        >
                          Start Analysis
                        </button>
                      </div>
                    )}

                    {isAnalyzing && (
                      <div className="flex flex-col items-center justify-center py-12">
                        <RefreshCw className="animate-spin text-stone-400 mb-4" size={32} />
                        <p className="text-sm font-medium text-stone-600">Analyzing your resume...</p>
                      </div>
                    )}

                    {analysis && (
                      <div className="space-y-6">
                        <div className="bg-stone-50 p-6 rounded-3xl border border-stone-200 text-center relative group">
                          <button 
                            onClick={handleAnalyze}
                            disabled={isAnalyzing}
                            className="absolute top-4 right-4 p-2 text-stone-400 hover:text-black hover:bg-white rounded-full transition-all shadow-sm opacity-0 group-hover:opacity-100 disabled:opacity-50"
                            title="Re-evaluate ATS Score"
                          >
                            <RefreshCw size={16} className={isAnalyzing ? 'animate-spin' : ''} />
                          </button>
                          <div className="text-5xl font-black mb-2">{analysis.score}</div>
                          <div className="text-xs font-bold uppercase tracking-widest text-stone-400">ATS Score</div>
                          <button 
                            onClick={handleAnalyze}
                            disabled={isAnalyzing}
                            className="mt-4 px-4 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-2 mx-auto disabled:opacity-50"
                          >
                            <RefreshCw size={12} className={isAnalyzing ? 'animate-spin' : ''} />
                            Re-evaluate Score
                          </button>
                          <div className="mt-4 h-2 bg-stone-200 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${analysis.score}%` }}
                              className="h-full bg-black"
                            />
                          </div>
                        </div>

                        <section>
                          <h4 className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-3 flex items-center gap-2">
                            <CheckCircle2 size={14} className="text-green-500" />
                            Suggestions
                          </h4>
                          <ul className="space-y-3">
                            {analysis.suggestions.map((s: Suggestion, i: number) => (
                              <li 
                                key={`ats-suggestion-${s.id}-${i}`} 
                                id={`suggestion-${s.id}`}
                                onMouseEnter={() => setHoveredSuggestion({ id: s.id, category: s.category || 'experience' })}
                                onMouseLeave={() => setHoveredSuggestion(null)}
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
                            ))}
                          </ul>
                        </section>

                        {analysis.missingKeywords && (
                          <section>
                            <h4 className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-3 flex items-center gap-2">
                              <AlertCircle size={14} className="text-amber-500" />
                              Missing Keywords
                            </h4>
                            <div className="flex flex-wrap gap-2">
                              {analysis.missingKeywords.map((k: string, i: number) => (
                                <span key={`missing-keyword-${i}`} className="px-3 py-1 bg-stone-100 text-stone-600 rounded-full text-xs font-medium">
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
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-widest text-stone-400">Import from URL</label>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Globe size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
                            <input 
                              value={jdUrl}
                              onChange={(e) => setJdUrl(e.target.value)}
                              placeholder="Paste job description link (LinkedIn, Indeed, etc.)"
                              className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all text-sm"
                            />
                          </div>
                          <button 
                            onClick={handleFetchJdFromUrl}
                            disabled={!jdUrl || isFetchingJd}
                            className="px-6 py-3 bg-stone-100 hover:bg-black hover:text-white rounded-2xl text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-2"
                          >
                            {isFetchingJd ? <RefreshCw size={14} className="animate-spin" /> : <LinkIcon size={14} />}
                            Fetch
                          </button>
                        </div>
                        <p className="text-[10px] text-stone-400 italic ml-1">We'll try to extract the job description text for you.</p>
                      </div>

                      <div className="relative py-4">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-stone-100"></div>
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                          <span className="bg-white px-2 text-stone-400 font-bold tracking-widest">Or</span>
                        </div>
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
                              <div className="text-4xl font-bold">{jdAnalysis.overallMatchScore}%</div>
                            </div>
                            <div className="text-right">
                              <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">Status</div>
                              <div className={`text-xs font-bold ${jdAnalysis.overallMatchScore > 80 ? 'text-green-400' : 'text-amber-400'}`}>
                                {jdAnalysis.overallMatchScore > 80 ? 'Strong Match' : 'Needs Optimization'}
                              </div>
                            </div>
                          </div>
                          <div className="w-full h-2 bg-stone-800 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${jdAnalysis.overallMatchScore}%` }}
                              className={`h-full ${jdAnalysis.overallMatchScore > 80 ? 'bg-green-500' : 'bg-amber-500'}`}
                            />
                          </div>
                        </div>

                        <section className="space-y-4">
                          <h4 className="text-xs font-bold uppercase tracking-widest text-stone-400 flex items-center gap-2">
                            <Sparkles size={14} className="text-amber-500" />
                            Optimization Suggestions
                          </h4>
                          <ul className="space-y-4">
                            {jdAnalysis.suggestions.map((s: Suggestion, i: number) => (
                              <li 
                                key={`jd-suggestion-${s.id}-${i}`} 
                                id={`suggestion-${s.id}`}
                                onMouseEnter={() => setHoveredSuggestion({ id: s.id, category: s.category || 'experience' })}
                                onMouseLeave={() => setHoveredSuggestion(null)}
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
                        </section>
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
    </>
  )}

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
