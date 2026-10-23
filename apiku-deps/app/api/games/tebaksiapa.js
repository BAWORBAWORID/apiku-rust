import { fetchCached, pickRandom } from '../../src/utils/gameCache.js';

const DATA_URL = 'https://raw.githubusercontent.com/BochilTeam/database/master/games/siapakahaku.json';

export default {
    name: "Siapakah Aku",
    description: "Get random 'Who Am I?' riddles with clues",
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
                message: err.message || "Gagal mendapatkan siapakah aku",
                code: "INTERNAL_ERROR"
            });
        }
    },
};
