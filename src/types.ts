
export interface Modification {
  section: string;
  original: string;
  optimized: string;
  reason: string;
}

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export interface Suggestion {
  id: string;
  text: string;
  actionLabel: string;
  proposedChange: Partial<ResumeData>;
  category: string;
  originalValue?: string;
  suggestedValue?: string;
  scoreImpact?: number;
}

export interface ResumeData {
  name: string;
  phone: string;
  email: string;
  linkedin: string;
  github: string;
  education: Array<{
    school: string;
    degree: string;
    date: string;
    gpa?: string;
  }>;
  skills: {
    languages: string;
    frameworks: string;
    tools: string;
    libraries: string;
  };
  experience: Array<{
    role: string;
    date: string;
    company: string;
    bullets: string[];
  }>;
  projects: Array<{
    name: string;
    tech: string;
    date: string;
    bullets: string[];
  }>;
  sectionTitles?: {
    education: string;
    experience: string;
    projects: string;
    skills: string;
  };
  customSections?: Array<{
    title: string;
    items: Array<{
      title: string;
      subtitle?: string;
      date?: string;
      bullets: string[];
    }>;
  }>;
  modifications?: Modification[];
}

export const ensureResumeData = (data: any): ResumeData => {
  return {
    name: data?.name || "",
    phone: data?.phone || "",
    email: data?.email || "",
    linkedin: data?.linkedin || "",
    github: data?.github || "",
    education: Array.isArray(data?.education) ? data.education.map((e: any) => ({
      school: e.school || "",
      degree: e.degree || "",
      date: e.date || "",
      gpa: e.gpa || ""
    })) : [],
    skills: {
      languages: data?.skills?.languages || "",
      frameworks: data?.skills?.frameworks || "",
      tools: data?.skills?.tools || "",
      libraries: data?.skills?.libraries || "",
    },
    experience: Array.isArray(data?.experience) ? data.experience.map((e: any) => ({
      role: e.role || "",
      date: e.date || "",
      company: e.company || "",
      bullets: Array.isArray(e.bullets) ? e.bullets : []
    })) : [],
    projects: Array.isArray(data?.projects) ? data.projects.map((p: any) => ({
      name: p.name || "",
      tech: p.tech || "",
      date: p.date || "",
      bullets: Array.isArray(p.bullets) ? p.bullets : []
    })) : [],
    sectionTitles: {
      education: data?.sectionTitles?.education || "Education",
      experience: data?.sectionTitles?.experience || "Experience",
      projects: data?.sectionTitles?.projects || "Projects",
      skills: data?.sectionTitles?.skills || "Technical Skills",
    },
    customSections: Array.isArray(data?.customSections) ? data.customSections.map((s: any) => ({
      title: s.title || "",
      items: Array.isArray(s.items) ? s.items.map((i: any) => ({
        title: i.title || "",
        subtitle: i.subtitle || "",
        date: i.date || "",
        bullets: Array.isArray(i.bullets) ? i.bullets : []
      })) : []
    })) : [],
    modifications: Array.isArray(data?.modifications) ? data.modifications : [],
  };
};

export const INITIAL_RESUME: ResumeData = {
  name: "Jake Ryan",
  phone: "123-456-7890",
  email: "jake@su.edu",
  linkedin: "linkedin.com/in/jake",
  github: "github.com/jake",
  education: [
    {
      school: "Southwestern University",
      degree: "Bachelor of Arts in Computer Science, Minor in Business",
      date: "Aug. 2018 -- May 2021",
      gpa: "3.9/4.0"
    },
    {
      school: "Blinn College",
      degree: "Associate's in Liberal Arts",
      date: "Aug. 2014 -- May 2018",
      gpa: "4.0/4.0"
    }
  ],
  skills: {
    languages: "Java, Python, C/C++, SQL (Postgres), JavaScript, HTML/CSS, R",
    frameworks: "React, Node.js, Flask, JUnit, WordPress, Material-UI, FastAPI",
    tools: "Git, Docker, TravisCI, Google Cloud Platform, VS Code, Visual Studio, PyCharm, IntelliJ, Eclipse",
    libraries: "pandas, NumPy, Matplotlib"
  },
  experience: [
    {
      role: "Software Engineer Intern",
      company: "Texas A&M University",
      date: "June 2020 -- Present",
      bullets: [
        "Designed and deployed a RESTful API using FastAPI and PostgreSQL, reducing data retrieval latency by 30% for learning management system integrations",
        "Built a full-stack web application with Flask, React, PostgreSQL, and Docker to automate GitHub repository analytics, cutting manual reporting time by 50%",
        "Created interactive data visualizations of GitHub collaboration networks, enabling instructors to assess student engagement across 10+ courses simultaneously"
      ]
    },
    {
      role: "Software Engineer Intern",
      company: "Southwestern University",
      date: "Sep. 2018 -- Present",
      bullets: [
        "Provisioned and configured 100+ campus computers per semester in coordination with department managers, achieving zero deployment delays",
        "Resolved 200+ student, faculty, and staff technical support tickets per year with an average turnaround time of under 24 hours",
        "Maintained and serviced 200 printers and all classroom A/V equipment campus-wide, sustaining 99%+ operational uptime"
      ]
    },
    {
      role: "Software Engineer Intern",
      company: "Southwestern University",
      date: "May 2019 -- July 2019",
      bullets: [
        "Designed and implemented a procedural dungeon generation system in Java inspired by The Legend of Zelda, producing 5+ distinct generation algorithms",
        "Contributed 50K+ lines of production-quality code to an established codebase, maintaining full test coverage via Git-based CI workflows",
        "Conducted a human-subject study with 30+ participants to evaluate player satisfaction across dungeon generation techniques, informing algorithm selection",
        "Authored an 8-page research paper and delivered 3 on-campus presentations; presented findings virtually at the World Conference on Computational Intelligence"
      ]
    }
  ],
  projects: [
    {
      name: "Gitlytics",
      tech: "Python, Flask, React, PostgreSQL, Docker",
      date: "June 2020 -- Present",
      bullets: [
        "Architected a full-stack analytics platform with a Flask REST API backend and React frontend, supporting real-time GitHub repository insights for 50+ users",
        "Integrated GitHub OAuth 2.0 to securely fetch and process repository data, enabling per-user dashboards with granular contribution breakdowns",
        "Built interactive collaboration visualizations (graphs, heatmaps) that reduced code review preparation time by an estimated 40%",
        "Leveraged Celery and Redis to offload asynchronous data processing tasks, improving API response times by 60%"
      ]
    }
  ],
  sectionTitles: {
    education: "Education",
    experience: "Experience",
    projects: "Projects",
    skills: "Technical Skills"
  },
  customSections: []
};
