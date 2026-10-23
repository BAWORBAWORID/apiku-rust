import https from "https"

export default {
  name: "CapCut Downloader",
  description: "Download video CapCut dari link CapCut",
  category: "Downloader",
  methods: ["GET"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL CapCut (cth: https://www.capcut.com/watch/xxxxx)",
      example: "https://www.capcut.com/watch/7300000000000000000",
    },
  },
  run(req, res) {
    const { url } = { ...req.query, ...req.body }
    if (!url) {
      return res.status(400).json({ error: "Parameter url wajib" })
    }

    const body = JSON.stringify({ text: url })

    const options = {
      hostname: "snapvideotools.com",
      path: "/id/api/snap",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "Content-Length": Buffer.byteLength(body),
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36",
        "Referer": "https://snapvideotools.com/id/capcut-downloader",
        "Origin": "https://snapvideotools.com",
      },
    }

    const request = https.request(options, (response) => {
      let data = ""
      response.on("data", (chunk) => (data += chunk))
      response.on("end", () => {
        try {
          const json = JSON.parse(data)
          if (json.code !== 0) {
            return res.json({ status: "error", message: json.msg || "Gagal download CapCut", data: json })
          }
          const { title, cover, mediaUrls } = json.data
          res.json({ status: "success", data: { title, cover, mediaUrls } })
        } catch (err) {
          res.json({ status: "error", message: "Gagal parsing response server" })
        }
      })
    })

    req.on("error", (e) => {
      res.json({ status: "error", message: e.message })
    })

    req.write(body)
    req.end()
  },
}