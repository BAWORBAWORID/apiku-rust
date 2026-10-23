import { bot } from '../middleware/telegram.js'

const CHAT_ID = process.env.CHAT_ID || process.env.TELEGRAM_CHAT_ID || 5323386592
const KATEGORI = ["Request Fitur", "Laporan Bug", "Feedback", "Lainnya"]

export { KATEGORI }

export default async function sendReport({ kategori, pesan, nama, kontak, ip }) {
  if (!kategori || !pesan) {
    throw new Error("Parameter 'kategori' dan 'pesan' wajib diisi")
  }

  if (!KATEGORI.includes(kategori)) {
    throw new Error(`Kategori tidak valid. Pilihan: ${KATEGORI.join(", ")}`)
  }

  if (typeof pesan !== "string" || pesan.trim().length === 0) {
    throw new Error("Parameter 'pesan' tidak boleh kosong")
  }

  if (pesan.length > 5000) {
    throw new Error("Pesan terlalu panjang (maksimal 5000 karakter)")
  }

  const timeStr = new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "full",
    timeStyle: "long"
  })

  const emojiMap = {
    "Request Fitur": "🚀",
    "Laporan Bug": "🐛",
    "Feedback": "💬",
    "Lainnya": "📌"
  }

  const emoji = emojiMap[kategori] || "📌"

  let message = `${emoji} *${kategori.toUpperCase()}*\n\n`
  message += `🕒 *Waktu:* ${timeStr}\n`
  message += `🌐 *IP:* ${ip || "Unknown"}\n`

  if (nama && nama.trim()) {
    message += `👤 *Nama:* ${nama.trim()}\n`
  }

  if (kontak && kontak.trim()) {
    message += `📞 *Kontak:* ${kontak.trim()}\n`
  }

  message += `\n📝 *Pesan:*\n${pesan.trim()}`

  await bot.telegram.sendMessage(CHAT_ID, message, {
    parse_mode: "Markdown",
    disable_web_page_preview: true
  })

  return { kategori }
}
