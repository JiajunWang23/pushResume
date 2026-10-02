import { ResumeData } from "./types";

/**
 * Deterministic, explainable ATS score.
 *
 * The score is computed from the resume itself with fixed rules (not by the LLM), so:
 *  - an empty resume scores 0,
 *  - the same resume always gets the same score,
 *  - every point gained or lost comes with a reason the user can act on.
 * Gemini is still used for the written improvement suggestions.
 */

export interface ScoreCheck {
  ok: boolean;
  text: string;
}

export interface ScoreCategory {
  id: string;
  label: string;
  points: number; // earned, rounded
  max: number;
  checks: ScoreCheck[];
}

export interface AtsScore {
  score: number;
  categories: ScoreCategory[];
  isEmpty: boolean;
}

const ACTION_VERBS = new Set(
  `accelerated achieved added administered analyzed architected assembled automated boosted built
   championed collaborated configured consolidated constructed contributed converted coordinated created
   cut debugged decreased defined delivered deployed designed developed devised diagnosed directed doubled
   drove eliminated enabled engineered enhanced established evaluated executed expanded facilitated fixed
   formulated founded generated grew guided halved identified implemented improved increased initiated
   instrumented integrated introduced invented launched led maintained managed mentored migrated modeled
   modernized monitored negotiated optimized orchestrated organized owned partnered piloted pioneered
   planned presented prioritized produced profiled programmed prototyped published raised reduced
   refactored redesigned reengineered released replaced resolved restructured revamped scaled secured
   shipped simplified spearheaded standardized streamlined strengthened supported tested trained
   transformed tripled troubleshot tuned unified upgraded validated visualized wrote`.split(/\s+/)
);

const STOPWORDS = new Set(
  `a about above across after all also an and any are as at be been being both but by can could did do
   does each etc for from has have having he her his how i if in including into is it its may more most
   must not of on or other our out over own per plus preferred required requirements responsibilities
   role same should so some such than that the their them then there these they this those through to
   under up us using via was we well were what when where which while who will with within work would
   you your years year experience team teams ability strong excellent knowledge skills skill job
   candidate candidates position company opportunity qualifications minimum bonus nice working
   understanding familiarity proficiency proficient related field degree equivalent including`.split(/\s+/)
);

const wordsOf = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const has = (s?: string) => !!s && s.trim().length > 0;

function allBullets(r: ResumeData): string[] {
  return [
    ...(r.experience || []).flatMap((e) => e.bullets || []),
    ...(r.projects || []).flatMap((p) => p.bullets || []),
  ].map((b) => (b || "").trim()).filter(Boolean);
}

function resumeText(r: ResumeData): string {
  return [
    r.name, r.email, r.linkedin, r.github,
    ...Object.values(r.skills || {}),
    ...(r.education || []).flatMap((e) => [e.school, e.degree]),
    ...(r.experience || []).flatMap((e) => [e.role, e.company, ...(e.bullets || [])]),
    ...(r.projects || []).flatMap((p) => [p.name, p.tech, ...(p.bullets || [])]),
  ].filter(Boolean).join(" ").toLowerCase();
}

function skillList(r: ResumeData): string[] {
  return Object.values(r.skills || {})
    .flatMap((v) => (v || "").split(/[,;|/·•]+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function isResumeEmpty(r: ResumeData): boolean {
  return !has(r.name) && !has(r.email) && !has(r.phone) && allBullets(r).length === 0 &&
    skillList(r).length === 0 && !(r.education || []).some((e) => has(e.school) || has(e.degree));
}

/** Top JD terms (single words and common tech tokens like "c++", "node.js"), most frequent first. */
export function jdKeywords(jd: string, limit = 25): string[] {
  const counts = new Map<string, number>();
  for (const raw of jd.toLowerCase().match(/[a-z][a-z0-9+#.\-]*[a-z0-9+#]/g) || []) {
    const w = raw.replace(/\.$/, "");
    if (w.length < 2 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}

const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);

export function computeAtsScore(r: ResumeData, opts: { jd?: string; overPageLimit?: boolean } = {}): AtsScore {
  const bullets = allBullets(r);
  const empty = isResumeEmpty(r);
  const cats: ScoreCategory[] = [];
  const add = (id: string, label: string, max: number, ratio: number, checks: ScoreCheck[]) =>
    cats.push({ id, label, max, points: Math.round(max * clamp01(ratio)), checks });

  // 1. Contact info (10)
  {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((r.email || "").trim());
    const phoneOk = ((r.phone || "").match(/\d/g) || []).length >= 7;
    const profile = has(r.linkedin) || has(r.github);
    const parts = [has(r.name) ? 3 : 0, emailOk ? 3 : 0, phoneOk ? 2 : 0, profile ? 2 : 0];
    add("contact", "Contact information", 10, parts.reduce((a, b) => a + b, 0) / 10, [
      { ok: has(r.name), text: has(r.name) ? "Name is present" : "Add your full name" },
      { ok: emailOk, text: emailOk ? "Valid email" : has(r.email) ? "Email looks malformed" : "Add an email address" },
      { ok: phoneOk, text: phoneOk ? "Phone number present" : "Add a phone number" },
      { ok: profile, text: profile ? "LinkedIn/GitHub linked" : "Add a LinkedIn or GitHub link" },
    ]);
  }

  // 2. Required sections (15)
  {
    const edu = (r.education || []).some((e) => has(e.school) || has(e.degree));
    const skills = skillList(r).length > 0;
    const work = (r.experience || []).some((e) => has(e.role) || (e.bullets || []).some(has)) ||
      (r.projects || []).some((p) => has(p.name) || (p.bullets || []).some(has));
    add("sections", "Standard sections", 15, ((edu ? 5 : 0) + (skills ? 5 : 0) + (work ? 5 : 0)) / 15, [
      { ok: edu, text: edu ? "Education section found" : "Missing an Education section" },
      { ok: skills, text: skills ? "Technical Skills section found" : "Missing a Technical Skills section" },
      { ok: work, text: work ? "Experience/Projects found" : "Missing Experience or Projects" },
    ]);
  }

  // 3. Depth of experience (15)
  {
    const entries = [...(r.experience || []), ...(r.projects || [])].filter((e: any) => (e.bullets || []).some(has));
    const goodBulletCount = entries.filter((e: any) => {
      const n = (e.bullets || []).filter(has).length;
      return n >= 2 && n <= 5;
    }).length;
    const entryRatio = clamp01(entries.length / 3);
    const bulletRatio = entries.length ? goodBulletCount / entries.length : 0;
    add("depth", "Experience depth", 15, 0.6 * entryRatio + 0.4 * bulletRatio, [
      { ok: entries.length >= 3, text: `${entries.length} experience/project entr${entries.length === 1 ? "y" : "ies"} with bullets (aim for 3+)` },
      { ok: entries.length > 0 && goodBulletCount === entries.length,
        text: entries.length ? `${goodBulletCount}/${entries.length} entries have 2–5 bullets` : "No bullet points yet" },
    ]);
  }

  // 4. Quantified impact (20)
  {
    const quantified = bullets.filter((b) => /\d|%|\$|\b(one|two|three|four|five|ten|hundred|thousand|million|billion)\b/i.test(b));
    const ratio = bullets.length ? quantified.length / bullets.length : 0;
    add("metrics", "Quantified results", 20, ratio / 0.6, [
      { ok: ratio >= 0.6, text: bullets.length
          ? `${quantified.length}/${bullets.length} bullets (${pct(quantified.length, bullets.length)}%) include a number, % or $ (aim for 60%+)`
          : "No bullets to measure" },
    ]);
  }

  // 5. Action verbs (10)
  {
    const strong = bullets.filter((b) => {
      const first = (b.replace(/^[^A-Za-z]+/, "").split(/\s+/)[0] || "").toLowerCase().replace(/[^a-z]/g, "");
      return ACTION_VERBS.has(first) || (/ed$/.test(first) && first.length > 4);
    });
    const ratio = bullets.length ? strong.length / bullets.length : 0;
    add("verbs", "Strong action verbs", 10, ratio / 0.8, [
      { ok: ratio >= 0.8, text: bullets.length
          ? `${strong.length}/${bullets.length} bullets start with an action verb like "Built" or "Led" (aim for 80%+)`
          : "No bullets to measure" },
    ]);
  }

  // 6. Bullet style (10): period at end, no semicolons, no first person, not too long
  {
    const noPeriod = bullets.filter((b) => !/[.!?]$/.test(b)).length;
    const semi = bullets.filter((b) => b.includes(";")).length;
    const firstPerson = bullets.filter((b) => /\b(i|my|me|we|our)\b/i.test(b)).length;
    const long = bullets.filter((b) => wordsOf(b).length > 30).length;
    const clean = bullets.filter((b) => /[.!?]$/.test(b) && !b.includes(";") &&
      !/\b(i|my|me|we|our)\b/i.test(b) && wordsOf(b).length <= 30).length;
    add("style", "Bullet formatting", 10, bullets.length ? clean / bullets.length : 0, bullets.length ? [
      { ok: noPeriod === 0, text: noPeriod ? `${noPeriod} bullet(s) don't end with a period` : "All bullets end with a period" },
      { ok: semi === 0, text: semi ? `${semi} bullet(s) use semicolons` : "No semicolons" },
      { ok: firstPerson === 0, text: firstPerson ? `${firstPerson} bullet(s) use "I/my/we"` : "No first-person pronouns" },
      { ok: long === 0, text: long ? `${long} bullet(s) are over 30 words` : "Bullets are concise" },
    ] : [{ ok: false, text: "No bullets to check" }]);
  }

  // 7. Skills (10)
  {
    const n = new Set(skillList(r).map((s) => s.toLowerCase())).size;
    add("skills", "Technical skills", 10, n / 8, [
      { ok: n >= 8, text: `${n} skill${n === 1 ? "" : "s"} listed (aim for 8+)` },
    ]);
  }

  // 8. Length (10): one page, not too thin
  {
    const thin = bullets.length < 8;
    const ratio = empty ? 0 : (opts.overPageLimit ? 0.3 : 1) * (thin ? clamp01(bullets.length / 8) : 1);
    add("length", "Length", 10, ratio, [
      { ok: !opts.overPageLimit && !empty, text: empty ? "Resume is empty" : opts.overPageLimit ? "Runs over one page" : "Fits on one page" },
      { ok: !thin, text: thin ? `Only ${bullets.length} bullet(s): add more detail (8+)` : `${bullets.length} bullets total` },
    ]);
  }

  // 9. Optional: JD keyword match (scaled to 25% of the total when a JD is provided)
  let score: number;
  const base = cats.reduce((a, c) => a + c.points, 0); // out of 100
  const jd = (opts.jd || "").trim();
  if (jd) {
    const kws = jdKeywords(jd);
    const text = resumeText(r);
    const hit = kws.filter((k) => text.includes(k));
    const miss = kws.filter((k) => !text.includes(k));
    const ratio = kws.length ? hit.length / kws.length : 0;
    cats.push({
      id: "jd", label: "Job description match", max: 25, points: Math.round(25 * ratio),
      checks: [
        { ok: ratio >= 0.6, text: `${hit.length}/${kws.length} key JD terms appear in your resume` },
        ...(miss.length ? [{ ok: false, text: `Missing: ${miss.slice(0, 10).join(", ")}` }] : []),
      ],
    });
    // other categories scale down to 75 points
    for (const c of cats) if (c.id !== "jd") { c.max = Math.round(c.max * 0.75 * 10) / 10; c.points = Math.round(c.points * 0.75 * 10) / 10; }
    score = Math.round(base * 0.75 + 25 * ratio);
  } else {
    score = base;
  }

  return { score: empty ? 0 : Math.max(0, Math.min(100, score)), categories: cats, isEmpty: empty };
}

// =======================================================================================
// JD match score: deterministic matching of the resume against keywords extracted from
// the JD (by the LLM, once per JD). Every point lost maps to a concrete improvement.
// =======================================================================================
export interface JdKeywordInput { term: string; aliases?: string[] }
export interface JdMatchInput { jobTitle?: string; required: JdKeywordInput[]; preferred: JdKeywordInput[] }

export interface Improvement { gain: number; text: string; priority: number }
export interface JdMatch {
  score: number;
  categories: ScoreCategory[];
  improvements: Improvement[]; // sorted by estimated points gained
  matched: string[];
  missingRequired: string[];
  missingPreferred: string[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-term match that also works for tokens like "C++", "C#", "Node.js", "CI/CD". */
function mentions(haystack: string, kw: JdKeywordInput): boolean {
  return [kw.term, ...(kw.aliases || [])].filter(Boolean).some((t) => {
    const re = new RegExp(`(^|[^a-z0-9])${escapeRe(t.toLowerCase().trim())}(?=$|[^a-z0-9+#])`, "i");
    return re.test(haystack);
  });
}

const TITLE_NOISE = new Set(["senior", "junior", "sr", "jr", "intern", "internship", "new", "grad", "graduate",
  "entry", "level", "i", "ii", "iii", "iv", "lead", "staff", "principal", "associate", "the", "and", "of", "-", "&", "2026", "2027"]);
const titleWords = (t: string) => (t.toLowerCase().match(/[a-z+#.]+/g) || []).filter((w) => !TITLE_NOISE.has(w));

export function computeJdMatch(r: ResumeData, kw: JdMatchInput): JdMatch {
  const full = resumeText(r);
  const inContext = [
    ...(r.experience || []).flatMap((e) => [e.role, ...(e.bullets || [])]),
    ...(r.projects || []).flatMap((p) => [p.tech, ...(p.bullets || [])]),
  ].filter(Boolean).join(" ").toLowerCase();

  const req = (kw.required || []).filter((k) => k?.term);
  const pref = (kw.preferred || []).filter((k) => k?.term);
  const reqHit = req.filter((k) => mentions(full, k));
  const reqMiss = req.filter((k) => !mentions(full, k));
  const prefHit = pref.filter((k) => mentions(full, k));
  const prefMiss = pref.filter((k) => !mentions(full, k));
  const skillsOnly = reqHit.filter((k) => !mentions(inContext, k));

  const cats: ScoreCategory[] = [];
  const improvements: Improvement[] = [];
  const cat = (id: string, label: string, max: number, ratio: number, checks: ScoreCheck[]) =>
    cats.push({ id, label, max, points: Math.round(max * clamp01(ratio)), checks });

  // Required skills (50)
  const perReq = req.length ? 50 / req.length : 0;
  cat("required", "Required skills", 50, req.length ? reqHit.length / req.length : 0, [
    { ok: reqMiss.length === 0, text: `${reqHit.length}/${req.length} required skills found on your resume` },
    ...(reqMiss.length ? [{ ok: false, text: `Missing: ${reqMiss.map((k) => k.term).join(", ")}` }] : []),
  ]);
  for (const k of reqMiss) improvements.push({ gain: perReq, priority: 0,
    text: `Required: add "${k.term}" if you have used it. List it under Skills and show it in a bullet that says where you used it.` });

  // Evidence in experience (20): required skills that appear in bullets/roles/project tech, not just the skills list
  const evidRatio = reqHit.length ? (reqHit.length - skillsOnly.length) / reqHit.length : 0;
  cat("evidence", "Skills shown in experience", 20, evidRatio, [
    { ok: skillsOnly.length === 0 && reqHit.length > 0,
      text: reqHit.length ? `${reqHit.length - skillsOnly.length}/${reqHit.length} matched skills appear in your experience or projects, not just the Skills list` : "No required skills matched yet" },
  ]);
  const perEvid = reqHit.length ? 20 / reqHit.length : 0;
  for (const k of skillsOnly) improvements.push({ gain: perEvid, priority: 1,
    text: `"${k.term}" is only in your Skills list. Mention it in an experience or project bullet so recruiters see where you used it.` });

  // Preferred skills (15)
  const perPref = pref.length ? 15 / pref.length : 0;
  cat("preferred", "Preferred / bonus skills", 15, pref.length ? prefHit.length / pref.length : 1, [
    { ok: prefMiss.length === 0, text: pref.length ? `${prefHit.length}/${pref.length} preferred skills found` : "The JD lists no preferred skills" },
    ...(prefMiss.length ? [{ ok: false, text: `Missing: ${prefMiss.map((k) => k.term).join(", ")}` }] : []),
  ]);
  for (const k of prefMiss) improvements.push({ gain: perPref, priority: 3, text: `Bonus: add "${k.term}" if you have real experience with it.` });

  // Title alignment (15)
  const target = titleWords(kw.jobTitle || "");
  const roles = (r.experience || []).map((e) => e.role).filter(Boolean);
  const roleWords = new Set(roles.flatMap(titleWords));
  const overlap = target.filter((w) => roleWords.has(w));
  const titleRatio = target.length ? overlap.length / target.length : 1;
  cat("title", "Job title alignment", 15, titleRatio, [
    { ok: titleRatio >= 0.5, text: target.length
        ? `Target title "${kw.jobTitle}": ${overlap.length ? `your roles share "${overlap.join(", ")}"` : "none of your role titles match"}`
        : "No job title found in the JD" },
  ]);
  if (target.length && titleRatio < 1) improvements.push({ gain: 15 * (1 - titleRatio), priority: 2,
    text: `Align with "${kw.jobTitle}": if accurate, use matching words in a role title, or open with your most relevant experience/projects.` });

  const score = Math.round(cats.reduce((a, c) => a + c.points, 0));
  improvements.sort((a, b) => a.priority - b.priority || b.gain - a.gain);
  return {
    score: isResumeEmpty(r) ? 0 : Math.min(100, score),
    categories: cats,
    improvements: improvements.map((i) => ({ ...i, gain: Math.max(1, Math.round(i.gain)) })),
    matched: reqHit.map((k) => k.term),
    missingRequired: reqMiss.map((k) => k.term),
    missingPreferred: prefMiss.map((k) => k.term),
  };
}
