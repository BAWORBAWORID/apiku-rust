import { fetchCached, pickRandom } from '../../src/utils/gameCache.js';

const DATA_URL = 'https://raw.githubusercontent.com/siputzx/tebak-jkt/refs/heads/main/tebak.json';

export default {
    name: "Tebak JKT48",
    description: "Get random JKT48 member images for guessing game",
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
                message: err.message || "Gagal mendapatkan data member JKT48",
                code: "INTERNAL_ERROR"
            });
        }
    },
};
