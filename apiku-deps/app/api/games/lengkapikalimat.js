import { fetchCached, pickRandom } from '../../src/utils/gameCache.js';

const DATA_URL = 'https://raw.githubusercontent.com/qisyana/scrape/main/lengkapikalimat.json';

export default {
    name: "Lengkapi Kalimat",
    description: "Get random sentence completion questions for language learning",
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
                message: err.message || "Gagal mendapatkan pertanyaan lengkapi kalimat",
                code: "INTERNAL_ERROR"
            });
        }
    },
};
