import logger from "../../src/utils/logger.js";

const API_KEYS = [
  "sk-AI0sbKkg6lzlstL4tCtY2nfF5LTLriTvqtjiA1u0xuHNtrF2",
  "sk-N8IOA1ze92C1PsF6nq3aWtrZmJc4foUQab816PWcwibzj9h8",
  "sk-IqBVo41GcfJw6TNYaZ6KL29yPiD836NOIrVFpx706PloKDGv",
  "sk-yvzPMtdOpjn7nytIyCVSlMNvQgXLrWChmYLB0R5K9chkRwtM",
  "sk-R6qsfYFuw0yhyDmd6KVhLRUGjlDKCkab5EQ6cEGWAbHDg7T5",
  "sk-KnmXh7teMcydNOiYVDSHIV26dciks6phRyPfPD84jZwWltbj",
  "sk-ajN6jSytx74sNUhk0RZarEE8TRuMdJjtZL418W1gI133MKsA",
  "sk-QwvlfrHLWjkPnQF5WEclQ3nGHdWHRQU4I0LekvvUXOH14fIf",
  "sk-xJztPCbmabc4UIebRHFBq1slMsz8h5RF7K4ooD4bdGNpsTYO",
  "sk-lTsH8k8JqqZD43KfBqzgLpM4BrRdWcrMPRDUwvgDRvxWKe5X",
];
let keyIndex = 0;
function getApiKey() {
  const key = API_KEYS[keyIndex % API_KEYS.length];
  keyIndex++;
  return key;
}

const UPSTREAM = "https://api.hcnsec.cn/v1/models";

export default {
  name: "HCNsec Models",
  description: "Transparent proxy ke HCNsec API — meneruskan request apa adanya, tanpa modifikasi apapun",
  category: "Agent",
  methods: ["GET"],
  params: [],

  paramsSchema: {},

  async run(req, res) {
    try {
      const apiKey = getApiKey();

      logger.info(`[v3 Models] Using key: ${apiKey.slice(0, 12)}...`);

      const resp = await fetch(UPSTREAM, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      const data = await resp.text();

      logger.info(`[v3 Models] Upstream response ${resp.status}`);

      res.status(resp.status).send(data);
    } catch (err) {
      logger.error(`[v3 Models] Error: ${err.message}`);
      res.status(500).json({ error: { message: err.message || "Proxy error" } });
    }
  },
};