import multer from "multer"
import fs from "fs"
import path from "path"
import crypto from "crypto"
import logger from "../../src/utils/logger.js"

const uploadDir = path.join(process.cwd(), "files")
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

const EXPIRY_DB = path.join(process.cwd(), "data", "exp.json")
if (!fs.existsSync(path.dirname(EXPIRY_DB))) fs.mkdirSync(path.dirname(EXPIRY_DB), { recursive: true })
if (!fs.existsSync(EXPIRY_DB)) fs.writeFileSync(EXPIRY_DB, "[]")

function readExpiryDb() {
  try {
    const raw = fs.readFileSync(EXPIRY_DB, "utf-8").trim()
    return raw ? JSON.parse(raw) : []
  } catch (e) {
    logger.warn(`[ILOVEPDF-Exp] Failed to read exp.json: ${e.message}`)
    return []
  }
}

function writeExpiryDb(entries) {
  try {
    fs.writeFileSync(EXPIRY_DB, JSON.stringify(entries, null, 2))
  } catch (e) {
    logger.warn(`[ILOVEPDF-Exp] Failed to write exp.json: ${e.message}`)
  }
}

function addExpiryEntry(entry) {
  const entries = readExpiryDb()
  entries.push(entry)
  writeExpiryDb(entries)
}

function removeExpiryEntry(filename) {
  const entries = readExpiryDb().filter((e) => e.filename !== filename)
  writeExpiryDb(entries)
}

function scheduleDelete(filePath, filename, delayMs = 600000) {
  setTimeout(() => {
    fs.unlink(filePath, (err) => {
      if (!err || err.code === "ENOENT") {
        if (filename) removeExpiryEntry(filename)
        logger.info(`[ILOVEPDF] File expired & deleted | file=${filename || path.basename(filePath)}`)
      } else {
        logger.warn(`[CLEANUP] Gagal hapus ${filePath}: ${err.message}`)
      }
    })
  }, delayMs)
}

function getBaseUrl(req) {
  if (!req) return "https://api.zyvor.my.id"
  const host = req.get("x-forwarded-host") || req.get("host") || ""
  const isLocal = !host || host.includes("localhost") || host.includes("127.0.0.1")
  return isLocal ? "https://api.zyvor.my.id" : `${req.get("x-forwarded-proto") || "https"}://${host}`
}

function randomName(ext = ".pdf") {
  return crypto.randomBytes(16).toString("hex") + ext
}

const TOOL_CATALOG = {
  merge_pdf: {
    slug: "merge_pdf",
    name: "Merge PDF",
    description: "Combine multiple PDF files into one single PDF",
    category: "Organize",
  },
  split_pdf: {
    slug: "split_pdf",
    name: "Split PDF",
    description: "Separate one page or a whole range into independent PDF files",
    category: "Organize",
  },
  compress_pdf: {
    slug: "compress_pdf",
    name: "Compress PDF",
    description: "Reduce PDF file size while optimizing for maximal quality",
    category: "Optimize",
  },
  pdf_to_word: {
    slug: "pdf_to_word",
    name: "PDF to Word",
    description: "Convert PDF documents to editable DOCX Word files",
    category: "Convert from PDF",
  },
  pdf_to_powerpoint: {
    slug: "pdf_to_powerpoint",
    name: "PDF to PowerPoint",
    description: "Convert PDF documents to editable PPTX PowerPoint slides",
    category: "Convert from PDF",
  },
  pdf_to_excel: {
    slug: "pdf_to_excel",
    name: "PDF to Excel",
    description: "Convert PDF tables into editable XLSX spreadsheets",
    category: "Convert from PDF",
  },
  word_to_pdf: {
    slug: "word_to_pdf",
    name: "Word to PDF",
    description: "Convert DOC and DOCX Word documents to PDF",
    category: "Convert to PDF",
  },
  powerpoint_to_pdf: {
    slug: "powerpoint_to_pdf",
    name: "PowerPoint to PDF",
    description: "Convert PPT and PPTX presentations to PDF",
    category: "Convert to PDF",
  },
  excel_to_pdf: {
    slug: "excel_to_pdf",
    name: "Excel to PDF",
    description: "Convert XLS and XLSX spreadsheets to PDF",
    category: "Convert to PDF",
  },
  pdf_to_jpg: {
    slug: "pdf_to_jpg",
    name: "PDF to JPG",
    description: "Extract images or convert each PDF page into a JPG image",
    category: "Convert from PDF",
  },
  jpg_to_pdf: {
    slug: "jpg_to_pdf",
    name: "JPG to PDF",
    description: "Convert JPG, PNG, GIF, BMP images into PDF pages",
    category: "Convert to PDF",
  },
  rotate_pdf: {
    slug: "rotate_pdf",
    name: "Rotate PDF",
    description: "Rotate PDF pages clockwise or counter-clockwise",
    category: "Organize",
  },
  protect_pdf: {
    slug: "protect-pdf",
    name: "Protect PDF",
    description: "Encrypt and lock PDF documents with a secure password",
    category: "Security",
  },
  unlock_pdf: {
    slug: "unlock_pdf",
    name: "Unlock PDF",
    description: "Remove PDF password security and encryption",
    category: "Security",
  },
  watermark_pdf: {
    slug: "pdf_add_watermark",
    name: "Watermark PDF",
    description: "Stamp an image or text watermark over PDF pages",
    category: "Edit",
  },
  page_numbers: {
    slug: "add_pdf_page_number",
    name: "Page Numbers",
    description: "Add custom page numbers to PDF with flexible positioning",
    category: "Edit",
  },
  repair_pdf: {
    slug: "repair-pdf",
    name: "Repair PDF",
    description: "Recover and repair corrupt or damaged PDF documents",
    category: "Optimize",
  },
  pdf_to_pdfa: {
    slug: "convert-pdf-to-pdfa",
    name: "PDF to PDF/A",
    description: "Convert PDF documents to PDF/A for long-term archiving",
    category: "Convert to PDF",
  },
  crop_pdf: {
    slug: "crop-pdf",
    name: "Crop PDF",
    description: "Trim margins and crop specific areas of PDF pages",
    category: "Edit",
  },
}

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase()
  switch (ext) {
    case ".pdf":
      return "application/pdf"
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    case ".doc":
      return "application/msword"
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    case ".ppt":
      return "application/vnd.ms-powerpoint"
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    case ".xls":
      return "application/vnd.ms-excel"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".png":
      return "image/png"
    case ".webp":
      return "image/webp"
    case ".gif":
      return "image/gif"
    case ".bmp":
      return "image/bmp"
    default:
      return "application/octet-stream"
  }
}

async function prepareFileItem(item, defaultIndex = 0) {
  if (Buffer.isBuffer(item) || item instanceof Uint8Array) {
    const filename = `file_${defaultIndex + 1}.pdf`
    return {
      name: filename,
      data: item,
      mime: getMimeType(filename),
    }
  }

  if (item && typeof item === "object") {
    let buf = item.data || item.buffer || item.file
    if (typeof buf === "string") {
      buf = Buffer.from(buf)
    }

    const filename = item.name || item.filename || item.originalname || `file_${defaultIndex + 1}.pdf`
    return {
      name: filename,
      data: buf,
      mime: item.mime || item.mimetype || getMimeType(filename),
      rotate: item.rotate,
      password: item.password,
      pages: item.pages,
    }
  }

  throw new Error("Format file tidak valid")
}

async function executeTool(toolSlug, filesInput, options = {}) {
  const resolvedSlug = TOOL_CATALOG[toolSlug]?.slug || toolSlug
  const rawList = Array.isArray(filesInput) ? filesInput : [filesInput]
  const files = await Promise.all(rawList.map((f, i) => prepareFileItem(f, i)))

  if (files.length === 0) {
    throw new Error("Minimal satu file harus disediakan")
  }

  const pageUrl = `https://www.ilovepdf.com/${resolvedSlug}`
  const pageRes = await fetch(pageUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  })

  if (!pageRes.ok) {
    throw new Error(`Gagal membuka halaman tool ${resolvedSlug}: HTTP ${pageRes.status}`)
  }

  const html = await pageRes.text()
  const configMatch = html.match(/var ilovepdfConfig = ({.*?});/s)
  const taskMatch = html.match(/ilovepdfConfig\.taskId\s*=\s*[\x27"]([a-zA-Z0-9]+)[\x27"]/)

  if (!configMatch || !taskMatch) {
    throw new Error(`Gagal membaca konfigurasi tool ${resolvedSlug}`)
  }

  const config = JSON.parse(configMatch[1])
  const taskId = taskMatch[1]
  const token = config.token
  const servers = config.servers || []

  if (servers.length === 0) {
    throw new Error("Server iLovePDF tidak tersedia")
  }

  const selectedServer = `https://${servers[Math.floor(Math.random() * servers.length)]}.ilovepdf.com`
  const uploadedFiles = []

  for (const file of files) {
    const uploadForm = new FormData()
    uploadForm.append("name", file.name)
    uploadForm.append("chunk", "0")
    uploadForm.append("chunks", "1")
    uploadForm.append("task", taskId)
    uploadForm.append("preview", "0")
    uploadForm.append("pdfinfo", "0")
    uploadForm.append("pdfforms", "0")
    uploadForm.append("pdfresetforms", "0")
    uploadForm.append("v", "web.0")
    uploadForm.append("file", new Blob([file.data], { type: file.mime }), file.name)

    const upRes = await fetch(`${selectedServer}/v1/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      body: uploadForm,
    })

    const upData = await upRes.json()
    if (!upRes.ok || !upData.server_filename) {
      throw new Error(`Upload gagal untuk ${file.name}: ${JSON.stringify(upData)}`)
    }

    uploadedFiles.push({
      server_filename: upData.server_filename,
      filename: file.name,
      rotate: file.rotate,
      password: file.password,
      pages: file.pages,
    })
  }

  const mergedOptions = { ...config.defaultOptions, ...options }
  const procForm = new FormData()
  procForm.append("task", taskId)
  procForm.append("tool", config.tool)
  if (config.subtool) {
    procForm.append("subtool", config.subtool)
  }

  for (const [key, val] of Object.entries(mergedOptions)) {
    if (val !== null && val !== undefined) {
      procForm.append(key, typeof val === "boolean" ? (val ? "1" : "0") : String(val))
    }
  }

  uploadedFiles.forEach((file, index) => {
    procForm.append(`files[${index}][server_filename]`, file.server_filename)
    procForm.append(`files[${index}][filename]`, file.filename)
    if (file.rotate !== undefined && file.rotate !== null) {
      procForm.append(`files[${index}][rotate]`, String(file.rotate))
    }
    if (file.password) {
      procForm.append(`files[${index}][password]`, file.password)
    }
    if (file.pages) {
      procForm.append(`files[${index}][pages]`, file.pages)
    }
  })

  const procRes = await fetch(`${selectedServer}/v1/process`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      Origin: "https://www.ilovepdf.com",
      Referer: pageUrl,
    },
    body: procForm,
  })

  const procData = await procRes.json()
  if (!procRes.ok || procData.status !== "TaskSuccess") {
    throw new Error(`Proses gagal untuk ${resolvedSlug}: ${JSON.stringify(procData)}`)
  }

  const dlUrl = `${selectedServer}/v1/download/${taskId}`
  const dlRes = await fetch(dlUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!dlRes.ok) {
    throw new Error(`Download file hasil gagal: HTTP ${dlRes.status}`)
  }

  const resultBuffer = Buffer.from(await dlRes.arrayBuffer())

  let outputExts = []
  try {
    outputExts = JSON.parse(procData.output_extensions || "[]")
  } catch {
    outputExts = [procData.output_extensions]
  }

  return {
    success: true,
    tool: config.tool,
    subtool: config.subtool || null,
    task: taskId,
    server: selectedServer,
    filename: procData.download_filename,
    filesize: procData.filesize,
    outputFilesize: procData.output_filesize,
    outputExtensions: outputExts,
    timer: procData.timer,
    data: resultBuffer,
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // max 50MB
})

export default {
  name: "iLovePDF Tools",
  description: "Pengolahan & konversi dokumen PDF lengkap (iLovePDF): compress, convert (PDF to Word/PPT/Excel/JPG, Word/PPT/Excel/JPG to PDF), merge, split, rotate, protect, unlock, watermark, page numbers, repair, dll.",
  category: "Tools",
  methods: ["GET", "POST"],

  params: ["file", "tool", "url", "password", "rotation", "text", "pages"],

  paramsSchema: {
    file: {
      type: "file",
      required: false,
      description: "File dokumen yang ingin diproses (PDF, DOCX, PPTX, XLSX, JPG, PNG)",
    },
    tool: {
      type: "string",
      required: false,
      default: "compress_pdf",
      enum: Object.keys(TOOL_CATALOG),
      description: "Pilihan operasi pengolahan PDF. Default: compress_pdf",
      example: "compress_pdf",
    },
    url: {
      type: "string",
      required: false,
      description: "Alternatif jika file berasal dari URL publik langsung",
      example: "https://example.com/sample.pdf",
    },
    password: {
      type: "string",
      required: false,
      description: "Password untuk protect_pdf atau unlock_pdf",
      example: "123456",
    },
    rotation: {
      type: "number",
      required: false,
      default: 90,
      description: "Derajat putaran untuk rotate_pdf (90, 180, 270)",
      example: 90,
    },
    text: {
      type: "string",
      required: false,
      description: "Teks watermark untuk watermark_pdf",
      example: "CONFIDENTIAL",
    },
    pages: {
      type: "string",
      required: false,
      description: "Rentang halaman untuk split_pdf (contoh: '1-3' atau '1,2,5')",
      example: "1",
    },
  },

  async run(req, res) {
    upload.any()(req, res, async (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ status: false, message: "File terlalu besar (maksimal 50MB)" })
        }
        return res.status(400).json({ status: false, message: err.message || "Upload error" })
      }

      try {
        const params = { ...req.query, ...req.body }
        const selectedTool = (params.tool || "compress_pdf").toLowerCase().replace(/-/g, "_")

        // Jika hanya request info katalog tools (action=list atau GET tanpa file)
        if (req.method === "GET" && !params.url && !req.files?.length) {
          return res.json({
            status: true,
            total_tools: Object.keys(TOOL_CATALOG).length,
            tools: Object.values(TOOL_CATALOG),
            instruction: "Upload file dengan method POST (multipart/form-data) atau gunakan query parameter 'url' beserta parameter 'tool'.",
          })
        }

        const filesToProcess = []

        // 1. Ambil file dari multipart upload jika ada
        if (req.files && req.files.length > 0) {
          for (const f of req.files) {
            filesToProcess.push({
              name: f.originalname || f.name,
              data: f.buffer,
              mime: f.mimetype || getMimeType(f.originalname || ""),
            })
          }
        }

        // 2. Ambil file dari URL jika disediakan
        if (params.url) {
          const fileUrl = params.url.trim()
          logger.info(`[ILOVEPDF] Fetching file from URL | url=${fileUrl}`)
          const urlRes = await fetch(fileUrl, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            },
          })
          if (!urlRes.ok) {
            return res.status(400).json({ status: false, message: `Gagal mengunduh file dari URL (${urlRes.status})` })
          }

          const buf = Buffer.from(await urlRes.arrayBuffer())
          let urlFilename = path.basename(new URL(fileUrl).pathname) || "document.pdf"
          if (!path.extname(urlFilename)) urlFilename += ".pdf"

          filesToProcess.push({
            name: urlFilename,
            data: buf,
            mime: urlRes.headers.get("content-type") || getMimeType(urlFilename),
          })
        }

        if (filesToProcess.length === 0) {
          return res.status(400).json({
            status: false,
            message: "File wajib diunggah (multipart field: file) atau sertakan parameter 'url' file.",
            available_tools: Object.keys(TOOL_CATALOG),
          })
        }

        const toolOptions = {}
        if (selectedTool === "protect_pdf") {
          if (!params.password) {
            return res.status(400).json({ status: false, message: "Parameter 'password' wajib diisi untuk protect_pdf" })
          }
          toolOptions.protect_password = params.password
          toolOptions.password = params.password
        }
        if (selectedTool === "unlock_pdf" && params.password) {
          toolOptions.password = params.password
          filesToProcess.forEach((f) => (f.password = params.password))
        }
        if (selectedTool === "rotate_pdf") {
          const rot = parseInt(params.rotation, 10) || 90
          toolOptions.rotation = rot
          filesToProcess.forEach((f) => (f.rotate = rot))
        }
        if (selectedTool === "watermark_pdf") {
          toolOptions.mode = "text"
          toolOptions.text = params.text || "WATERMARK"
          toolOptions.vertical_position = "bottom"
          toolOptions.horizontal_position = "center"
        }
        if (selectedTool === "split_pdf") {
          toolOptions.split_mode = "ranges"
          toolOptions.ranges = params.pages || "1"
        }

        logger.info(`[ILOVEPDF] Executing tool: ${selectedTool} | files=${filesToProcess.length} | ip=${req.ip}`)
        const execResult = await executeTool(selectedTool, filesToProcess, toolOptions)

        // Simpan file hasil ke direktori /files/ dengan TTL 10 menit
        const outExt = path.extname(execResult.filename) || `.${execResult.outputExtensions?.[0] || "pdf"}`
        const savedFilename = randomName(outExt)
        const savedFilePath = path.join(uploadDir, savedFilename)
        fs.writeFileSync(savedFilePath, execResult.data)

        const TTL = 10 * 60 * 1000 // 10 menit
        const expires_at = new Date(Date.now() + TTL).toISOString()
        addExpiryEntry({
          filename: savedFilename,
          expiresAt: expires_at,
          filePath: savedFilePath,
          originalName: execResult.filename,
          size: execResult.data.length,
          mimetype: getMimeType(execResult.filename),
        })
        scheduleDelete(savedFilePath, savedFilename, TTL)

        const baseUrl = getBaseUrl(req)
        const downloadUrl = `${baseUrl}/files/${savedFilename}`

        return res.json({
          status: true,
          tool: selectedTool,
          result: {
            filename: execResult.filename,
            original_size: execResult.filesize,
            output_size: execResult.outputFilesize,
            download_url: downloadUrl,
            expires_in: "10 menit",
            expires_at,
          },
        })
      } catch (e) {
        logger.error(`[ILOVEPDF] Error: ${e.message}`)
        return res.status(500).json({ status: false, message: e.message || "Gagal memproses file PDF" })
      }
    })
  },
}
