/**
 * GitReverse API
 * Reverse engineering GitHub repository into AI Prompt
 * GET/POST /api/ai/gitreverse?repo=WhiskeySockets/Baileys
 */

import axios from "axios";

const BASE_URL = "https://www.gitreverse.com";
const ENDPOINT = `${BASE_URL}/api/reverse-prompt`;

const UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36";

function normalizeRepo(input) {
  if (!input) {
    throw new Error("Parameter 'repo' atau 'url' wajib diisi");
  }

  let repo = String(input).trim();

  repo = repo
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/^(www\.)?github\.com\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");

  const parts = repo.split("/").filter(Boolean);

  if (parts.length < 2) {
    throw new Error(
      "Format repository tidak valid. Gunakan 'owner/repo' atau URL GitHub (contoh: WhiskeySockets/Baileys)"
    );
  }

  return `${parts[0]}/${parts[1]}`;
}

async function reverseGithub(input) {
  const repoUrl = normalizeRepo(input);

  const response = await axios.post(
    ENDPOINT,
    {
      repoUrl,
    },
    {
      timeout: 120000,
      headers: {
        "User-Agent": UA,
        Accept: "*/*",
        "Content-Type": "application/json",
        Origin: BASE_URL,
        Referer: `${BASE_URL}/${repoUrl}`,
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      validateStatus: () => true,
    }
  );

  if (response.status >= 400) {
    let body = response.data;
    if (typeof body !== "string") {
      try {
        body = JSON.stringify(body);
      } catch {
        body = String(body);
      }
    }
    throw new Error(`GitReverse error (${response.status}): ${body || response.statusText}`);
  }

  const data = response.data;
  if (!data) {
    throw new Error("Response dari GitReverse kosong");
  }

  if (!data.prompt) {
    throw new Error("Prompt tidak ditemukan pada response: " + JSON.stringify(data));
  }

  return {
    repository: repoUrl,
    githubUrl: `https://github.com/${repoUrl}`,
    prompt: data.prompt,
  };
}

export default {
  name: "GitReverse",
  description: "Reverse engineer GitHub repository menjadi AI Prompt instruksi pembangunan kode",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["repo"],

  paramsSchema: {
    repo: {
      type: "string",
      required: true,
      default: "WhiskeySockets/Baileys",
      description: "URL GitHub atau format owner/repository (contoh: WhiskeySockets/Baileys atau https://github.com/WhiskeySockets/Baileys)",
    },
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };
      const input = params.repo || params.url || params.repository;

      if (!input || typeof input !== "string" || input.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'repo' atau 'url' wajib diisi (contoh: WhiskeySockets/Baileys)",
        });
      }

      const result = await reverseGithub(input);

      return res.json({
        status: true,
        result,
      });
    } catch (err) {
      console.error("[GITREVERSE ERROR]:", err.message);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses GitReverse",
      });
    }
  },
};
