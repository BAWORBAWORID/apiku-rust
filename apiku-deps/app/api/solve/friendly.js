import fs from "fs";
import path from "path";
import axios from "axios";

let friendlyPow = null;
async function loadFriendlyPow() {
  if (friendlyPow) return friendlyPow;
  const { createRequire } = await import("module");
  const require = createRequire(import.meta.url);
  return require("friendly-pow");
}

const DEFAULT_ENDPOINT = "https://api.friendlycaptcha.com/api/v1/puzzle";

let wasmModulePromise = null;
async function loadWasmModule() {
  if (!wasmModulePromise) {
    wasmModulePromise = (async () => {
      const { createRequire } = await import("module");
      const require = createRequire(import.meta.url);
      const pkgPath = require.resolve("friendly-pow/package.json");
      const wasmPath = path.join(path.dirname(pkgPath), "wasm", "optimized.wasm");
      const bytes = fs.readFileSync(wasmPath);
      return WebAssembly.compile(bytes);
    })();
  }
  return wasmModulePromise;
}

async function fetchPuzzle(puzzleEndpoint, sitekey) {
  const url = puzzleEndpoint + "?sitekey=" + encodeURIComponent(sitekey);
  const res = await axios.get(url, {
    timeout: 20000,
    headers: { "x-frc-client": "js-0.9.0" },
  });
  const data = res.data;
  if (!data || !data.success || !data.data || !data.data.puzzle) {
    throw new Error("Invalid puzzle response: " + JSON.stringify(data).slice(0, 200));
  }
  return data.data.puzzle;
}

async function solveFriendly({ sitekey, puzzleEndpoint, timeout = 180 } = {}) {
  const startTime = Date.now();
  if (!sitekey) {
    throw new Error("sitekey is required");
  }
  const endpoint = puzzleEndpoint || DEFAULT_ENDPOINT;
  const timeoutMs = Math.min(Math.max((timeout || 180) * 1000, 10000), 600000);

  const puzzle = await fetchPuzzle(endpoint, sitekey);
  const parts = String(puzzle).split(".");
  if (parts.length < 2) {
    throw new Error("Malformed puzzle (expected signature.base64)");
  }

  const { createRequire } = await import("module");
  const require = createRequire(import.meta.url);
  const friendlyPow = require("friendly-pow");

  const buffer = friendlyPow.node.base64.decode(parts[1]);
  const n = buffer[friendlyPow.node.puzzle.NUMBER_OF_PUZZLES_OFFSET];
  const threshold = friendlyPow.node.encoding.difficultyToThreshold(buffer[friendlyPow.node.puzzle.PUZZLE_DIFFICULTY_OFFSET]);
  if (!n || n <= 0 || n > 512) {
    throw new Error("Malformed puzzle (bad puzzle count)");
  }

  const inputs = friendlyPow.node.puzzle.getPuzzleSolverInputs(buffer, n);
  const solve = await getWasmSolver(await loadWasmModule());

  const solutions = [];
  for (const input of inputs) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error("Timeout solving FriendlyCaptcha puzzle");
    }
    const out = solve(input, threshold);
    const s = out && out[0];
    const h = out && out[1];
    if (!s || !h || h.length === 0) {
      throw new Error("No solution found for puzzle part");
    }
    solutions.push(s.slice(-8));
  }

  const combined = friendlyPow.node.puzzle.combineSolutions(solutions);
  const elapsedSec = (Date.now() - startTime) / 1000;
  const diagnostics = friendlyPow.node.diagnostics.createDiagnosticsBuffer(2, elapsedSec);
  const solution = `${parts[0]}.${parts[1]}.${friendlyPow.node.base64.encode(combined)}.${friendlyPow.node.base64.encode(diagnostics)}`;

  return {
    success: true,
    data: {
      solution,
      puzzles: n,
      field: "frc-captcha-solution",
    },
    duration: Date.now() - startTime,
  };
}

async function getWasmSolver(wasmModule) {
  const { createRequire } = await import("module");
  const require = createRequire(import.meta.url);
  const friendlyPow = require("friendly-pow");
  return friendlyPow.node.api.wasm.getWasmSolver(wasmModule);
}

export default {
  name: "FriendlyCaptcha Solver",
  description: "Solve FriendlyCaptcha using WASM-based proof-of-work solver",
  category: "Solve",
  methods: ["POST"],

  params: ["sitekey", "puzzleEndpoint", "timeout"],

  paramsSchema: {
    sitekey: {
      type: "string",
      required: true,
      description: "FriendlyCaptcha sitekey",
      example: "FRC1234567890ABCDEF",
    },
    puzzleEndpoint: {
      type: "string",
      required: false,
      default: "https://api.friendlycaptcha.com/api/v1/puzzle",
      description: "Puzzle endpoint URL",
      example: "https://api.friendlycaptcha.com/api/v1/puzzle",
    },
    timeout: {
      type: "number",
      required: false,
      default: 180,
      description: "Timeout in seconds",
      example: 180,
    },
  },

  async run(req, res) {
    try {
      const { sitekey, puzzleEndpoint, timeout } = { ...req.query, ...req.body };

      if (!sitekey) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'sitekey' wajib diisi",
        });
      }

      const result = await solveFriendly({
        sitekey,
        puzzleEndpoint,
        timeout: parseInt(timeout) || 180,
      });

      return res.json({
        status: true,
        result: {
          solution: result.data.solution,
          puzzles: result.data.puzzles,
          field: result.data.field,
          duration: result.duration,
        },
      });
    } catch (e) {
      return res.status(500).json({
        status: false,
        message: e.message || "Gagal solve FriendlyCaptcha",
      });
    }
  }
};