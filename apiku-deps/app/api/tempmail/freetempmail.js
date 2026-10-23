/**
 * FreeTempMail API - Using free-temp-mail.eu.org (Livewire 3 Engine)
 * GET /api/tempmail/freetempmail?sessionId=user123&action=create
 * GET /api/tempmail/freetempmail?sessionId=user123&action=inbox
 */

import axios from "axios";
import logger from "../../src/utils/logger.js";

const FMAIL_CONFIG = {
  BASE_URL: "https://free-temp-mail.eu.org",
  TIMEOUT: 20000,
  MAX_AGE: 24 * 60 * 60 * 1000, // 24 jam dalam milidetik
};

// In-Memory Session Map (sessionId -> { cookie, email, csrfToken, createdAt })
const sessionMap = new Map();

// Helper: Bersihkan sesi yang sudah kedaluwarsa (> 24 jam)
function cleanExpiredSessions() {
  const now = Date.now();
  for (const [sid, data] of sessionMap.entries()) {
    if (now - data.createdAt > FMAIL_CONFIG.MAX_AGE) {
      sessionMap.delete(sid);
    }
  }
}

export default {
  name: "TempMail - FreeTempMail (Fmail)",
  description: "Temporary email service (create, inbox)",
  category: "Email",
  methods: ["GET", "POST"],

  params: ["sessionId", "action"],

  paramsSchema: {
    sessionId: {
      type: "string",
      required: true,
      description: "Session ID untuk menyimpan email (custom)",
    },
    action: {
      type: "string",
      required: true,
      enum: ["create", "inbox"],
      description: "Aksi: create (buat email baru) atau inbox (cek pesan masuk)",
    },
  },

  async run(req, res) {
    const startTime = Date.now();
    cleanExpiredSessions();

    try {
      const { sessionId, action } = { ...req.query, ...req.body };

      if (!sessionId || typeof sessionId !== "string" || sessionId.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'sessionId' wajib diisi",
          code: "MISSING_SESSION_ID",
        });
      }

      const cleanSessionId = sessionId.trim();
      const cleanAction = (action || "create").toLowerCase().trim();

      logger.info(`[FreeTempMail] Processing action=${cleanAction} | sessionId=${cleanSessionId}`);

      if (cleanAction === "create") {
        // 1. Kunjungi halaman utama untuk mendapatkan sesi awal & CSRF
        const initRes = await axios.get(FMAIL_CONFIG.BASE_URL + "/", {
          timeout: FMAIL_CONFIG.TIMEOUT,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        });

        const html = initRes.data;
        const csrfMatch = html.match(/<meta name="csrf-token" content="([^"]+)"/);
        const csrfToken = csrfMatch ? csrfMatch[1] : "";
        const initCookies = initRes.headers["set-cookie"]?.map((c) => c.split(";")[0]).join("; ") || "";

        const actionMatch = html.match(/wire:snapshot="([^"]+)"\s+[^>]*wire:id="([^"]+)"/);
        if (!actionMatch) {
          throw new Error("Gagal mengambil komponen Livewire awal dari server free-temp-mail.eu.org");
        }

        const rawSnapshot = actionMatch[1].replace(/&quot;/g, '"');

        // 2. Panggil action deleteEmail untuk membuat email acak baru
        const createRes = await axios.post(
          FMAIL_CONFIG.BASE_URL + "/livewire/update",
          {
            _token: csrfToken,
            components: [
              {
                snapshot: rawSnapshot,
                updates: {},
                calls: [{ path: "", method: "deleteEmail", params: [] }],
              },
            ],
          },
          {
            timeout: FMAIL_CONFIG.TIMEOUT,
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36",
              "Content-Type": "application/json",
              "X-CSRF-TOKEN": csrfToken,
              "X-Livewire": "true",
              "Cookie": initCookies,
              "Origin": FMAIL_CONFIG.BASE_URL,
              "Referer": FMAIL_CONFIG.BASE_URL + "/",
            },
          }
        );

        const updatedCookies = createRes.headers["set-cookie"]?.map((c) => c.split(";")[0]).join("; ") || initCookies;
        const createData = createRes.data?.components?.[0];
        if (!createData || !createData.snapshot) {
          throw new Error("Gagal mendapatkan respons email acak dari server free-temp-mail.eu.org");
        }

        const parsedSnapshot = JSON.parse(createData.snapshot);
        const emailCreated = parsedSnapshot?.data?.email;
        if (!emailCreated) {
          throw new Error("Alamat email tidak ditemukan dalam respons komponen");
        }

        // 3. Simpan di Map() sessionMap dengan key cleanSessionId yang diberikan pengguna
        sessionMap.set(cleanSessionId, {
          cookie: updatedCookies,
          email: emailCreated,
          csrfToken: csrfToken,
          createdAt: Date.now(),
        });

        const processingTimeMs = Date.now() - startTime;
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");

        return res.json({
          status: true,
          action: "create",
          sessionId: cleanSessionId,
          result: {
            email: emailCreated,
            sessionId: cleanSessionId,
            expiresIn: "24 hours",
          },
          timestamp: Date.now(),
          processingTimeMs,
        });
      } else if (cleanAction === "inbox" || cleanAction === "check") {
        const sess = sessionMap.get(cleanSessionId);
        if (!sess) {
          return res.status(404).json({
            status: false,
            message: "Session tidak ditemukan. Buat email terlebih dahulu dengan action=create",
            code: "SESSION_NOT_FOUND",
          });
        }

        // Kunjungi halaman /mailbox dengan cookie sesi yang tersimpan
        const inboxRes = await axios.get(FMAIL_CONFIG.BASE_URL + "/mailbox", {
          timeout: FMAIL_CONFIG.TIMEOUT,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36",
            "Cookie": sess.cookie,
          },
        });

        // Update cookie jika server memperbarui sesi
        const refreshedCookies = inboxRes.headers["set-cookie"]?.map((c) => c.split(";")[0]).join("; ");
        if (refreshedCookies) {
          sess.cookie = refreshedCookies;
          sessionMap.set(cleanSessionId, sess);
        }

        const html = inboxRes.data;
        const matches = [...html.matchAll(/wire:snapshot="([^"]+)"\s+[^>]*wire:id="([^"]+)"/g)];
        let messagesList = [];
        let currentEmail = sess.email;

        for (const m of matches) {
          try {
            const snap = JSON.parse(m[1].replace(/&quot;/g, '"'));
            if (snap.memo?.name === "frontend.app") {
              if (snap.data?.email) currentEmail = snap.data.email;
              if (Array.isArray(snap.data?.messages) && Array.isArray(snap.data.messages[0])) {
                messagesList = snap.data.messages[0];
              }
            }
          } catch (e) {}
        }

        const processingTimeMs = Date.now() - startTime;
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");

        return res.json({
          status: true,
          action: "inbox",
          sessionId: cleanSessionId,
          result: {
            email: currentEmail,
            count: messagesList.length,
            messages: messagesList,
          },
          timestamp: Date.now(),
          processingTimeMs,
        });
      } else {
        return res.status(400).json({
          status: false,
          message: `Aksi '${action}' tidak valid. Gunakan action=create atau action=inbox.`,
          code: "INVALID_ACTION",
        });
      }
    } catch (err) {
      const processingTimeMs = Date.now() - startTime;
      logger.error(`[FreeTempMail] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Request ke free-temp-mail.eu.org gagal",
        code: "FMAIL_ERROR",
        metadata: { processingTimeMs },
      });
    }
  },
};
