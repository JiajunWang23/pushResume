import { GoogleGenAI } from "@google/genai";

export const generateLogo = async () => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        {
          text: 'A minimalist, unique logo for a website named "pushresume.net". Black and white color scheme. Elegant and professional design. The logo should represent "pushing" or "advancing" a career/resume. Vector style, clean lines, white background. No text, just the icon.',
        },
      ],
    },
    config: {
      imageConfig: {
        aspectRatio: "1:1",
      },
    },
  });
  
  for (const part of response.candidates[0].content.parts) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  return null;
};
