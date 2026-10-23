import logger from "../../src/utils/logger.js"

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
const KAHOOT_REST_API = "https://create.kahoot.it/rest/kahoots"

function cleanText(text) {
  if (!text || typeof text !== "string") return ""
  return text.replace(/<[^>]+>/g, "").trim()
}

function extractQuizUuid(input) {
  if (!input || typeof input !== "string") return ""
  const trimmed = input.trim()
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  const match = trimmed.match(uuidRegex)
  return match ? match[0] : trimmed
}

export async function getQuizAnswers(quizIdOrUrl, options = {}) {
  const uuid = extractQuizUuid(quizIdOrUrl)
  if (!uuid) {
    throw new Error("Link URL atau UUID Kuis Kahoot yang valid wajib diisi")
  }

  // If user passes a numeric live game PIN (e.g. 6-8 digits)
  if (/^[0-9]{5,9}$/.test(uuid)) {
    throw new Error(
      "Game PIN live game (angka) adalah sesi live sementara dan tidak menyediakan API publik langsung untuk kuis. Silakan cari kuis berdasarkan nama/judul (action=search&query=...) atau gunakan link URL kuis host."
    )
  }

  const timeoutMs = options.timeout || 15000
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const url = `${KAHOOT_REST_API}/${uuid}`
    const res = await fetch(url, {
      headers: {
        "User-Agent": options.userAgent || DEFAULT_USER_AGENT,
        Accept: "application/json",
      },
      signal: controller.signal,
    })

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error("Kuis Kahoot tidak ditemukan atau berstatus Private (HTTP 404)")
      }
      throw new Error(`Gagal mengambil data kuis Kahoot (HTTP ${res.status})`)
    }

    const data = await res.json()
    const questions = (data.questions || []).map((q, index) => {
      const choices = (q.choices || []).map((c) => ({
        answer: cleanText(c.answer),
        correct: Boolean(c.correct),
      }))

      const correctAnswers = choices.filter((c) => c.correct).map((c) => c.answer)

      return {
        number: index + 1,
        question: cleanText(q.question),
        type: q.type || "quiz",
        time_limit_ms: q.time || 20000,
        points: q.points ?? true,
        image_url: q.image || null,
        choices,
        correct_answers: correctAnswers,
      }
    })

    return {
      uuid: data.uuid || uuid,
      title: data.title || "",
      description: data.description || "",
      creator_username: data.creator_username || "",
      total_questions: questions.length,
      cover_image: data.cover || null,
      questions,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function searchQuiz(query, options = {}) {
  if (!query || typeof query !== "string") {
    throw new Error("Kata kunci / nama kuis (query) wajib diisi untuk pencarian")
  }

  const limit = options.limit || 10
  const timeoutMs = options.timeout || 15000
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const url = `${KAHOOT_REST_API}/?query=${encodeURIComponent(query)}&limit=${limit}`
    const res = await fetch(url, {
      headers: {
        "User-Agent": options.userAgent || DEFAULT_USER_AGENT,
        Accept: "application/json",
      },
      signal: controller.signal,
    })

    if (!res.ok) {
      throw new Error(`Gagal mencari kuis Kahoot (HTTP ${res.status})`)
    }

    const data = await res.json()
    const entities = data.entities || []

    const results = entities.map((item) => {
      const card = item.card || {}
      return {
        uuid: card.uuid || "",
        title: card.title || "",
        description: card.description || "",
        creator_username: card.creator_username || "",
        number_of_questions: card.number_of_questions || 0,
        cover_image: card.cover || null,
        details_url: `https://create.kahoot.it/details/${card.uuid}`,
      }
    })

    return {
      query,
      total_results: results.length,
      results,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

export default {
  name: "Kahoot Quiz & Answers",
  description: "Cari kuis Kahoot berdasarkan nama/topik dan ambil seluruh soal beserta bocoran kunci jawaban benar via Link URL atau UUID kuis.",
  category: "Fun",
  methods: ["GET", "POST"],

  params: ["action", "query", "url", "id", "name", "link", "limit"],

  paramsSchema: {
    action: {
      type: "string",
      required: false,
      default: "search",
      enum: ["search", "answers"],
      description: "Aksi: 'search' (cari kuis berdasarkan nama/judul), 'answers' (ambil soal & kunci jawaban via link URL atau UUID)",
      example: "search",
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci / nama judul kuis untuk dicari (action=search)",
      example: "indonesia",
    },
    name: {
      type: "string",
      required: false,
      description: "Alias nama judul kuis (sama dengan parameter query)",
      example: "matematika",
    },
    url: {
      type: "string",
      required: false,
      description: "Link kuis Kahoot atau UUID kuis (action=answers)",
      example: "https://create.kahoot.it/details/4a09d6af-5515-403b-9502-9fe6903234a8",
    },
    id: {
      type: "string",
      required: false,
      description: "UUID kuis Kahoot (action=answers)",
      example: "4a09d6af-5515-403b-9502-9fe6903234a8",
    },
    limit: {
      type: "number",
      required: false,
      default: 10,
      description: "Batas jumlah hasil pencarian kuis",
      example: 10,
    },
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body }
      const action = (params.action || "").toLowerCase()
      const searchKey = params.query || params.name || params.q
      const targetInput = params.url || params.id || params.link || params.code || params.pin || params.quizId

      logger.info(`[KAHOOT] Request | ip=${req.ip} | action=${action || "auto"} | query=${searchKey || "-"} | target=${targetInput || "-"}`)

      // Mode 1: Jika action=answers ATAU jika user mengoper link / UUID
      if (action === "answers" || (!action && targetInput) || (targetInput && !searchKey)) {
        const inputToResolve = targetInput || searchKey
        if (!inputToResolve) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'url', 'id', atau 'link' kuis Kahoot wajib diisi untuk mengambil kunci jawaban.",
          })
        }

        const result = await getQuizAnswers(inputToResolve)
        return res.json({
          status: true,
          action: "answers",
          result,
        })
      }

      // Mode 2: Pencarian Kuis (Search by Name / Topic)
      const queryStr = searchKey || targetInput
      if (!queryStr) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'query' atau 'name' wajib diisi untuk mencari kuis Kahoot.",
          usage: {
            search_by_name: "/api/fun/kahoot?action=search&query=matematika",
            answers_by_url: "/api/fun/kahoot?action=answers&url=https://create.kahoot.it/details/UUID",
            answers_by_id: "/api/fun/kahoot?action=answers&id=UUID",
          },
        })
      }

      // Jika input pada query ternyata berbentuk URL atau UUID, langsung alihkan ke answers
      const possibleUuid = extractQuizUuid(queryStr)
      if (possibleUuid && possibleUuid.length === 36 && possibleUuid.includes("-")) {
        const result = await getQuizAnswers(possibleUuid)
        return res.json({
          status: true,
          action: "answers",
          result,
        })
      }

      const limit = parseInt(params.limit, 10) || 10
      const result = await searchQuiz(queryStr, { limit })
      return res.json({
        status: true,
        action: "search",
        result,
      })
    } catch (err) {
      logger.error(`[KAHOOT] Error: ${err.message}`)
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses request Kahoot",
      })
    }
  },
}
