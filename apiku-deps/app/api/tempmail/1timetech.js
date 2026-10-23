const btoa = (str) => Buffer.from(str).toString('base64');
const atob = (str) => Buffer.from(str, 'base64').toString('utf8');

function encode(text) {
  return '=' + btoa(text).split('').reverse().join('');
}

function decode(encoded) {
  const str = encoded.startsWith('=') ? encoded.slice(1) : encoded;
  return JSON.parse(atob(str.split('').reverse().join('')));
}

const base_url = 'https://mail-server.1timetech.com/api/email';

const hdrs = {
  'User-Agent': 'okhttp/4.9.2',
  'Connection': 'Keep-Alive',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Encoding': 'gzip',
  'x-app-key': 'f07bed4503msh719c2010df3389fp1d6048jsn411a41a84a3c'
};

async function generateEmail() {
  const res = await fetch(base_url, {
    method: 'POST',
    headers: { ...hdrs, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: '' })
  });
  if (!res.ok) {
    throw new Error(`Failed to generate email: HTTP ${res.status}`);
  }
  const json = await res.json();
  return decode(json.data);
}

async function checkInbox(emailAddress) {
  const res = await fetch(`${base_url}/${emailAddress}/messages?params==03e&_=${Date.now()}`, {
    method: 'GET',
    headers: hdrs
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch inbox: HTTP ${res.status}`);
  }
  const json = await res.json();
  return decode(json.data);
}

export default {
  name: "TempMail - 1TimeTech",
  description: "Temporary email service — create & inbox.",
  category: "Email",
  methods: ["GET", "POST"],
  params: ["action", "email"],

  paramsSchema: {
    action: {
      type: "string",
      required: true,
      default: "create",
      enum: ["create", "inbox"],
      description: "Aksi: create (buat email baru) atau inbox (cek pesan masuk)"
    },
    email: {
      type: "string",
      required: false,
      description: "Alamat email untuk cek inbox (wajib jika action=inbox)",
      example: "abc@voewo.com"
    }
  },

  async run(req, res) {
    const { action, email } = { ...req.query, ...req.body };

    if (!action) {
      return res.status(400).json({ status: false, message: "Parameter 'action' wajib diisi (create / inbox)" });
    }

    if (action === "create") {
      try {
        const generated = await generateEmail();

        return res.json({
          status: true,
          action: "create",
          result: {
            email: generated.email,
            mailId: generated.id
          }
        });
      } catch (err) {
        return res.status(500).json({ status: false, message: err.message || "Gagal membuat email" });
      }
    }

    if (action === "inbox") {
      if (!email) {
        return res.status(400).json({ status: false, message: "Parameter 'email' wajib diisi untuk action=inbox" });
      }

      try {
        const messages = await checkInbox(email.trim());

        return res.json({
          status: true,
          action: "inbox",
          result: {
            email: email.trim(),
            total: messages.length,
            messages: messages.map(msg => ({
              id: msg.id || msg.uid,
              from: msg.from || msg.sender,
              subject: msg.subject,
              date: msg.date || msg.created_at || msg.time,
              body: msg.body || msg.text || msg.html || null
            }))
          }
        });
      } catch (err) {
        return res.status(500).json({ status: false, message: err.message || "Gagal mengambil pesan" });
      }
    }

    return res.status(400).json({ status: false, message: "action tidak valid. Gunakan: create / inbox" });
  }
};
