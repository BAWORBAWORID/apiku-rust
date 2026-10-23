import { fetchCached, pickRandom } from '../../src/utils/gameCache.js';

const DATA_URL = 'https://raw.githubusercontent.com/BochilTeam/database/master/games/susunkata.json';

export default {
    name: "Susun Kata",
    description: "Get random word arrangement puzzles to test vocabulary skills",
    category: "Games",
    methods: ["GET", "POST"],
    params: [],

    paramsSchema: {},

    async run(req, res) {
        try {
            const data = await fetchCached(DATA_URL);
            const { item, index, total } = pickRandom(data);
            res.json({ status: true, result: item });
        } catch (err) {
            res.status(500).json({
                status: false,
                message: err.message || "Gagal mendapatkan puzzle susun kata",
                code: "INTERNAL_ERROR"
            });
        }
    },
};
