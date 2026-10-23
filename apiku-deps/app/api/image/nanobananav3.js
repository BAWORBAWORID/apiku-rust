import axios from "axios";
import FormData from "form-data";
import logger from "../../src/utils/logger.js";

const HEADERS = {
  origin: "https://imgupscaler.ai",
  referer: "https://imgupscaler.ai/",
  "user-agent": "Mozilla/5.0",
};

const genserial = () => [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join("");

async function downloadImage(url) {
  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 25000, headers: { "User-Agent": "Mozilla/5.0" } });
  return Buffer.from(res.data);
}

export default {
  name: "Nano Banana V3",
  description: "AI Image Editor — Edit atau ubah gambar dengan teks prompt (Simple & Cepat)",
  category: "Image",
  methods: ["GET", "POST"],
  params: ["url", "prompt", "file"],
  paramsSchema: {
    file: {
      type: "file",
      required: false,
      description: "Upload file gambar langsung (alternatif dari url)",
    },
    url: {
      type: "string",
      required: false,
      default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
      description: "URL gambar yang akan diedit",
    },
    prompt: {
      type: "string",
      required: false,
      default: "ubah agar dia tersenyum",
      description: "Prompt editing",
    },
  },

  async run(req, res) {
    try {
      const url = req.query?.url || req.body?.url || "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg";
      const prompt = req.query?.prompt || req.body?.prompt || "ubah agar dia tersenyum";

      logger.info(`[NANOBANANA3] Processing prompt: "${prompt}"`);

      let imageBuffer = (req.files && req.files[0]?.buffer) || req.file?.buffer || (await downloadImage(url));
      const filename = `nano_${Date.now()}.jpg`;

      // 1. Dapatkan slot upload OSS
      const formUp = new FormData();
      formUp.append("file_name", filename);
      const { data: { result: uploadInfo } } = await axios.post(
        "https://api-v2.imgupscaler.ai/api/common/upload/upload-image",
        formUp,
        { headers: { ...formUp.getHeaders(), ...HEADERS } }
      );
      if (!uploadInfo?.url) throw new Error("Gagal mendapatkan slot upload dari upstream");

      // 2. Upload file ke OSS
      await axios.put(uploadInfo.url, imageBuffer, {
        headers: { "Content-Type": "image/jpeg", "Content-Length": imageBuffer.length },
        maxBodyLength: Infinity,
      });

      // 3. Dapatkan signed URL
      const formSign = new FormData();
      formSign.append("object_name", uploadInfo.object_name);
      formSign.append("params", JSON.stringify({ "x-oss-process": "image/resize,m_fill,w_128,h_128/quality,q_80/format,webp" }));
      const { data: { result: { url: signedUrl } } } = await axios.post(
        "https://api-v2.imgupscaler.ai/api/common/upload/sign-object",
        formSign,
        { headers: { ...formSign.getHeaders(), ...HEADERS } }
      );

      // 4. Create Job
      const serial = genserial();
      await axios.post("https://api-v2.imgupscaler.ai/api/pai/common/free-credits-config", {}, { headers: { ...HEADERS, "product-serial": serial } });

      const formJob = new FormData();
      formJob.append("model_name", "nano_banana");
      formJob.append("original_image_url", signedUrl);
      formJob.append("prompt", prompt);
      formJob.append("ratio", "match_input_image");
      formJob.append("output_format", "jpg");

      const { data: { result: jobInfo } } = await axios.post(
        "https://api-v2.imgupscaler.ai/api/runtime/jobs/create-job",
        formJob,
        {
          headers: {
            ...formJob.getHeaders(),
            ...HEADERS,
            "product-code": "magiceraser",
            "product-serial": serial,
            "router-key": "photo_editor_nano_banana_v1",
            timezone: "Asia/Jakarta",
          },
        }
      );
      if (!jobInfo?.job_id) throw new Error("Gagal membuat job editing di upstream");

      const jobId = jobInfo.job_id;
      logger.info(`[NANOBANANA3] Polling Job ID: ${jobId}`);

      // 5. Polling hasil
      let attempts = 0, result;
      do {
        await new Promise((r) => setTimeout(r, 3500));
        const resJob = await axios.get(`https://api-v2.imgupscaler.ai/api/runtime/jobs/get-job/${jobId}`, {
          headers: { ...HEADERS, "product-serial": serial },
        });
        result = resJob.data;
        attempts++;
      } while (result?.code === 300006 && attempts < 35);

      if (result?.code !== 100000 || !result?.result?.output_url) {
        throw new Error(result?.message || "Proses editing gagal atau waktu habis");
      }

      const outputBuffer = await downloadImage(result.result.output_url);
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Content-Length", outputBuffer.length);
      res.setHeader("X-Prompt", prompt);
      return res.send(outputBuffer);
    } catch (error) {
      logger.error(`[NANOBANANA3] Error: ${error.message}`);
      return res.status(500).json({ status: false, message: error.message || "Failed processing Nano Banana V3 image edit" });
    }
  },
};
