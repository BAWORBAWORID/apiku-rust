import axios from 'axios'
import logger from "../../src/utils/logger.js"

const BASE_URL = 'https://cook.aizdzj.com'
const REFERER = 'https://draw.freeforai.com/'

const AVAILABLE_MODELS = ['flux-dev', 'flux-kontext']
const AVAILABLE_SIZES = ['1024*1024', '1024*576', '576*1024']

const headers = {
  'Referer': REFERER,
  'Origin': 'https://draw.freeforai.com',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  'Content-Type': 'application/x-www-form-urlencoded'
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateImage(prompt, size = '1024*1024', model = 'flux-dev') {
  const encodedPrompt = encodeURIComponent(prompt);
  const imgName = `ref-${Date.now()}${Math.random().toString(36).substring(2, 10)}`;

  const submitData = `prompt=${encodedPrompt}&size=${size}&model=${model}&influence=100&image_name=${imgName}`;

  const submitRes = await axios.post(`${BASE_URL}/draw/text2image.php`, submitData, { headers, responseType: 'text', timeout: 30000 });
  const submitText = submitRes.data;

  const taskIdMatch = submitText.match(/"task_id"\s*:\s*"([^"]+)"/);
  if (!taskIdMatch) {
    throw new Error('No task_id in response: ' + submitText.substring(0, 200));
  }
  const taskId = taskIdMatch[1];

  for (let i = 1; i <= 45; i++) {
    await sleep(2000);

    const pollRes = await axios.post(`${BASE_URL}/draw/text2image.php`, `task_id=${taskId}`, { headers, responseType: 'text', timeout: 30000 });
    const pollText = pollRes.data;

    const statusMatch = pollText.match(/"task_status"\s*:\s*"([^"]+)"/);
    const status = statusMatch ? statusMatch[1] : null;

    if (status === 'SUCCEEDED') {
      const urlMatch = pollText.match(/"url"\s*:\s*"([^"]+)"/);
      let url = urlMatch ? urlMatch[1].replace(/\\/g, '') : null;

      if (!url) {
        throw new Error('No URL in response');
      }

      return { task_id: taskId, url };
    } else if (status === 'FAILED') {
      throw new Error('Generation failed');
    }
  }

  throw new Error('Timeout: Generation took too long');
}

export default {
  name: "FreeForAI Image Generator",
  description: "FreeForAI FLUX.1 Dev/Kontext AI image generation (free, unlimited, no login)",
  category: "Image AI",
  methods: ["GET", "POST"],
  params: ["prompt", "model", "size"],
  paramsSchema: {
    prompt: { type: "string", required: true, description: "Prompt untuk generate gambar", example: "a beautiful sunset over mountains" },
    model: { type: "string", required: false, default: "flux-dev", enum: ["flux-dev", "flux-kontext"], description: "Model AI: flux-dev (default) atau flux-kontext" },
    size: { type: "string", required: false, default: "1024*1024", enum: ["1024*1024", "1024*576", "576*1024"], description: "Ukuran gambar (aspect ratio)" }
  },

  async run(req, res) {
    try {
      const { prompt, model = "flux-dev", size = "1024*1024" } = { ...req.query, ...req.body }

      if (!AVAILABLE_MODELS.includes(model)) {
        return res.status(400).json({ status: false, message: `Model tidak tersedia. Pilihan: ${AVAILABLE_MODELS.join(', ')}` })
      }

      if (!AVAILABLE_SIZES.includes(size)) {
        return res.status(400).json({ status: false, message: `Size tidak tersedia. Pilihan: ${AVAILABLE_SIZES.join(', ')}` })
      }

      if (!prompt) return res.status(400).json({ status: false, message: "Parameter 'prompt' wajib" })

      const result = await generateImage(prompt, size, model)

      return res.json({
        status: true,
        result: {
          prompt,
          model,
          size,
          task_id: result.task_id,
          url: result.url
        }
      })

    } catch (err) {
      logger.error(`[FREEFORAI] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || "FreeForAI request failed" })
    }
  }
}