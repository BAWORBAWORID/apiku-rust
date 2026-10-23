const extract = (html, label) => {
  const regex = new RegExp(
    `<th[^>]*>${label}[\\s\\S]*?<\\/th>[\\s\\S]*?<td>(.*?)<\\/td>`,
    'i'
  )
  const match = html.match(regex)
  return match
    ? match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    : null
}

async function checkML(user_id, zone_id) {
  const response = await fetch('https://pizzoshop.com/mlchecker/check', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'Mozilla/5.0 (Linux; Android 16)',
      'x-requested-with': 'com.xbrowser.play'
    },
    body: new URLSearchParams({ user_id, zone_id })
  })

  const html = await response.text()

  return {
    user_id,
    zone_id,
    nickname: extract(html, 'Nickname'),
    region: extract(html, 'Region ID'),
    last_login_country: extract(html, 'Last Login from'),
    created_date: extract(html, 'Created data date') || extract(html, 'Created date'),
    found: html.includes('Account found')
  }
}

export default {
  name: "ML Stalker",
  description: "Check Mobile Legends account info by User ID & Zone ID",
  category: "Stalker",
  methods: ["GET", "POST"],
  params: ["user_id", "zone_id"],

  paramsSchema: {
    user_id: {
      type: "string",
      required: true,
      description: "Mobile Legends User ID (numbers only)",
      pattern: "^[0-9]+$"
    },
    zone_id: {
      type: "string",
      required: true,
      description: "Mobile Legends Zone ID (numbers only)",
      pattern: "^[0-9]+$"
    }
  },

  async run(req, res) {
    const startTime = Date.now()

    try {
      const params = { ...req.query, ...req.body }
      const userId = params.user_id || params.id
      const zoneId = params.zone_id || params.zone

      if (!userId || !zoneId) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'user_id' dan 'zone_id' wajib diisi",
          example: {
            GET: "/api/stalker/ml?user_id=1189852221&zone_id=13826",
            POST: { "user_id": "1189852221", "zone_id": "13826" }
          }
        })
      }

      if (!/^\d+$/.test(userId.toString()) || !/^\d+$/.test(zoneId.toString())) {
        return res.status(400).json({
          status: false,
          message: "User ID dan Zone ID harus berupa angka"
        })
      }

      const result = await checkML(userId.toString(), zoneId.toString())
      const duration = Date.now() - startTime

      if (!result.found) {
        return res.status(404).json({
          status: false,
          message: "Account not found",
          result: {
            user_id: result.user_id,
            zone_id: result.zone_id,
            found: false
          },
          metadata: { processing_time: `${duration}ms` }
        })
      }

      return res.json({
        status: true,
        result
      })

    } catch (error) {
      const duration = Date.now() - startTime
      return res.status(500).json({
        status: false,
        message: error.message || "Failed to check ML account",
        metadata: { processing_time: `${duration}ms` }
      })
    }
  }
}
