import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import * as cheerio from "cheerio";
import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize SQLite database
const db = new Database("resumes.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS resumes (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "10mb" }));

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Share resume
  app.post("/api/resumes", (req, res) => {
    try {
      const { data } = req.body;
      if (!data) {
        return res.status(400).json({ error: "Resume data is required" });
      }

      const id = uuidv4().substring(0, 8); // Short ID for sharing
      const stmt = db.prepare("INSERT INTO resumes (id, data) VALUES (?, ?)");
      stmt.run(id, JSON.stringify(data));

      res.json({ id });
    } catch (error: any) {
      console.error("Error saving resume:", error.message);
      res.status(500).json({ error: "Failed to save resume" });
    }
  });

  // Get shared resume
  app.get("/api/resumes/:id", (req, res) => {
    try {
      const { id } = req.params;
      const stmt = db.prepare("SELECT data FROM resumes WHERE id = ?");
      const row = stmt.get(id) as { data: string } | undefined;

      if (!row) {
        return res.status(404).json({ error: "Resume not found" });
      }

      res.json({ data: JSON.parse(row.data) });
    } catch (error: any) {
      console.error("Error fetching resume:", error.message);
      res.status(500).json({ error: "Failed to fetch resume" });
    }
  });

  app.get("/api/fetch-jd", async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      const response = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
        timeout: 10000,
      });

      const $ = cheerio.load(response.data);
      
      // Remove script and style elements
      $("script, style, nav, footer, header").remove();
      
      // Try to find common JD containers or just get body text
      let text = "";
      
      // Common JD selectors
      const selectors = [
        ".job-description",
        "#job-description",
        ".description",
        "[data-automation='jobDescription']",
        ".jobsearch-JobComponent-description", // Indeed
        ".description__text", // LinkedIn
        ".job-details",
        "article",
        "main"
      ];
      
      for (const selector of selectors) {
        const content = $(selector).text().trim();
        if (content.length > 200) {
          text = content;
          break;
        }
      }
      
      if (!text) {
        text = $("body").text().trim();
      }

      // Clean up whitespace
      text = text.replace(/\s+/g, " ").trim();

      res.json({ text });
    } catch (error: any) {
      console.error("Error fetching JD:", error.message);
      res.status(500).json({ error: "Failed to fetch JD from the provided URL" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
