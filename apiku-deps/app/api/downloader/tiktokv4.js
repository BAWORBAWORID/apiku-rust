import axios from 'axios';
import * as cheerio from 'cheerio';
import qs from 'qs';

async function tiktokDownloader(tiktokUrl) {
    try {
        const baseUrl = 'https://ssstik.io/id';
        const getHome = await axios.get(baseUrl, {
            headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36' }
        });
        const $home = cheerio.load(getHome.data);
        const autoToken = $home('input[name="tt"]').val() || 'a2JpaXJi';

        const url = 'https://ssstik.io/abc?url=dl';
        const headers = {
            'hx-current-url': 'https://ssstik.io/id',
            'hx-request': 'true',
            'hx-target': 'target',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
        };

        const data = qs.stringify({
            'id': tiktokUrl,
            'locale': 'id',
            'tt': autoToken
        });

        const response = await axios.post(url, data, { headers });
        const $ = cheerio.load(response.data);

        const result = {
            author: $('.result_author').attr('alt') || null,
            description: $('.maintext').text().trim() || null,
            video: $('.download_link.without_watermark').attr('href') || null,
            video_hd: $('#hd_download').attr('data-directurl') || null,
            music: $('.download_link.music').attr('href') || null
        };

        if (!result.video && !result.music) {
           throw new Error("Gagal mengekstrak link download dari ssstik.io");
        }

        return result;

    } catch (error) {
        throw error;
    }
}

export default {
    name: "TikTok Downloader v4",
    description: "Download video TikTok tanpa watermark",
    category: "Downloader",
    methods: ["GET", "POST"],
    params: ["url"],
    paramsSchema: {
        url: {
            type: "string",
            required: true,
            description: "URL video TikTok yang ingin diunduh",
            default: "https://vt.tiktok.com/ZSbm6fY8P/",
            example: "https://vt.tiktok.com/ZSbm6fY8P/"
        }
    },

    async run(req, res) {
        try {
            const { url } = { ...req.query, ...req.body };

            if (!url || !String(url).trim()) {
                return res.status(400).json({
                    status: false,
                    message: "Parameter 'url' wajib diisi"
                });
            }

            const result = await tiktokDownloader(String(url).trim());

            return res.json({
                status: true,
                provider: "ssstik.io",
                input: url.trim(),
                result: result
            });
        } catch (err) {
            return res.status(500).json({
                status: false,
                message: err.message || "Gagal mendownload TikTok"
            });
        }
    }
};
