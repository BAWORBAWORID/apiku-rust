import 'dotenv/config'
import { Telegraf } from 'telegraf'
//import { createPluginSystem } from './handler.js'

const token = process.env.ID_TOKEN || process.env.TELEGRAM_TOKEN || "";

export const bot = new Telegraf(token)

export function telebotstart() {
  bot.launch()
  console.log('🤖 Telegraf bot is running...')
}

export async function downloadUrl(msg, media) {
	const file = await msg.telegram.getFile(media.file_id)
    const fileUrl = `https://api.telegram.org/file/bot${process.env.ID_TOKEN}/${file.file_path}`
    return fileUrl
}
