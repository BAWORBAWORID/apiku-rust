function formatText(text) {
  if (!text) return "";
  return text
    .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
    .replace(/\$([^$]+)\$/g, "$1")
    .trim();
}

export default {
  name: "EduBrain AI",
  description: "Homework Helper & AI tutor (GraphQL API). Sangat baik untuk soal matematika, sains, dan pelajaran sekolah lainnya.",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["text"],
  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Pertanyaan atau soal matematika/pelajaran",
      example: "Diketahui fungsi f(x) = x⁴ - 8x² + 16. Tentukan semua nilai x yang memenuhi f(f(x)) = 16."
    }
  },
  async run(req, res) {
    const { text } = { ...req.query, ...req.body };

    if (!text) {
      return res.status(400).json({ success: false, error: "Parameter text wajib diisi" });
    }

    const endpoint = "https://wrtools-api.es-tech.co/graphql/ai_call";

    const payload = {
      query: `mutation BrainToolsHomeworkHelperFirst($clientHash: String!, $clientUserId: String!, $sessionSourceUrl: String!, $gaCid: String!, $requestType: String!, $subject: String, $instructions: String!, $instructionsFromFiles: [String]) {
  brainToolsHomeworkHelperFirst(
    clientHash: $clientHash
    clientUserId: $clientUserId
    sessionSourceUrl: $sessionSourceUrl
    gaCid: $gaCid
    requestType: $requestType
    subject: $subject
    instructions: $instructions
    instructionsFromFiles: $instructionsFromFiles
  ) {
    status {
      code
      message
    }
    generatedText
    responseGenIdHash
    chatIdHash
    textSubjectGroup
  }
}`,
      variables: {
        clientHash: "9c8d4c3959694ca",
        clientUserId: "",
        sessionSourceUrl: "https://edubrain.ai/",
        gaCid: "GA1.1.1373185759.1784942259",
        requestType: "simple",
        subject: "-Any Subject-",
        instructions: text,
        instructionsFromFiles: []
      },
      operationName: "BrainToolsHomeworkHelperFirst"
    };

    const headers = {
      "Accept": "application/graphql-response+json, application/json",
      "Accept-Language": "id-ID",
      "Content-Type": "application/json",
      "Origin": "https://my.edubrain.ai",
      "Referer": "https://my.edubrain.ai/",
      "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36"
    };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        return res.status(502).json({ success: false, error: `Upstream error: ${response.statusText} (${response.status})` });
      }

      const json = await response.json();
      const data = json?.data?.brainToolsHomeworkHelperFirst;

      if (data?.status?.code !== 200 && data?.status?.message !== "OK") {
        return res.status(502).json({ success: false, error: `API Error: ${data?.status?.message || "Unknown error"}` });
      }

      const rawText = data?.generatedText || "Tidak ada respons dari AI.";
      const formatted = formatText(rawText);

      return res.json({
        success: true,
        result: formatted
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
};
