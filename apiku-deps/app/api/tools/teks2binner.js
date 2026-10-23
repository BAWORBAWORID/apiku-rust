/**
 * Text to Binary API (Direct Binary Output)
 *
 * GET /tools/text-to-binary?text=HELLO&format=raw|space|array
 *
 * result:
 * - Format raw: 01001000010001010100110001001100
 * - Format space: 01001000 01000101 01001100 01001100
 * - Format array: ["01001000","01000101","01001100","01001100"]
 */

import logger from "../../src/utils/logger.js"

export default {
  name: "Text To Binary",
  description: "Convert text/string to binary representation",
  category: "Tools",
  methods: ["GET"],
  params: ["text", "format"],

  paramsSchema: {
    text: {
      type: "string",
      required: true,
    },
    format: {
      type: "string",
      enum: ["raw", "space", "array"],
      default: "raw",
    },
  },

  async run(req, res) {
    try {
      const { text, format = "raw" } = req.query || {}

      if (!text) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'text' wajib diisi",
        })
      }

      // Konversi teks ke binary
      const binaryArray = []
      for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i)
        const binary = charCode.toString(2).padStart(8, '0')
        binaryArray.push(binary)
      }

      let result
      switch (format) {
        case "space":
          result = binaryArray.join(" ")
          break
        case "array":
          result = binaryArray
          break
        default: // raw
          result = binaryArray.join("")
      }

      logger.info(
        `[TEXT-BINARY] converted | ip=${req.ip} | chars=${text.length}`
      )

      return res.json({
        status: true,
        original: text,
        binary: result,
        format: format,
        length: binaryArray.length
      })

    } catch (err) {
      logger.error(
        `[TEXT-BINARY] Error | ip=${req.ip} | error=${err.message}`
      )
      return res.status(500).json({
        status: false,
        message: err.message || "Failed to convert text to binary",
      })
    }
  },
}