import { fetchCached, pickRandom } from '../../src/utils/gameCache.js';

const DATA_URL = 'https://raw.githubusercontent.com/siputzx/karakter-freefire/refs/heads/main/data.json';

export default {
    name: "Tebak Karakter Free Fire",
    description: "Get random Free Fire character details for guessing game",
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
                message: err.message || "Gagal mendapatkan data karakter Free Fire",
                code: "INTERNAL_ERROR"
            });
        }
    },
};
