/**
 * Akinator — Guess the Character game
 * Upstream : id.akinator.com (public game)
 * Feature  : start session → answer (0-4 / yes/no/idk/probably) → win profile | back | exclude
 */
import * as cheerio from "cheerio";
import { loadSession, saveSession } from "../../src/utils/session.js";

let gotScraping = null;
async function loadGotScraping() {
  if (!gotScraping) {
    const mod = await import("got-scraping");
    gotScraping = mod.gotScraping;
  }
  return gotScraping;
}

const BASE_URL = "https://id.akinator.com";

const THEMES = { characters: 1, animals: 14, objects: 2 };

const ANSWERS = { yes: 0, no: 1, idk: 2, probably: 3, "probably not": 4 };

function updateCookies(jar, headers) {
  const setCookies = headers && headers["set-cookie"];
  if (!setCookies) return;
  for (let c of setCookies) {
    const kv = c.split(";")[0];
    const index = kv.indexOf("=");
    if (index === -1) continue;
    const key = kv.slice(0, index).trim();
    const value = kv.slice(index + 1).trim();
    jar[key] = value;
  }
}

function cookieString(jar) {
  return Object.keys(jar)
    .map((key) => `${key}=${jar[key]}`)
    .join("; ");
}

async function startGame(theme = "characters", childMode = false) {
  const got = await loadGotScraping();
  const sid = THEMES[theme] || THEMES.characters;
  const jar = {};

  const homeRes = await got({ url: `${BASE_URL}/`, throwHttpErrors: false });
  updateCookies(jar, homeRes.headers);

  const res = await got({
    url: `${BASE_URL}/game`,
    method: "POST",
    form: { sid: String(sid), cm: String(childMode) },
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieString(jar),
    },
    throwHttpErrors: false,
  });
  updateCookies(jar, res.headers);

  const $ = cheerio.load(res.body);
  const question = $("#question-label").text().trim();
  const sessionMatch = res.body.match(/name="session"[^>]*value="([^"]+)"/);
  // Akinator sudah menghapus field "signature" dari form (0 kemunculan di
  // HTML). Dulu endpoint mewajibkannya sehingga start selalu gagal. Sekarang
  // signature tidak lagi dikirim ke /answer maupun /cancel_answer.
  const akitudeMatch = res.body.match(/akitude[^"]*"[^"]*([^/]+\.png)"/);

  const session = sessionMatch ? sessionMatch[1] : null;
  const akitude = akitudeMatch ? akitudeMatch[1] : "defi.png";

  if (!session) {
    return { status: false, error: "Gagal mengambil session Akinator." };
  }

  return {
    status: true,
    session,
    question,
    // Browser mengirim step=1 untuk pertanyaan pertama (lihat localStorage
    // awal: step '1', progression '0'). Nilai 0 membuat /answer ditolak.
    step: 1,
    stepLastProposition: 0,
    progression: 0,
    akitude,
    sid,
    theme,
    childMode,
    cookies: jar,
  };
}

async function answerGame(game, ans) {
  const got = await loadGotScraping();
  let answerId;

  if (typeof ans === "number") {
    answerId = ans;
  } else {
    const answerKey = String(ans).toLowerCase();
    answerId = typeof ANSWERS[answerKey] !== "undefined" ? ANSWERS[answerKey] : -1;
  }

  if (answerId === -1) {
    return { status: false, error: "Jawaban tidak valid." };
  }

  const res = await got({
    url: `${BASE_URL}/answer`,
    method: "POST",
    form: {
      step: String(game.step),
      progression: String(game.progression),
      sid: String(game.sid),
      cm: String(game.childMode),
      answer: String(answerId),
      step_last_proposition: String(game.stepLastProposition ?? 0),
      session: game.session,
    },
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieString(game.cookies || {}),
    },
    throwHttpErrors: false,
  });

  if (res.headers) updateCookies(game.cookies || {}, res.headers);

  let data;
  try {
    data = JSON.parse(res.body);
  } catch (e) {
    return { status: false, error: "Gagal membaca response Akinator." };
  }

  if (data.completion === "KO") {
    return { status: false, error: "Akinator: sesi kedaluwarsa, mulai ulang dengan action=start." };
  }

  if (data.id_proposition) {
    return {
      status: true,
      won: true,
      name: data.name_proposition,
      description: data.description_proposition,
      photo: data.photo,
      pseudo: data.pseudo,
    };
  }

  game.step = parseInt(data.step);
  game.progression = parseFloat(data.progression);

  return {
    status: true,
    won: false,
    question: data.question,
    questionId: data.question_id ?? null,
    step: game.step,
    progression: game.progression,
    akitude: data.akitude,
  };
}

async function backGame(game) {
  const got = await loadGotScraping();
  const res = await got({
    url: `${BASE_URL}/cancel_answer`,
    method: "POST",
    form: {
      step: String(game.step),
      progression: String(game.progression),
      sid: String(game.sid),
      cm: String(game.childMode),
      session: game.session,
    },
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieString(game.cookies || {}),
    },
    throwHttpErrors: false,
  });

  let data;
  try {
    data = JSON.parse(res.body);
  } catch (e) {
    return { status: false, error: "Gagal membaca response Akinator." };
  }

  return {
    status: true,
    question: data.question,
    step: parseInt(data.step),
    progression: parseFloat(data.progression),
    akitude: data.akitude,
  };
}

async function excludeGame(game) {
  const got = await loadGotScraping();
  const res = await got({
    url: `${BASE_URL}/exclude`,
    method: "POST",
    form: {
      // Payload nyata dari continuePartie() di situsnya: forward_answer wajib,
      // dan field pid/identifiant/charac_* tidak ikut dikirim.
      step: String(game.step),
      progression: String(game.progression),
      sid: String(game.sid),
      cm: String(game.childMode),
      session: game.session,
      forward_answer: "1",
    },
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieString(game.cookies || {}),
    },
    throwHttpErrors: false,
    followRedirect: true,
  });

  try {
    const data = JSON.parse(res.body);
    return {
      status: true,
      question: data.question,
      step: parseInt(data.step),
      progression: parseFloat(data.progression),
      akitude: data.akitude,
    };
  } catch (e) {
    const $ = cheerio.load(res.body);
    const question = $("#question-label").text().trim();

    if (!question) {
      return { status: false, error: "Akinator menolak exclude." };
    }

    const newSession = res.body.match(/name="session"[^>]*value="([^"]+)"/);

    return {
      status: true,
      question,
      step: 0,
      progression: 0,
      akitude: "defi.png",
      newSession: newSession ? newSession[1] : game.session,
    };
  }
}

const ANSWER_LABELS = ["Ya", "Tidak", "Tidak tahu", "Mungkin", "Mungkin tidak"];

function questionText(game) {
  return `🎩 Akimate: ${game.question}\n\n${ANSWER_LABELS.map((l, i) => `${i + 1}. ${l}`).join("\n")}\n\nProgress: ${Math.round(game.progression)}% | Step: ${game.step}`;
}

function getSessionFile(sessionId) {
  return `akinator_${(sessionId || "default").replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
}

export default {
  name: "Akinator",
  description: "Game tebak-tebakan karakter — AI menebak pikiranmu lewat pertanyaan, jawab per step sampai ketemu jawabannya",
  category: "Games",
  methods: ["GET", "POST"],
  params: ["action", "answer", "theme", "session"],
  paramsSchema: {
    action: {
      type: "string",
      required: false,
      enum: ["start", "answer", "back", "exclude", "stop"],
      default: "start",
      description: "Aksi permainan: start (mulai baru), answer (jawab), back (mundur), exclude (tolak tebakan), stop (akhiri sesi)",
    },
    answer: {
      type: "string",
      required: false,
      enum: ["yes", "no", "idk", "probably", "probably not", "1", "2", "3", "4", "5"],
      default: "yes",
      description: "Jawaban untuk action=answer (kata kunci atau angka 1-5)",
    },
    theme: {
      type: "string",
      required: false,
      enum: ["characters", "animals", "objects"],
      default: "characters",
      description: "Tema permainan saat action=start",
    },
    session: {
      type: "string",
      required: false,
      default: "default",
      description: "ID sesi untuk melanjutkan permainan",
    },
  },

  async run(req, res) {
    try {
      const { action, answer, theme, session } = { ...req.query, ...req.body };
      const aksi = (action || "start").toString().toLowerCase();
      const sessionId = (session && typeof session === "string" && session.trim()) || "default";
      const sessionFile = getSessionFile(sessionId);

      if (aksi === "start" || aksi === "stop") {
        if (aksi === "stop") {
          await saveSession(sessionFile, null);
          return res.json({ status: true, result: { message: `Sesi ${sessionId} diakhiri.` } });
        }

        const tema = (theme || "characters").toString().toLowerCase();
        if (!THEMES[tema]) {
          return res.status(400).json({
            status: false,
            message: "Tema tidak valid. Pilih: characters, animals, objects",
            code: "INVALID_THEME",
          });
        }
        const game = await startGame(tema, false);
        if (!game.status) {
          return res.status(502).json({ status: false, message: game.error, code: "START_FAILED" });
        }
        await saveSession(sessionFile, game);
        const { cookies, ...safe } = game;
        return res.json({ status: true, result: { ...safe, message: questionText(game), answers: ANSWER_LABELS } });
      }

      const game = await loadSession(sessionFile, null);
      if (!game || !game.status) {
        return res.status(400).json({
          status: false,
          message: "Belum ada permainan aktif. Mulai dengan action=start",
          code: "NO_SESSION",
        });
      }

      if (aksi === "back") {
        const resultBack = await backGame(game);
        if (!resultBack.status) {
          await saveSession(sessionFile, null);
          return res.status(502).json({ status: false, message: resultBack.error, code: "BACK_FAILED" });
        }
        Object.assign(game, {
          question: resultBack.question,
          step: resultBack.step,
          progression: resultBack.progression,
          akitude: resultBack.akitude,
        });
        await saveSession(sessionFile, game);
        const { cookies, ...safe } = game;
        return res.json({ status: true, result: { ...safe, message: questionText(game), answers: ANSWER_LABELS } });
      }

      if (aksi === "exclude") {
        const resultExclude = await excludeGame(game);
        if (!resultExclude.status) {
          await saveSession(sessionFile, null);
          return res.status(502).json({ status: false, message: resultExclude.error, code: "EXCLUDE_FAILED" });
        }
        if (resultExclude.newSession) {
          game.session = resultExclude.newSession;
        }
        Object.assign(game, {
          question: resultExclude.question,
          step: resultExclude.step,
          progression: resultExclude.progression,
          akitude: resultExclude.akitude,
        });
        await saveSession(sessionFile, game);
        const { cookies, ...safe } = game;
        return res.json({ status: true, result: { ...safe, message: questionText(game), answers: ANSWER_LABELS } });
      }

      // default: answer
      const answerMap = { "1": "yes", "2": "no", "3": "idk", "4": "probably", "5": "probably not" };
      const ansVal = answerMap[String(answer).toString().toLowerCase()] || String(answer || "").toLowerCase();
      const resultAnswer = await answerGame(game, ansVal);
      if (!resultAnswer.status) {
        await saveSession(sessionFile, null);
        return res.status(502).json({ status: false, message: resultAnswer.error, code: "ANSWER_FAILED" });
      }

      if (resultAnswer.won) {
        await saveSession(sessionFile, null);
        return res.json({
          status: true,
          result: {
            won: true,
            name: resultAnswer.name,
            description: resultAnswer.description,
            photo: resultAnswer.photo,
            pseudo: resultAnswer.pseudo,
          },
        });
      }

      Object.assign(game, {
        question: resultAnswer.question,
        step: resultAnswer.step,
        progression: resultAnswer.progression,
        akitude: resultAnswer.akitude,
      });
      await saveSession(sessionFile, game);
      const { cookies, ...safe } = game;
      return res.json({ status: true, result: { ...safe, message: questionText(game), answers: ANSWER_LABELS } });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Akinator request failed",
        code: "INTERNAL_ERROR",
      });
    }
  },
};