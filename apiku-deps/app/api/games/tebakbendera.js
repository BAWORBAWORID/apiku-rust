import { fetchCached, pickRandom } from '../../src/utils/gameCache.js';
import logger from "../../src/utils/logger.js";

const PRIMARY_URL = 'https://flagcdn.com/en/codes.json';
const BACKUP_URL = 'https://raw.githubusercontent.com/BochilTeam/database/master/games/tebakbendera2.json';

export default {
    name: "Tebak Bendera",
    description: "Get random country flag quiz to test geography knowledge",
    category: "Games",
    methods: ["GET", "POST"],
    params: [],

    paramsSchema: {},

    async run(req, res) {
        try {
            let flagData;
            let source;

            // Try primary API (flagcdn.com returns object, not array)
            try {
                const data = await fetchCached(PRIMARY_URL);
                const countryCodes = Object.keys(data);

                if (countryCodes.length > 0) {
                    const randomCode = countryCodes[Math.floor(Math.random() * countryCodes.length)];
                    flagData = {
                        name: data[randomCode],
                        img: `https://flagpedia.net/data/flags/ultra/${randomCode}.png`,
                        code: randomCode
                    };
                    source = "flagcdn.com";
                }
            } catch (primaryErr) {
                logger.warn(`[TEBAKBENDERA] Primary API failed, trying backup: ${primaryErr.message}`);
            }

            // Fallback to backup API (BochilTeam array)
            if (!flagData) {
                const flags = await fetchCached(BACKUP_URL);
                const { item } = pickRandom(flags);
                flagData = item;
                source = "bochilteam";
            }

            res.setHeader("X-Source", source);
            res.json({ status: true, result: flagData });

        } catch (err) {
            logger.error(`[TEBAKBENDERA] Error | ip=${req.ip} | message=${err.message}`);

            res.status(500).json({
                status: false,
                message: err.message || "Gagal mendapatkan bendera",
                code: "INTERNAL_ERROR"
            });
        }
    },
};
