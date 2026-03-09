
import { ResumeData } from "./types";

const escapeLatex = (text: string): string => {
  if (!text) return "";
  return text
    .replace(/\\/g, "\\textbackslash ")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde ")
    .replace(/\^/g, "\\textasciicircum ")
    // Handle dashes and hyphens
    .replace(/–/g, "--") // en-dash
    .replace(/—/g, "---") // em-dash
    .replace(/[‐‑‒]/g, "-") // various hyphens (including non-breaking)
    .replace(/\s+-\s+/g, " -- ") // convert " - " to " -- " for better typography
    // Handle specific unicode characters reported by user
    .replace(/₂/g, "$_2$")
    .replace(/₁/g, "$_1$")
    .replace(/₀/g, "$_0$")
    .replace(/₃/g, "$_3$")
    .replace(/₄/g, "$_4$")
    .replace(/₅/g, "$_5$")
    .replace(/₆/g, "$_6$")
    .replace(/₇/g, "$_7$")
    .replace(/₈/g, "$_8$")
    .replace(/₉/g, "$_9$")
    .replace(/±/g, "$\\pm$")
    .replace(/²/g, "$^2$")
    .replace(/³/g, "$^3$")
    .replace(/¹/g, "$^1$")
    // Handle other common symbols
    .replace(/×/g, "$\\times$")
    .replace(/÷/g, "$\\div$")
    .replace(/°/g, "$^\\circ$")
    .replace(/•/g, "$\\bullet$")
    .replace(/…/g, "\\dots ")
    // Remove any other non-ASCII characters that might cause issues
    .replace(/[^\x00-\x7F]/g, (char) => {
      const map: {[key: string]: string} = {
        'é': "\\'e", 'è': "\\`e", 'ê': "\\^e", 'ë': '\\"e',
        'á': "\\'a", 'à': "\\`a", 'â': "\\^a", 'ä': '\\"a',
        'í': "\\'i", 'ì': "\\`i", 'î': "\\^i", 'ï': '\\"i',
        'ó': "\\'o", 'ò': "\\`o", 'ô': "\\^o", 'ö': '\\"o',
        'ú': "\\'u", 'ù': "\\`u", 'û': "\\^u", 'ü': '\\"u',
        'ñ': "\\~n", 'ç': "\\c{c}"
      };
      return map[char] || "";
    });
};

export const generateLatex = (data: ResumeData): string => {
  const educationStr = (data.education || []).map(edu => `
    \\resumeSubheading
      {${escapeLatex(edu.school)}}{}
      {${escapeLatex(edu.degree)}}{${escapeLatex(edu.date)}}`).join("");

  const experienceStr = (data.experience || []).map(exp => `
    \\resumeSubheading
      {${escapeLatex(exp.role)}}{${escapeLatex(exp.date)}}
      {${escapeLatex(exp.company)}}{}
      \\resumeItemListStart
      ${exp.bullets.filter(b => b).map(b => `\\resumeItem{${escapeLatex(b)}}`).join("\n        ")}
      \\resumeItemListEnd`).join("");

  const projectsStr = (data.projects || []).map(proj => `
      \\resumeProjectHeading
          {\\textbf{${escapeLatex(proj.name)}} $|$ \\emph{${escapeLatex(proj.tech)}}}{${escapeLatex(proj.date)}}
          \\resumeItemListStart
            ${proj.bullets.filter(b => b).map(b => `\\resumeItem{${escapeLatex(b)}}`).join("\n            ")}
          \\resumeItemListEnd`).join("");

  const customSectionsStr = (data.customSections || []).map(section => `
\\section{${escapeLatex(section.title)}}
  \\resumeSubHeadingListStart
    ${section.items.map(item => `
    \\resumeSubheading
      {${escapeLatex(item.title)}}{${escapeLatex(item.date || "")}}
      {${escapeLatex(item.subtitle || "")}}{}
      \\resumeItemListStart
        ${item.bullets.filter(b => b).map(b => `\\resumeItem{${escapeLatex(b)}}`).join("\n        ")}
      \\resumeItemListEnd`).join("")}
  \\resumeSubHeadingListEnd`).join("\n");

  return `%-------------------------
% Resume in Latex
% Author : pushResume
% Based off of: https://github.com/sb2nov/resume
% License : MIT
%------------------------

\\documentclass[letterpaper,11pt]{article}

\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{latexsym}
\\usepackage{textcomp}

% Handle common unicode characters
\\DeclareUnicodeCharacter{2080}{$_0$}
\\DeclareUnicodeCharacter{2081}{$_1$}
\\DeclareUnicodeCharacter{2082}{$_2$}
\\DeclareUnicodeCharacter{2083}{$_3$}
\\DeclareUnicodeCharacter{2084}{$_4$}
\\DeclareUnicodeCharacter{2085}{$_5$}
\\DeclareUnicodeCharacter{2086}{$_6$}
\\DeclareUnicodeCharacter{2087}{$_7$}
\\DeclareUnicodeCharacter{2088}{$_8$}
\\DeclareUnicodeCharacter{2089}{$_9$}
\\DeclareUnicodeCharacter{00B2}{$^2$}
\\DeclareUnicodeCharacter{00B3}{$^3$}
\\DeclareUnicodeCharacter{00B9}{$^1$}
\\usepackage[empty]{fullpage}
\\usepackage{titlesec}
\\usepackage{marvosym}
\\usepackage[usenames,dvipsnames]{color}
\\usepackage{verbatim}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\usepackage{fancyhdr}
\\usepackage[english]{babel}
\\usepackage{tabularx}
\\input{glyphtounicode}

\\pagestyle{fancy}
\\fancyhf{}
\\fancyfoot{}
\\renewcommand{\\headrulewidth}{0pt}
\\renewcommand{\\footrulewidth}{0pt}

\\addtolength{\\oddsidemargin}{-0.5in}
\\addtolength{\\evensidemargin}{-0.5in}
\\addtolength{\\textwidth}{1in}
\\addtolength{\\topmargin}{-.5in}
\\addtolength{\\textheight}{1.0in}

\\urlstyle{same}

\\raggedbottom
\\raggedright
\\setlength{\\tabcolsep}{0in}

\\titleformat{\\section}{
  \\vspace{-4pt}\\scshape\\raggedright\\large
}{}{0em}{}[\\color{black}\\titlerule \\vspace{-5pt}]

\\pdfgentounicode=1

\\newcommand{\\resumeItem}[1]{
  \\item\\small{
    \\upshape{#1 \\vspace{-2pt}}
  }
}

\\newcommand{\\resumeSubheading}[4]{
  \\vspace{-2pt}\\item
    \\begin{tabularx}{0.97\\textwidth}[t]{X r}
      \\textbf{\\upshape #1} & \\upshape #2 \\\\
      \\textit{\\small\\upshape #3} & \\textit{\\small\\upshape #4} \\\\
    \\end{tabularx}\\vspace{-7pt}
}

\\newcommand{\\resumeSubSubheading}[2]{
    \\item
    \\begin{tabularx}{0.97\\textwidth}{X r}
      \\textit{\\small#1} & \\textit{\\small #2} \\\\
    \\end{tabularx}\\vspace{-7pt}
}

\\newcommand{\\resumeProjectHeading}[2]{
    \\item
    \\begin{tabularx}{0.97\\textwidth}{X r}
      \\small#1 & #2 \\\\
    \\end{tabularx}\\vspace{-7pt}
}

\\newcommand{\\resumeSubItem}[1]{\\resumeItem{#1}\\vspace{-4pt}}

\\renewcommand\\labelitemii{$\\vcenter{\\hbox{\\tiny$\\bullet$}}$}

\\newcommand{\\resumeSubHeadingListStart}{\\begin{itemize}[leftmargin=0.15in, label={}]}
\\newcommand{\\resumeSubHeadingListEnd}{\\end{itemize}}
\\newcommand{\\resumeItemListStart}{\\begin{itemize}}
\\newcommand{\\resumeItemListEnd}{\\end{itemize}\\vspace{-5pt}}

%-------------------------------------------
%%%%%%  RESUME STARTS HERE  %%%%%%%%%%%%%%%%%%%%%%%%%%%%

\\begin{document}

%----------HEADING----------
\\begin{center}
    \\textbf{\\Huge \\scshape ${escapeLatex(data.name)}} \\\\ \\vspace{1pt}
    \\small ${escapeLatex(data.phone)} $|$ \\href{mailto:${data.email}}{\\underline{${escapeLatex(data.email)}}} $|$
    \\href{https://${data.linkedin}}{\\underline{${escapeLatex(data.linkedin)}}} $|$
    \\href{https://${data.github}}{\\underline{${escapeLatex(data.github)}}}
\\end{center}

%-----------EDUCATION-----------
\\section{Education}
  \\resumeSubHeadingListStart
    ${educationStr}
  \\resumeSubHeadingListEnd


%-----------PROGRAMMING SKILLS-----------
\\section{Technical Skills}
 \\begin{itemize}[leftmargin=0.15in, label={}]
    \\small{\\item{
     ${data.skills.languages ? `\\textbf{Languages}{: ${escapeLatex(data.skills.languages)}} \\\\` : ""}
     ${data.skills.frameworks ? `\\textbf{Frameworks}{: ${escapeLatex(data.skills.frameworks)}} \\\\` : ""}
     ${data.skills.tools ? `\\textbf{Developer Tools}{: ${escapeLatex(data.skills.tools)}} \\\\` : ""}
     ${data.skills.libraries ? `\\textbf{Libraries}{: ${escapeLatex(data.skills.libraries)}}` : ""}
    }}
 \\end{itemize}


%-----------EXPERIENCE-----------
\\section{Experience}
  \\resumeSubHeadingListStart
    ${experienceStr}
  \\resumeSubHeadingListEnd


%-----------PROJECTS-----------
\\section{Projects}
    \\resumeSubHeadingListStart
      ${projectsStr}
    \\resumeSubHeadingListEnd

${customSectionsStr}

%-------------------------------------------
\\end{document}`;
};
