import { fetchCached, pickRandom } from '../../src/utils/gameCache.js';

const DATA_URL = 'https://raw.githubusercontent.com/BochilTeam/database/master/games/tebakkalimat.json';

export default {
    name: "Tebak Kalimat",
    description: "Get random sentence puzzles to test language skills",
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
                message: err.message || "Gagal mendapatkan tebak kalimat",
                code: "INTERNAL_ERROR"
            });
        }
    },
};
