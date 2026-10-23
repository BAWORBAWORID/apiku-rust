import crypto from 'crypto';

const ri = (min, max) => crypto.randomInt(min, max + 1);
const rstr = (len, chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') =>
  Array.from({ length: len }, () => chars[crypto.randomInt(chars.length)]).join('');

function pick_arch() {
  const t = crypto.randomInt(3);
  if (t === 0) return 'x86_64';
  if (t === 1) return `i${ri(3, 6)}86`;
  return 'aarch64';
}

function rand_model() {
  const t = crypto.randomInt(5);
  if (t === 0) return `Pixel ${ri(4, 10)}${crypto.randomInt(2) ? ' Pro' : ''}`;
  if (t === 1) return `SM-${rstr(1, 'ABCDEFGH')}${ri(100, 999)}${rstr(1, 'ABCDEFGH')}`;
  if (t === 2) return `Redmi Note ${ri(8, 15)}${crypto.randomInt(2) ? ' Pro' : ''}`;
  if (t === 3) return `${rstr(3, 'ABCDEP')} ${rstr(1)}${ri(10, 99)}`;
  return `CPH${ri(2000, 2600)}`;
}

const GENERATORS = [
  () => {
    const v = `${ri(100, 140)}.0.${ri(1000, 7000)}.${ri(10, 200)}`;
    return { browser: 'chrome', platform: 'windows', ua: `Mozilla/5.0 (Windows NT ${ri(6, 11)}.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36` };
  },
  () => {
    const v = `${ri(100, 140)}.0.${ri(1000, 7000)}.${ri(10, 200)}`;
    return { browser: 'chrome', platform: 'mac', ua: `Mozilla/5.0 (Macintosh; Intel Mac OS X ${ri(10, 15)}_${ri(0, 9)}_${ri(0, 9)}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36` };
  },
  () => {
    const v = `${ri(100, 140)}.0.${ri(1000, 7000)}.${ri(10, 200)}`;
    return { browser: 'chrome', platform: 'linux', ua: `Mozilla/5.0 (X11; Linux ${pick_arch()}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36` };
  },
  () => {
    const v = `${ri(100, 140)}.0.${ri(1000, 7000)}.${ri(10, 200)}`;
    return { browser: 'edge', platform: 'windows', ua: `Mozilla/5.0 (Windows NT ${ri(6, 11)}.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36 Edg/${v}` };
  },
  () => {
    const v = `${ri(100, 140)}.0`;
    return { browser: 'firefox', platform: 'windows', ua: `Mozilla/5.0 (Windows NT ${ri(6, 11)}.0; Win64; x64; rv:${v}) Gecko/20100101 Firefox/${v}` };
  },
  () => {
    const v = `${ri(100, 140)}.0`;
    return { browser: 'firefox', platform: 'linux', ua: `Mozilla/5.0 (X11; Linux ${pick_arch()}; rv:${v}) Gecko/20100101 Firefox/${v}` };
  },
  () => {
    const sv = `${ri(14, 19)}.${ri(0, 9)}`;
    return { browser: 'safari', platform: 'mac', ua: `Mozilla/5.0 (Macintosh; Intel Mac OS X ${ri(10, 15)}_${ri(0, 9)}_${ri(0, 9)}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${sv} Safari/605.1.15` };
  },
  () => {
    const v = `${ri(100, 140)}.0.${ri(1000, 7000)}.${ri(10, 200)}`;
    return { browser: 'chrome', platform: 'android', ua: `Mozilla/5.0 (Linux; Android ${ri(9, 16)}; ${rand_model()}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Mobile Safari/537.36` };
  },
  () => {
    const v = `${ri(14, 19)}_${ri(0, 9)}`;
    return { browser: 'safari', platform: 'ios', ua: `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v.replace('_', '.')} Mobile/15E148 Safari/604.1` };
  },
  () => {
    const v = `${ri(100, 140)}.0`;
    return { browser: 'firefox', platform: 'android', ua: `Mozilla/5.0 (Android ${ri(9, 16)}; Mobile; rv:${v}) Gecko/${v} Firefox/${v}` };
  }
];

export default {
  name: "UserAgent Generator",
  description: "Random Useragent",
  category: "Tools",
  methods: ["GET", "POST"],

  params: ["device"],

  paramsSchema: {
    device: {
      type: "string",
      required: false,
      enum: ["desktop", "mobile", "windows", "mac", "linux", "android", "ios"],
      default: "desktop",
      description: "Filter device/platform (desktop, mobile, atau spesifik: windows, mac, linux, android, ios)"
    }
  },

  async run(req, res) {
    try {
      const { device: rawDevice } = { ...req.query, ...req.body };
      const device = String(rawDevice || 'desktop').toLowerCase().trim();

      const pool = GENERATORS.filter(g => {
        const probe = g();
        if (device === 'desktop') return ['windows', 'mac', 'linux'].includes(probe.platform);
        if (device === 'mobile') return ['android', 'ios'].includes(probe.platform);
        return probe.platform === device;
      });

      if (pool.length === 0) {
        return res.status(400).json({
          status: false,
          message: `Device tidak dikenal: ${device}`,
          supported: ["desktop", "mobile", "windows", "mac", "linux", "android", "ios"]
        });
      }

      const pick = pool[crypto.randomInt(pool.length)]();
      return res.json({
        status: true,
        result: {
          useragent: pick.ua,
          browser: pick.browser,
          platform: pick.platform
        }
      });
    } catch (e) {
      return res.status(500).json({
        status: false,
        message: e.message || "Failed to generate useragent"
      });
    }
  }
};
