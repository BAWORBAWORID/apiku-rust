import { fetchCached, pickRandom } from '../../src/utils/gameCache.js';

const DATA_URL = 'https://raw.githubusercontent.com/siputzx/Databasee/refs/heads/main/games/butawarna.json';

export default {
    name: "Tebak Warna",
    description: "Get random color perception quizzes",
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
                message: err.message || "Gagal mendapatkan tebak warna",
                code: "INTERNAL_ERROR"
            });
        }
    },
};
