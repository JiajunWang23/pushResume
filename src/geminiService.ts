
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { ResumeData } from "./types";

const getAI = () => {
  // Priority: LocalStorage (user-provided) > process.env (developer-provided)
  const customKey = typeof window !== 'undefined' ? localStorage.getItem('custom_gemini_api_key') : null;
  const apiKey = (customKey && customKey.trim() !== "") ? customKey : (process.env.GEMINI_API_KEY || "");
  
  return new GoogleGenAI({ apiKey });
};


// ---------------------------------------------------------------------------------------
// Resilient calls: Gemini returns 503 UNAVAILABLE ("model is experiencing high demand")
// during load spikes. Retry transient errors with exponential backoff + jitter, then fall
// back to a lighter model, which has separate capacity and quota.
// ---------------------------------------------------------------------------------------
const PRIMARY_MODEL = "gemini-flash-latest";
const FALLBACK_MODELS = ["gemini-flash-lite-latest"];
const MAX_ATTEMPTS_PER_MODEL = 3;
const BASE_DELAY_MS = 1000;

type GenerateParams = Parameters<ReturnType<typeof getAI>["models"]["generateContent"]>[0];

const errorText = (err: any): string =>
  typeof err === "string" ? err : `${err?.status ?? ""} ${err?.message ?? ""} ${JSON.stringify(err ?? "")}`;

/** Overloaded / server-side / network hiccups: worth retrying the same model. */
const isTransient = (err: any): boolean =>
  [500, 502, 503, 504].includes(Number(err?.status)) ||
  /\b(500|502|503|504)\b|UNAVAILABLE|high demand|overloaded|INTERNAL|DEADLINE_EXCEEDED|fetch failed|Failed to fetch|NetworkError|ECONNRESET|ETIMEDOUT/i
    .test(errorText(err));

/** Rate limit / quota: retrying the same model right away won't help, another model might. */
const isRateLimited = (err: any): boolean =>
  Number(err?.status) === 429 || /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(errorText(err));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GeminiBusyError extends Error {
  constructor(public cause: unknown) {
    super("Google's Gemini service is overloaded right now (503). We retried automatically, but it's still busy. Please try again in a minute.");
    this.name = "GeminiBusyError";
  }
}

const generate = async (params: Omit<GenerateParams, "model">) => {
  const ai = getAI();
  const models = [PRIMARY_MODEL, ...FALLBACK_MODELS];
  let lastError: unknown;

  for (const [m, model] of models.entries()) {
    // Fallback models may not support thinkingLevel; drop it rather than risk a 400.
    const config = m === 0 || !params.config ? params.config : { ...params.config, thinkingConfig: undefined };
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
      try {
        return await ai.models.generateContent({ ...params, config, model });
      } catch (err) {
        lastError = err;
        if (isRateLimited(err)) break;               // try the next model
        if (!isTransient(err)) throw err;            // bad key, bad request, ...: surface as-is
        if (attempt < MAX_ATTEMPTS_PER_MODEL) {
          const delay = BASE_DELAY_MS * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5);
          console.warn(`Gemini ${model} busy (attempt ${attempt}/${MAX_ATTEMPTS_PER_MODEL}), retrying in ${Math.round(delay)} ms`);
          await sleep(delay);
        }
      }
    }
    if (m < models.length - 1) console.warn(`Gemini ${model} unavailable, falling back to ${models[m + 1]}`);
  }
  if (isTransient(lastError)) throw new GeminiBusyError(lastError);
  throw lastError;
};

export const parseResume = async (text: string): Promise<ResumeData> => {
  const truncatedText = text.slice(0, 15000);

  const response = await generate({
    contents: `You are an expert resume parser. Extract information from the following text into structured JSON.
    
    Resume Text:
    ${truncatedText}`,
    config: {
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      systemInstruction: "Extract resume data accurately. Preserve original wording. If missing, use empty string/array. Ensure 'bullets' are clean strings. DO NOT extract a summary, professional profile, or locations (city/state).",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          phone: { type: Type.STRING },
          email: { type: Type.STRING },
          linkedin: { type: Type.STRING },
          github: { type: Type.STRING },
          education: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                school: { type: Type.STRING },
                degree: { type: Type.STRING },
                date: { type: Type.STRING }
              }
            }
          },
          skills: {
            type: Type.OBJECT,
            properties: {
              languages: { type: Type.STRING },
              frameworks: { type: Type.STRING },
              tools: { type: Type.STRING },
              libraries: { type: Type.STRING }
            }
          },
          experience: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                role: { type: Type.STRING },
                date: { type: Type.STRING },
                company: { type: Type.STRING },
                bullets: { type: Type.ARRAY, items: { type: Type.STRING } }
              }
            }
          },
          projects: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                tech: { type: Type.STRING },
                date: { type: Type.STRING },
                link: { type: Type.STRING, description: "Project URL or GitHub repository link if available" },
                bullets: { type: Type.ARRAY, items: { type: Type.STRING } }
              }
            }
          }
        }
      }
    }
  });

  return JSON.parse(response.text || "{}");
};

export const analyzeResume = async (resume: ResumeData, jd?: string) => {
  const prompt = jd 
    ? `Analyze this resume against the following Job Description (JD). 
       Provide an ATS score (0-100), a list of missing keywords, and specific actionable suggestions.
       
       CRITICAL STANDARDS:
       1. SECTION ORDER: Education -> Technical Skills -> Experience -> Projects.
       2. ATS SCORE: Aim for a score > 80.
       3. EXPERIENCE ORDER: Prioritize JD-related experience. Reorder experience items if a later one is more relevant to the JD.
       4. BULLET STYLE: 
          - One sentence per line.
          - EVERY sentence MUST end with a period (.).
          - NO semicolons.
          - NO long complex sentences.
          - Concise language, clear numbers, quantified results.
          - DO NOT fabricate numbers. If a number is needed but unknown, use a placeholder like "[number]".
          - Try to keep each bullet to a single line.
       5. GRANULARITY: 
          - Provide suggestions SENTENCE BY SENTENCE. Do not suggest changing an entire paragraph if only one sentence needs improvement.
          - If a bullet point has multiple sentences, identify the specific sentence to change.
       6. FORMATTING: Avoid parentheses. Ensure the resume stays on one page.
          - If the content is significantly less than one page, suggest adding more relevant projects, skills, or detailed experience bullets to fill the space.
          - If the resume exceeds one page, suggest removing less relevant projects or experience items, or shortening bullet points to fit on a single page.
          - If there are more than 3 projects, suggest reducing the number of projects to prioritize the most relevant ones.
          - ONE PAGE IS A HARD REQUIREMENT. If it's too long, you MUST suggest specific deletions.
       7. CONTENT: 
          - Add missing technical skills from the JD to the "skills" section.
          - DO NOT change company names.
          - DO NOT extract or suggest locations (city/state).
          - If the job title is not close to the JD, suggest a more relevant title but add a "comment" in the suggestion text for the user to verify.
       8. SUGGESTIONS:
          - Each suggestion MUST include a "proposedChange" which is a partial ResumeData object that can be merged into the current resume.
          - If updating a list, provide the FULL array with the updated item.
          - Include "originalValue" and "suggestedValue".
          - The "text" should explicitly state WHAT is being changed.
          - If the suggestion is to ADD or REMOVE a section or item, clearly state "ADD" or "REMOVE" in the suggestion text.
       
       Resume: ${JSON.stringify(resume)}
       JD: ${jd}`
    : `Analyze this resume for general ATS compatibility. 
       Provide an ATS score (0-100), general improvements, and formatting suggestions.
       
       CRITICAL STANDARDS:
       1. SECTION ORDER: Education -> Technical Skills -> Experience -> Projects.
       2. ATS SCORE: Aim for a score > 80.
       3. BULLET STYLE: 
          - One sentence per line.
          - EVERY sentence MUST end with a period (.).
          - NO semicolons.
          - NO long complex sentences.
          - Concise language, clear numbers, quantified results.
          - DO NOT fabricate numbers. If a number is needed but unknown, use a placeholder like "[number]".
          - Try to keep each bullet to a single line.
       4. GRANULARITY: 
          - Provide suggestions SENTENCE BY SENTENCE. Do not suggest changing an entire paragraph if only one sentence needs improvement.
          - If a bullet point has multiple sentences, identify the specific sentence to change.
       5. FORMATTING: Avoid parentheses. Ensure the resume stays on one page.
          - If the content is significantly less than one page, suggest adding more relevant projects, skills, or detailed experience bullets to fill the space.
          - If the resume exceeds one page, suggest removing less relevant projects or experience items, or shortening bullet points to fit on a single page.
          - If there are more than 3 projects, suggest reducing the number of projects to prioritize the most relevant ones.
          - ONE PAGE IS A HARD REQUIREMENT. If it's too long, you MUST suggest specific deletions.
       6. SUGGESTIONS:
          - Each suggestion MUST include a "proposedChange" which is a partial ResumeData object that can be merged into the current resume.
          - If updating a list, provide the FULL array with the updated item.
          - Include "originalValue" and "suggestedValue".
          - The "text" should explicitly state WHAT is being changed.
          - If the suggestion is to ADD or REMOVE a section or item, clearly state "ADD" or "REMOVE" in the suggestion text.
       
       Resume: ${JSON.stringify(resume)}`;

  const response = await generate({
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.NUMBER },
          missingKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
          suggestions: { 
            type: Type.ARRAY, 
            items: { 
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                text: { type: Type.STRING },
                originalValue: { type: Type.STRING },
                suggestedValue: { type: Type.STRING },
                actionLabel: { type: Type.STRING },
                category: { type: Type.STRING },
                proposedChange: { type: Type.OBJECT }
              },
              required: ["id", "text", "actionLabel", "proposedChange"]
            } 
          },
        },
        required: ["score", "suggestions"]
      }
    }
  });

  return JSON.parse(response.text || "{}");
};

export const improveBullet = async (bullet: string, jd?: string): Promise<string> => {
  const prompt = jd 
    ? `Improve this resume bullet point to better match the following Job Description (JD). 
       
       STANDARDS:
       - One sentence per line.
       - EVERY sentence MUST end with a period (.).
       - NO semicolons.
       - NO long complex sentences.
       - Concise language, strong action verbs, clear numbers, quantified results.
       - DO NOT fabricate numbers. Use "[number]" for unknown values.
       - NO extra spaces around hyphens (e.g., use "low-latency" NOT "low - latency").
       - Try to keep it to a single line.
       - Avoid parentheses.
       
       Bullet: ${bullet}
       JD: ${jd}`
    : `Improve this resume bullet point. 
       
       STANDARDS:
       - One sentence per line.
       - EVERY sentence MUST end with a period (.).
       - NO semicolons.
       - NO long complex sentences.
       - Concise language, strong action verbs, clear numbers, quantified results.
       - DO NOT fabricate numbers. Use "[number]" for unknown values.
       - NO extra spaces around hyphens (e.g., use "low-latency" NOT "low - latency").
       - Try to keep it to a single line.
       - Avoid parentheses.
       
       Bullet: ${bullet}`;

  const response = await generate({
    contents: prompt,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
    }
  });

  return response.text?.trim() || bullet;
};

export const optimizeResumeForJD = async (resume: ResumeData, jd: string) => {
  const response = await generate({
    contents: `Analyze this resume against the following Job Description (JD) and provide specific, actionable optimization suggestions to improve the match rate.
    
    CRITICAL STANDARDS:
    1. SECTION ORDER: Education -> Technical Skills -> Experience -> Projects.
    2. ATS SCORE: Aim for a score > 80.
    3. EXPERIENCE ORDER: Prioritize JD-related experience. Reorder experience items if a later one is more relevant to the JD.
    4. BULLET STYLE: 
       - One sentence per line.
       - EVERY sentence MUST end with a period (.).
       - NO semicolons.
       - NO long complex sentences.
       - Concise language, clear numbers, quantified results.
       - DO NOT fabricate numbers. If a number is needed but unknown, use a placeholder like "[number]".
       - NO extra spaces around hyphens (e.g., use "low-latency" NOT "low - latency").
       - Try to keep each bullet to a single line.
    5. GRANULARITY: 
       - Provide suggestions SENTENCE BY SENTENCE. Do not suggest changing an entire paragraph if only one sentence needs improvement.
       - If a bullet point has multiple sentences, identify the specific sentence to change.
    6. FORMATTING: Avoid parentheses. Ensure the resume stays on one page.
       - If the content is significantly less than one page, suggest adding more relevant projects, skills, or detailed experience bullets to fill the space.
       - If the resume exceeds one page, suggest removing less relevant projects or experience items, or shortening bullet points to fit on a single page.
       - If there are more than 3 projects, suggest reducing the number of projects to prioritize the most relevant ones.
       - ONE PAGE IS A HARD REQUIREMENT. If it's too long, you MUST suggest specific deletions.
    7. CONTENT: 
       - Add missing technical skills from the JD to the "skills" section.
       - DO NOT change company names.
       - DO NOT extract or suggest locations (city/state).
       - If the job title is not close to the JD, suggest a more relevant title but add a "comment" in the suggestion text for the user to verify.
    8. SUGGESTIONS:
       - Each suggestion MUST include a "proposedChange" which is a partial ResumeData object that can be merged into the current resume.
       - If updating a list, provide the FULL array with the updated item.
       - Include "originalValue" and "suggestedValue".
       - Provide a "scoreImpact" (number).
       - If the suggestion is to ADD or REMOVE a section or item, clearly state "ADD" or "REMOVE" in the suggestion text.
    
    Resume: ${JSON.stringify(resume)}
    JD: ${jd}`,
    config: {
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          overallMatchScore: { type: Type.NUMBER },
          suggestions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                text: { type: Type.STRING },
                originalValue: { type: Type.STRING },
                suggestedValue: { type: Type.STRING },
                scoreImpact: { type: Type.NUMBER },
                category: { type: Type.STRING },
                proposedChange: { type: Type.OBJECT }
              },
              required: ["id", "text", "proposedChange", "originalValue", "suggestedValue"]
            }
          }
        },
        required: ["overallMatchScore", "suggestions"]
      }
    }
  });

  return JSON.parse(response.text || "{}");
};
