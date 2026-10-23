/**
 * Universal Translator — 4-engine fallback + Voice TTS
 * Engine: Google Translate (240+ bahasa + bahasa daerah) → DeepL Web → Neural GTX → MyMemory
 * Source: scraper by OmnifyLabs (adaptasi CLI → endpoint)
 */
import axios from "axios";

const SUPPORTED_LANGUAGES = {
  AR: "Arabic (Arab)",
  BG: "Bulgarian",
  CS: "Czech",
  DA: "Danish",
  DE: "German (Jerman)",
  EL: "Greek",
  EN: "English (Inggris)",
  "EN-GB": "English (British)",
  "EN-US": "English (American)",
  ES: "Spanish (Spanyol)",
  ET: "Estonian",
  FI: "Finnish",
  FR: "French (Prancis)",
  HU: "Hungarian",
  ID: "Indonesian (Indonesia)",
  IT: "Italian (Italia)",
  JA: "Japanese (Jepang)",
  KO: "Korean (Korea)",
  LT: "Lithuanian",
  LV: "Latvian",
  NB: "Norwegian Bokmål",
  NL: "Dutch (Belanda)",
  PL: "Polish",
  PT: "Portuguese (Portugis)",
  "PT-BR": "Portuguese (Brazilian)",
  "PT-PT": "Portuguese (European)",
  RO: "Romanian",
  RU: "Russian (Rusia)",
  SK: "Slovak",
  SL: "Slovenian",
  SV: "Swedish",
  TR: "Turkish (Turki)",
  UK: "Ukrainian",
  ZH: "Chinese (Mandarin Simplified)",
  "ZH-HANT": "Chinese (Mandarin Traditional)",
};

// ─── Bahasa Daerah Indonesia + tambahan (Google Translate) ───
const REGIONAL_LANGUAGES = {
  JW: { nameId: "Jawa", nameEn: "Javanese" },
  SU: { nameId: "Sunda", nameEn: "Sundanese" },
  BAN: { nameId: "Bali", nameEn: "Balinese" },
  MIN: { nameId: "Minangkabau", nameEn: "Minang" },
  AV: { nameId: "Batak/Bugis (Avar)", nameEn: "Avaric" },
  ACE: { nameId: "Aceh", nameEn: "Acehnese" },
  MAD: { nameId: "Madura", nameId_alt: "Madurese" },
  MS: { nameId: "Melayu", nameEn: "Malay" },
};

const LANGUAGE_ALIASES = {
  arab: "AR",
  arabic: "AR",
  inggris: "EN",
  english: "EN",
  indonesia: "ID",
  indonesian: "ID",
  jepang: "JA",
  japanese: "JA",
  korea: "KO",
  korean: "KO",
  mandarin: "ZH",
  chinese: "ZH",
  jerman: "DE",
  german: "DE",
  prancis: "FR",
  french: "FR",
  spanyol: "ES",
  spanish: "ES",
  italia: "IT",
  italian: "IT",
  rusia: "RU",
  russian: "RU",
  portugis: "PT",
  portuguese: "PT",
  brasil: "PT-BR",
  turki: "TR",
  turkish: "TR",
  belanda: "NL",
  dutch: "NL",
  thailand: "TH",
  vietnam: "VI",
  // Bahasa daerah
  jawa: "JW",
  javanese: "JW",
  sunda: "SU",
  sundanese: "SU",
  bali: "BAN",
  balinese: "BAN",
  minang: "MIN",
  minangkabau: "MIN",
  batak: "BTK",
  aceh: "ACE",
  acehnese: "ACE",
  madura: "MAD",
  madurese: "MAD",
  melayu: "MS",
  malay: "MS",
};

function normalizeLanguageCode(input) {
  if (!input || typeof input !== "string") return "EN";
  const raw = input.trim().toUpperCase();
  if (SUPPORTED_LANGUAGES[raw]) return raw;
  if (REGIONAL_LANGUAGES[raw]) return raw;
  const alias = LANGUAGE_ALIASES[input.trim().toLowerCase()];
  if (alias) return alias;
  const prefix = raw.split("-")[0];
  if (SUPPORTED_LANGUAGES[prefix]) return prefix;
  if (REGIONAL_LANGUAGES[prefix]) return prefix;
  return "EN";
}

function languageName(code) {
  if (REGIONAL_LANGUAGES[code]) return `${REGIONAL_LANGUAGES[code].nameId} (${REGIONAL_LANGUAGES[code].nameEn || ""})`.trim();
  return SUPPORTED_LANGUAGES[code] || code;
}

// Map kode umum → kode Google Translate
function toGoogleLang(code) {
  if (!code) return "en";
  const map = { "EN-GB": "en", "EN-US": "en", "PT-BR": "pt", "PT-PT": "pt", "ZH": "zh-CN", "ZH-HANT": "zh-TW", "BTK": "jw" };
  if (map[code]) return map[code];
  return code.toLowerCase().split("-")[0];
}

function countCharI(str) {
  let count = 0;
  for (const ch of String(str)) if (ch === "i") count++;
  return count;
}

// ─── Voice TTS URL (Google Translate) ────────────────────
function getVoiceAudioUrl(text, langCode = "EN") {
  if (!text || typeof text !== "string") return null;
  const lang = toGoogleLang(langCode || "EN");
  const query = encodeURIComponent(text.slice(0, 500));
  return `https://translate.google.com/translate_tts?ie=UTF-8&q=${query}&tl=${lang}&client=tw-ob`;
}

function getTimeStamp(iCount) {
  const ts = Date.now() / 1000;
  let i = iCount || 0;
  i++;
  const base = Math.floor(ts);
  let diff = i - (base % (i + 1)) + 1;
  let value = base;
  value += diff;
  return value;
}

// ─── Engine 1: Google Translate (240+ bahasa + bahasa daerah + kamus) ──
async function translateGoogle(text, targetLang, sourceLang = "auto") {
  const sl = sourceLang && sourceLang !== "auto" ? toGoogleLang(sourceLang) : "auto";
  const tl = toGoogleLang(targetLang);

  const endpoints = [
    `https://translate.google.com/translate_a/single?client=dict-chrome-ex&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&dt=bd&dt=rm&dt=at&dt=qc&q=${encodeURIComponent(text)}`,
    `https://translate.google.co.id/translate_a/single?client=dict-chrome-ex&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&dt=bd&dt=rm&dt=at&dt=qc&q=${encodeURIComponent(text)}`,
    `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(text)}`,
  ];

  let lastError = null;
  let rawData = null;
  for (const ep of endpoints) {
    try {
      const { data } = await axios.get(ep, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        },
        timeout: 15000,
      });
      if (data) {
        rawData = data;
        break;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (!rawData) throw new Error(`Google Translate gagal: ${lastError?.message || "koneksi"}`);

  // Format sederhana (data adalah array string)
  if (Array.isArray(rawData) && typeof rawData[0] === "string") {
    return {
      translatedText: rawData.join(""),
      sourceLanguage: (sourceLang !== "auto" ? sourceLang : "AUTO"),
      engine: "Google Translate",
      detectedCode: null,
      pronunciation: null,
      alternatives: [],
      dictionary: [],
      spellCheck: null,
    };
  }

  const sentences = rawData[0] || [];
  let translatedText = "";
  let sourcePronunciation = null;
  let targetPronunciation = null;
  for (const s of sentences) {
    if (!Array.isArray(s)) continue;
    if (s[0]) translatedText += s[0];
    if (s[3]) sourcePronunciation = s[3];
    if (s[2] && !s[0]) targetPronunciation = s[2];
  }

  const detectedCode = rawData[2] || (sourceLang !== "auto" ? toGoogleLang(sourceLang) : null);
  const confidence = typeof rawData[6] === "number" ? rawData[6] : null;

  // Kamus bilingual (rawData[1])
  const dictionary = [];
  const dictRaw = rawData[1] || [];
  for (const entry of dictRaw) {
    if (!Array.isArray(entry)) continue;
    const word = entry[0];
    const pos = entry[1] || null;
    const translations =
      (entry[2] || []).slice(0, 5).map((t) => ({
        word: t[0],
        frequency: t[3] || null,
      }));
    if (word) dictionary.push({ word, partOfSpeech: pos, translations });
  }

  // Alternatif (rawData[0] baris kedua)
  const alternatives = [];
  for (const s of sentences) {
    if (Array.isArray(s) && Array.isArray(s[1]) && s[1][0] && typeof s[1][0] === "string") {
      alternatives.push(...s[1].slice(0, 5));
    }
  }

  // Koreksi ejaan (rawData[9])
  let spellCheck = null;
  try {
    const sc = rawData[9];
    if (Array.isArray(sc) && Array.isArray(sc[0]) && sc[0][0]) {
      spellCheck = { corrected: sc[0][0].join(" ") || null };
    }
  } catch (_) {}

  return {
    translatedText,
    sourceLanguage: detectedCode || (sourceLang !== "auto" ? sourceLang : "AUTO"),
    engine: "Google Translate",
    detectedCode,
    confidence,
    pronunciation: targetPronunciation || sourcePronunciation,
    romanization: sourcePronunciation || null,
    alternatives: alternatives.filter((a) => a && a !== translatedText).slice(0, 3),
    dictionary: dictionary.slice(0, 5),
    spellCheck,
  };
}

// ─── Engine 2: DeepL Web Native RPC ──────────────────────────
async function translateDeepLWeb(text, targetLang, sourceLang = "auto") {
  const iCount = countCharI(text);
  const ts = getTimeStamp(iCount);
  const source = sourceLang && sourceLang !== "auto" ? sourceLang.toUpperCase() : "auto";
  const target = targetLang.toUpperCase();

  const params = new URLSearchParams({
    jsonrpc: "2.0",
    method: "LMT_handle_texts",
    id: Math.floor(Math.random() * 99999) + 10000,
    ver: "2.0",
  });

  const payload = {
    jsonrpc: "2.0",
    method: "LMT_handle_texts",
    params: {
      splitting: "newlines",
      lang: {
        target_lang: target,
        source_lang_user_selected: source === "AUTO" ? "auto" : source,
      },
      texts: [{ text, requestAlternatives: 3 }],
      timestamp: ts,
    },
    id: Math.floor(Math.random() * 99999) + 10000,
    ver: "2.0",
  };

  const { data } = await axios.post(
    `https://www2.deepl.com/jsonrpc?${params.toString()}`,
    JSON.stringify(payload).replace('"method":"', '"method": "'),
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "*/*",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
        Origin: "https://www.deepl.com",
        Referer: "https://www.deepl.com/translator",
      },
      timeout: 15000,
    }
  );

  const result = data?.result?.texts?.[0]?.text;
  if (!result) throw new Error("DeepL response tidak valid");

  const detected = data?.result?.lang;
  return {
    translatedText: result,
    sourceLanguage: detected?.detected_source_lang || "AUTO",
    alternatives: (data?.result?.texts?.[0]?.alternatives || []).map((a) => a.text).filter(Boolean).slice(0, 3),
    engine: "DeepL Web Protocol",
  };
}

// ─── Engine 3: Neural GTX ────────────────────────────────────
async function translateNeuralGtx(text, targetLang, sourceLang = "auto") {
  const body = new URLSearchParams({
    text,
    to: targetLang.toLowerCase().split("-")[0],
    from: sourceLang === "auto" ? "auto" : sourceLang.toLowerCase().split("-")[0],
  });

  const { data } = await axios.post("https://translate.neuralgtx.dev/translate", body.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
      Origin: "https://translate.neuralgtx.dev",
      Referer: "https://translate.neuralgtx.dev/",
    },
    timeout: 15000,
  });

  const translated = typeof data === "string" ? data : data?.translatedText || data?.translation || data?.result;
  if (!translated || typeof translated !== "string" || !translated.trim()) {
    throw new Error("Neural GTX response tidak valid");
  }
  return {
    translatedText: translated.trim(),
    sourceLanguage: sourceLang.toUpperCase(),
    engine: "Neural GTX Engine",
  };
}

// ─── Engine 4: MyMemory Corpus ───────────────────────────────
async function translateMyMemory(text, targetLang, sourceLang = "auto") {
  const tl = targetLang.toLowerCase().split("-")[0];
  const sl = sourceLang === "auto" ? "id" : sourceLang.toLowerCase().split("-")[0];

  const res = await axios.get("https://api.mymemory.translated.net/get", {
    params: {
      q: text,
      langpair: `${sl}|${tl}`,
    },
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    },
    timeout: 8000,
  });

  const translatedText = res.data?.responseData?.translatedText;
  if (
    !translatedText ||
    translatedText.includes("MYMEMORY WARNING") ||
    /PLEASE SELECT TWO DISTINCT|QUERY LENGTH LIMIT|INVALID (SOURCE|TARGET)/i.test(translatedText)
  ) {
    throw new Error("MyMemory quota or rate limit");
  }

  const matches = res.data?.matches || [];
  const alternatives = matches
    .map((m) => m.translation)
    .filter((t) => t && t !== translatedText)
    .slice(0, 3);

  return {
    translatedText,
    sourceLanguage: sourceLang.toUpperCase(),
    alternatives,
    engine: "MyMemory Corpus Engine",
  };
}

// ─── Universal translate (4-engine fallback) ─────────────────
async function translate(text, targetLang = "EN", sourceLang = "auto") {
  if (!text || typeof text !== "string" || !text.trim()) {
    throw new Error("Teks yang akan diterjemahkan tidak boleh kosong!");
  }

  const normalizedTarget = normalizeLanguageCode(targetLang);

  const engines = [translateGoogle, translateDeepLWeb, translateNeuralGtx, translateMyMemory];
  let lastError = null;
  for (const engine of engines) {
    try {
      const r = await engine(text, normalizedTarget, sourceLang);
      if (r && r.translatedText) return r;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(lastError?.message || "Gagal menerjemahkan teks melalui seluruh engine terjemahan.");
}

export default {
  name: "Universal Translate",
  description:
    "Translator universal 4-engine (Google 240+ bahasa → DeepL → Neural GTX → MyMemory) + voice TTS. Support bahasa daerah (Jawa/Sunda/Bali/Minang/Aceh/Madura), kamus bilingual, transliterasi & deteksi bahasa",
  category: "Tools",
  methods: ["GET", "POST"],
  params: ["text", "lang", "source", "voice", "detail"],
  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Teks yang akan diterjemahkan",
      example: "Halo teman-teman, apa kabar hari ini?",
      minLength: 1,
      maxLength: 4500,
    },
    lang: {
      type: "string",
      required: false,
      description: "Kode bahasa tujuan (EN, JA, KO, ID, JW, SU, BAN, MIN, DE, dsb / alias: jepang, korea, jawa, sunda, inggris)",
      enum: [...Object.keys(SUPPORTED_LANGUAGES), ...Object.keys(REGIONAL_LANGUAGES)],
      default: "EN",
    },
    source: {
      type: "string",
      required: false,
      description: "Kode bahasa asal (default: auto)",
      default: "auto",
    },
    voice: {
      type: "string",
      required: false,
      description: "Jika '1', sertakan URL audio TTS (Google Translate voice)",
      enum: ["0", "1"],
      default: "0",
    },
    detail: {
      type: "string",
      required: false,
      description: "Jika '1', sertakan alternatives + nama engine yang dipakai",
      enum: ["0", "1"],
      default: "0",
    },
  },
  async run(req, res) {
    const { text, lang, source, voice, detail } = { ...req.query, ...req.body };

    if (!text || !String(text).trim()) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'text' wajib diisi",
      });
    }

    const targetLang = normalizeLanguageCode(lang || "EN");
    const sourceLang = source || "auto";
    const wantVoice = voice === "1";
    const wantDetail = detail === "1";
    const started = Date.now();

    try {
      const engines = [translateGoogle, translateDeepLWeb, translateNeuralGtx, translateMyMemory];
      let resultData = null;
      let lastError = null;

      for (const engine of engines) {
        try {
          resultData = await engine(String(text), targetLang, sourceLang);
          if (resultData && resultData.translatedText) break;
        } catch (err) {
          lastError = err;
        }
      }

      if (!resultData || !resultData.translatedText) {
        throw lastError || new Error("Gagal menghubungi layanan terjemahan bahasa.");
      }

      let detectedSource = resultData.sourceLanguage;
      if (detectedSource === "AUTO" || !detectedSource) detectedSource = sourceLang.toUpperCase();

      const result = {
        status: true,
        result: {
          original_text: String(text),
          source_language: detectedSource,
          target_language: targetLang,
          language_name: languageName(targetLang),
          translated_text: resultData.translatedText,
          engine: resultData.engine,
          durationMs: Date.now() - started,
        },
      };

      if (wantDetail) {
        if (Array.isArray(resultData.alternatives) && resultData.alternatives.length) {
          result.result.alternatives = resultData.alternatives;
        }
        if (resultData.pronunciation) result.result.pronunciation = resultData.pronunciation;
        if (resultData.romanization) result.result.romanization = resultData.romanization;
        if (Array.isArray(resultData.dictionary) && resultData.dictionary.length) {
          result.result.dictionary = resultData.dictionary;
        }
        if (resultData.spellCheck) result.result.spell_check = resultData.spellCheck;
        if (typeof resultData.confidence === "number") result.result.confidence = resultData.confidence;
        if (resultData.detectedCode) result.result.detected_lang_code = resultData.detectedCode;
      }
      if (wantVoice) {
        result.result.voice_url = getVoiceAudioUrl(resultData.translatedText, targetLang);
        result.result.original_voice_url = getVoiceAudioUrl(String(text), detectedSource);
      }

      return res.json(result);
    } catch (err) {
      res.json({
        status: false,
        message: err.message || "Terjadi kesalahan saat menghubungi layanan terjemahan",
      });
    }
  },
};
