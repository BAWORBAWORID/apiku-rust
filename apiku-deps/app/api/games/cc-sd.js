import { fetchCached, pickRandom } from '../../src/utils/gameCache.js';
import logger from "../../src/utils/logger.js";

// ==================== Subject Database ====================
const SUBJECTS = {
    bindo: "https://gist.githubusercontent.com/siputzx/298d2d3bd5901494537b9848e35dab9f/raw/25f5dcfef0d97141c555c2bbb94fe1f3d1f76cb3/bindo.json",
    tik: "https://gist.githubusercontent.com/siputzx/298d2d3bd5901494537b9848e35dab9f/raw/25f5dcfef0d97141c555c2bbb94fe1f3d1f76cb3/tik.json",
    pkn: "https://gist.githubusercontent.com/siputzx/298d2d3bd5901494537b9848e35dab9f/raw/25f5dcfef0d97141c555c2bbb94fe1f3d1f76cb3/pkn.json",
    bing: "https://gist.githubusercontent.com/siputzx/298d2d3bd5901494537b9848e35dab9f/raw/25f5dcfef0d97141c555c2bbb94fe1f3d1f76cb3/bing.json",
    penjas: "https://gist.githubusercontent.com/siputzx/298d2d3bd5901494537b9848e35dab9f/raw/25f5dcfef0d97141c555c2bbb94fe1f3d1f76cb3/penjas.json",
    pai: "https://gist.githubusercontent.com/siputzx/298d2d3bd5901494537b9848e35dab9f/raw/25f5dcfef0d97141c555c2bbb94fe1f3d1f76cb3/pai.json",
    matematika: "https://gist.githubusercontent.com/siputzx/298d2d3bd5901494537b9848e35dab9f/raw/25f5dcfef0d97141c555c2bbb94fe1f3d1f76cb3/matematika.json",
    jawa: "https://gist.githubusercontent.com/siputzx/298d2d3bd5901494537b9848e35dab9f/raw/25f5dcfef0d97141c555c2bbb94fe1f3d1f76cb3/jawa.json",
    ips: "https://gist.githubusercontent.com/siputzx/298d2d3bd5901494537b9848e35dab9f/raw/25f5dcfef0d97141c555c2bbb94fe1f3d1f76cb3/ips.json",
    ipa: "https://gist.githubusercontent.com/siputzx/298d2d3bd5901494537b9848e35dab9f/raw/25f5dcfef0d97141c555c2bbb94fe1f3d1f76cb3/ipa.json",
};

// ==================== Utility Functions ====================
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function getRandomQuestions(questions, count) {
    const shuffled = shuffleArray(questions);
    return shuffled.slice(0, count);
}

// ==================== MAIN ENDPOINT ====================
export default {
    name: "Cerdas Cermat SD",
    description: "Get randomized quiz questions for elementary school subjects",
    category: "Games",
    methods: ["GET", "POST"],
    params: ["matapelajaran", "jumlahsoal"],

    paramsSchema: {
        matapelajaran: {
            type: "string",
            required: true,
            enum: Object.keys(SUBJECTS),
            description: "Subject for quiz questions"
        },
        jumlahsoal: {
            type: "number",
            required: false,
            default: 5,
            minimum: 5,
            maximum: 10,
            description: "Number of questions to generate (5-10)"
        }
    },

    async run(req, res) {
        try {
            // Get parameters based on request method
            const params = req.method === 'GET' ? req.query : req.body;
            const { matapelajaran, jumlahsoal } = params || {};

            // Validate subject parameter
            if (!matapelajaran) {
                return res.status(400).json({
                    status: false,
                    message: "Parameter 'matapelajaran' wajib diisi",
                    available_subjects: Object.keys(SUBJECTS),
                    code: "MISSING_SUBJECT"
                });
            }

            if (typeof matapelajaran !== "string" || matapelajaran.trim().length === 0) {
                return res.status(400).json({
                    status: false,
                    message: "Parameter 'matapelajaran' harus berupa string",
                    code: "INVALID_SUBJECT"
                });
            }

            const trimmedSubject = matapelajaran.trim();
            if (!SUBJECTS[trimmedSubject]) {
                return res.status(400).json({
                    status: false,
                    message: "Mata pelajaran tidak valid",
                    available_subjects: Object.keys(SUBJECTS),
                    code: "INVALID_SUBJECT"
                });
            }

            // Validate jumlahsoal parameter
            let numQuestions = 5;
            if (jumlahsoal !== undefined && jumlahsoal !== null) {
                numQuestions = parseInt(jumlahsoal);
                if (isNaN(numQuestions) || numQuestions < 5 || numQuestions > 10) {
                    return res.status(400).json({
                        status: false,
                        message: "Parameter 'jumlahsoal' harus berupa angka antara 5 dan 10",
                        code: "INVALID_QUESTION_COUNT"
                    });
                }
            }

            // Fetch questions from cached data
            const allQuestions = await fetchCached(SUBJECTS[trimmedSubject]);

            if (!allQuestions || !Array.isArray(allQuestions) || allQuestions.length === 0) {
                return res.status(404).json({
                    status: false,
                    message: "Tidak ada soal tersedia untuk mata pelajaran ini",
                    code: "NO_QUESTIONS_FOUND"
                });
            }

            if (allQuestions.length < numQuestions) {
                return res.status(400).json({
                    status: false,
                    message: `Jumlah soal yang diminta (${numQuestions}) melebihi soal yang tersedia (${allQuestions.length})`,
                    code: "INSUFFICIENT_QUESTIONS"
                });
            }

            // Select random questions
            const selectedQuestions = getRandomQuestions(allQuestions, numQuestions);

            // Transform questions with shuffled answers
            const transformedQuestions = selectedQuestions.map((question) => {
                const correctAnswer = question.jawaban_benar.teks;

                // Extract all answer values
                const answerValues = question.semua_jawaban.map((option) => {
                    const optionKey = Object.keys(option)[0];
                    return option[optionKey];
                });

                // Shuffle answers
                const shuffledAnswers = shuffleArray(answerValues);

                // Assign letter keys (a, b, c, d, ...)
                const keys = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
                const availableKeys = keys.slice(0, shuffledAnswers.length);

                const newAnswerOptions = shuffledAnswers.map((value, index) => {
                    return { [availableKeys[index]]: value };
                });

                // Find correct answer key
                let correctOption = null;
                for (const option of newAnswerOptions) {
                    const optionKey = Object.keys(option)[0];
                    const optionValue = option[optionKey];
                    if (optionValue === correctAnswer) {
                        correctOption = optionKey;
                        break;
                    }
                }

                return {
                    pertanyaan: question.pertanyaan,
                    semua_jawaban: newAnswerOptions,
                    jawaban_benar: correctOption || "a",
                };
            });

            // Return JSON response
            return res.json({
                status: true,
                result: {
                    matapelajaran: trimmedSubject,
                    jumlah_soal: numQuestions,
                    soal: transformedQuestions
                }
            });

        } catch (err) {
            logger.error(`[CC-SD] Error | ip=${req.ip} | message=${err.message}`);

            return res.status(500).json({
                status: false,
                message: err.message || "Gagal mendapatkan soal quiz",
                code: "INTERNAL_ERROR"
            });
        }
    },
};
