import { loadSession, saveSession } from "../../src/utils/session.js";

export default {
  name: "NoTrack AI",
  description: "Chat dengan NoTrack AI (uncensored). Support multi-turn via session.",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["text", "session_id"],
  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Pesan untuk AI",
      example: "Halo, siapa kamu?",
      minLength: 1,
      maxLength: 2000
    },
    session_id: {
      type: "string",
      required: false,
      description: "Session ID untuk multi-turn chat",
      default: "notrack-default"
    }
  },
  async run(req, res) {
    const { text, session_id } = { ...req.query, ...req.body };

    if (!text) {
      return res.status(400).json({ success: false, error: "Parameter text wajib diisi" });
    }

    try {
      const sessionId = session_id || "notrack-default";
      const sessionData = await loadSession("notrack", sessionId);
      const chatId = sessionData?.chatId || null;

      const headers = {
        "Accept": "*/*",
        "Content-Type": "application/json",
        "Origin": "https://notrack.ai",
        "Referer": "https://notrack.ai/chat",
        "Sec-Ch-Ua": '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
      };

      const response = await fetch("https://notrack.ai/api/dispatch", {
        method: "POST",
        headers,
        body: JSON.stringify({
          user_input: text,
          mode: "usual",
          model: "C",
          persona: "normal",
          max_turns: 6,
          chat_id: chatId,
          attachments: [],
          regenerate: false,
          edit: false,
          edit_mid: null
        })
      });

      if (!response.ok) {
        return res.status(502).json({ success: false, error: `Upstream error: ${response.status}` });
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let finalAnswer = "";
      let returnedChatId = chatId;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop();

        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const jsonStr = part.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr);
            if (data.type === "chat_meta" && data.chat_id) {
              returnedChatId = data.chat_id;
            } else if (data.type === "delta" && data.chunk) {
              finalAnswer += data.chunk;
            } else if (data.type === "error") {
              return res.status(502).json({ success: false, error: data.content || "Upstream error" });
            }
          } catch {}
        }
      }

      if (returnedChatId) {
        await saveSession("notrack", sessionId, { chatId: returnedChatId });
      }

      if (!finalAnswer) {
        return res.status(502).json({ success: false, error: "Tidak ada respons dari AI" });
      }

      return res.json({
        success: true,
        result: {
          answer: finalAnswer,
          chatId: returnedChatId
        }
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
};
