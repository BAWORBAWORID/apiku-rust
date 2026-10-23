/**
 * Math Game API - Generate random math problems with various difficulty levels
 * 
 * GET /api/games/maths?level=easy
 * POST /api/games/maths
 * 
 * result: 
 * - JSON response with math problem, result, and time limit
 */

import logger from "../../src/utils/logger.js";

// ==================== Math Difficulty Levels ====================
const MODES = {
    noob: [-3, 3, -3, 3, "+-", 15000, 10],
    easy: [-10, 10, -10, 10, "*/+-", 20000, 40],
    medium: [-40, 40, -20, 20, "*/+-", 40000, 150],
    hard: [-100, 100, -70, 70, "*/+-", 60000, 350],
    extreme: [-999999, 999999, -999999, 999999, "*/", 99999, 9999],
    impossible: [-99999999999, 99999999999, -99999999999, 999999999999, "*/", 30000, 35000],
    impossible2: [-999999999999999, 999999999999999, -999, 999, "/", 30000, 50000],
    impossible3: [-999999999999999999, 999999999999999999, -999999999999999999, 999999999999999999, "*/", 100000, 100000],
    impossible4: [-999999999999999999999, 999999999999999999999, -999999999999999999999, 999999999999999999999, "*/", 500000, 500000],
    impossible5: [-999999999999999999999999, 999999999999999999999999, -999999999999999999999999, 999999999999999999999999, "*/", 1000000, 1000000],
};

const OPERATORS = {
    "+": "+",
    "-": "-",
    "*": "×",
    "/": "÷",
};

// ==================== Utility Functions ====================
function randomInt(from, to) {
    if (from > to) [from, to] = [to, from];
    from = Math.floor(from);
    to = Math.floor(to);
    return Math.floor((to - from) * Math.random() + from);
}

function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// ==================== Math Client ====================
class MathClient {
    generateProblem(level) {
        try {
            const [a1, a2, b1, b2, ops, time, bonus] = MODES[level];
            
            let a = randomInt(a1, a2);
            let b = randomInt(b1, b2);
            const op = pickRandom([...ops]);
            let result;

            if (op === "/") {
                while (b === 0) {
                    b = randomInt(b1, b2);
                }
                result = a;
                a = result * b;
            } else {
                // Safe evaluation
                switch(op) {
                    case '+': result = a + b; break;
                    case '-': result = a - b; break;
                    case '*': result = a * b; break;
                    case '/': result = a / b; break;
                    default: result = 0;
                }
            }

            const mathProblem = {
                str: `${a} ${OPERATORS[op]} ${b}`,
                mode: level,
                time: time,
                bonus: bonus,
                result: result,
            };

            logger.info(
                `[MATH] Success | ` +
                `level=${level} | ` +
                `problem="${mathProblem.str}" | ` +
                `result=${result}`
            );

            return {
                success: true,
                data: mathProblem,
                metadata: {
                    level: level,
                    time_limit: time,
                    bonus_points: bonus
                }
            };

        } catch (error) {
            logger.error(`[MATH] Error: ${error.message}`);
            throw error;
        }
    }

    getAvailableLevels() {
        return Object.keys(MODES);
    }
}

// ==================== MAIN ENDPOINT ====================
export default {
    name: "Math Challenge",
    description: "Generate random math problems with various difficulty levels",
    category: "Games",
    methods: ["GET", "POST"],
    params: ["level"],

    paramsSchema: {
        level: {
            type: "string",
            required: false,
            enum: Object.keys(MODES),
            default: pickRandom(Object.keys(MODES)),
            description: "Difficulty level of the math problem"
        }
    },

    async run(req, res) {
        const client = new MathClient();
        
        try {
            // Get parameters based on request method
            const params = req.method === 'GET' ? req.query : req.body;
            let { level } = params || {};

            // Validate level parameter
            const validLevels = client.getAvailableLevels();
            
            if (level && typeof level !== "string") {
                return res.status(400).json({
                    status: false,
                    message: "Parameter 'level' harus berupa string",
                    code: "INVALID_LEVEL_TYPE"
                });
            }

            // If level is not provided or invalid, pick random level
            if (!level || !validLevels.includes(level)) {
                level = pickRandom(validLevels);
                logger.info(`[MATH] Random level selected: ${level}`);
            }

            /* =======================================
               MATH PROBLEM GENERATION
            ======================================= */

            const result = client.generateProblem(level);

            if (!result.success || !result.data) {
                throw new Error("Gagal menghasilkan soal matematika");
            }

            // Log success
            logger.info(
                `[MATH] Success | ip=${req.ip} | ` +
                `method=${req.method} | ` +
                `level=${level}`
            );

            // Set headers - NO CACHE
            res.setHeader("Content-Type", "application/json");
            res.setHeader("X-Level", level);
            res.setHeader("X-Time-Limit", result.metadata.time_limit);
            res.setHeader("X-Bonus-Points", result.metadata.bonus_points);
            
            // NO CACHE HEADERS
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
            res.setHeader("Surrogate-Control", "no-store");
            
            // Return JSON response
            return res.json({
                status: true,
                result: result.data
            });

        } catch (err) {
            // Detailed error logging
            logger.error(
                `[MATH] Error | ip=${req.ip} | ` +
                `message=${err.message} | code=${err.code || 'N/A'}`
            );
            
            return res.status(500).json({
                status: false,
                message: err.message || "Gagal menghasilkan soal matematika",
                code: "INTERNAL_ERROR"
            });
        }
    },
};