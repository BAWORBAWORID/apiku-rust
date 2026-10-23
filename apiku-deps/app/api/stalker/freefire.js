import crypto from 'node:crypto'
import logger from '../../src/utils/logger.js'

const FF_BASE_URL = 'https://freefire.my.id'
const ADEN_BASE_URL = 'https://adenpedia.my.id/update01'

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const SERVER_NAMES = {
  ID: 'Indonesia',
  IND: 'India',
  BD: 'Bangladesh',
  PK: 'Pakistan',
  SG: 'Singapore',
  TH: 'Thailand',
  VN: 'Vietnam',
  TW: 'Taiwan',
  BR: 'Brazil',
  NA: 'North America',
  EU: 'Europe',
  ME: 'Middle East',
}

const BR_RANK_MAP = {
  1000: ['Bronze I', 1],
  1100: ['Bronze II', 2],
  1200: ['Bronze III', 3],
  1310: ['Silver I', 4],
  1410: ['Silver II', 5],
  1600: ['Silver III', 6],
  1610: ['Gold I', 7],
  1735: ['Gold II', 8],
  1860: ['Gold III', 9],
  1985: ['Gold IV', 10],
  2110: ['Platinum I', 11],
  2235: ['Platinum II', 12],
  2360: ['Platinum III', 13],
  2485: ['Platinum IV', 14],
  2610: ['Platinum V', 15],
  2760: ['Diamond I', 16],
  2910: ['Diamond II', 17],
  3060: ['Diamond III', 18],
  3210: ['Diamond IV', 19],
  3350: ['Diamond V', 20],
  3510: ['Heroic I', 21],
  3670: ['Heroic II', 22],
  3830: ['Heroic III', 23],
  3990: ['Heroic IV', 24],
  4150: ['Heroic V', 25],
  4320: ['Master I', 26],
  4490: ['Master II', 27],
  4660: ['Master III', 28],
  4830: ['Master IV', 29],
  5000: ['Master V', 30],
  5200: ['Grandmaster I', 31],
  5400: ['Grandmaster II', 32],
  5600: ['Grandmaster III', 33],
  5800: ['Grandmaster IV', 34],
  6000: ['Grandmaster V', 35],
}

const CS_RANK_MAP = {
  0: ['None', 0],
  100: ['Bronze I', 1],
  110: ['Bronze II', 2],
  120: ['Bronze III', 3],
  130: ['Bronze IV', 4],
  140: ['Silver I', 5],
  150: ['Silver II', 6],
  160: ['Silver III', 7],
  170: ['Silver IV', 8],
  180: ['Gold I', 9],
  190: ['Gold II', 10],
  200: ['Gold III', 11],
  210: ['Gold IV', 12],
  220: ['Platinum I', 13],
  230: ['Platinum II', 14],
  240: ['Platinum III', 15],
  250: ['Platinum IV', 16],
  260: ['Diamond I', 17],
  270: ['Diamond II', 18],
  280: ['Diamond III', 19],
  290: ['Diamond IV', 20],
  300: ['Heroic', 21],
  310: ['Grandmaster', 22],
  320: ['Master', 23],
}

const PRIME_CONFIG = {
  PRICE_PER_POINT: 128,
  PRICE_PER_DIAMOND: 126,
  BOOYAH_DIAMONDS_PER_LEVEL: 20,
  PRIME_LEVELS: {
    1: 100,
    2: 1000,
    3: 3000,
    4: 10000,
    5: 30000,
    6: 60000,
    7: 120000,
    8: 200000,
  },
}

const CHARACTER_MAP = {
  102000001: 'Primis',
  102000002: 'Nulla',
  102000003: 'Ford',
  102000004: 'Andrew',
  102000005: 'Kelly',
  102000006: 'Olivia',
  102000007: 'Maxim',
  102000008: 'Misha',
  102000009: 'Nikita',
  102000010: 'Kla',
  102000011: 'Paloma',
  102000012: 'Miguel',
  102000013: 'Caroline',
  102000014: 'Antonio',
  102000015: 'Wukong',
  102000016: 'Hayato',
  102000017: 'Moco',
  102000018: 'Laura',
  102000019: 'Rafael',
  102000020: 'A124',
  102000021: 'Shani',
  102000022: 'Joseph',
  102000023: 'Notora',
  102000024: 'Alvaro',
  102000025: 'Steffie',
  102000026: 'Jota',
  102000027: 'Kapella',
  102000028: 'Wolfrahh',
  102000029: 'Luqueta',
  102000030: 'Jai',
  102000031: 'K',
  102000032: 'Dasha',
  102000033: 'Chrono',
  102000034: 'Shirou',
  102000035: 'Skyler',
  102000036: 'Xayne',
  102000037: 'D-Bee',
  102000038: 'Dimitri',
  102000039: 'Thiva',
  102000040: 'Leon',
  102000041: 'Otho',
  102000042: 'Nairi',
  102000043: 'Kenta',
  102000044: 'Homer',
  102000045: 'Iris',
  102000046: 'J.Biebs',
  102000047: 'Tatsuya',
  102000048: 'Luna',
  102000049: 'Santino',
  102000050: 'Orion',
  102000051: 'Alok (Awakened)',
  102000052: 'Sonia',
  102000053: 'Suzy',
  102000054: 'Ignis',
  102000055: 'Ryden',
  102000056: 'Kairos',
  102000057: 'Kassie',
  102000058: 'Lila',
  102000000: 'Alok',
}

const PET_MAP = {
  1300000001: 'Poring',
  1300000002: 'Kitty',
  1300000003: 'Mechanical Puppy',
  1300000004: 'Shiba',
  1300000005: 'Night Panther',
  1300000006: 'Spirit Fox',
  1300000007: 'Robo',
  1300000008: 'Ottero',
  1300000009: 'Detective Panda',
  1300000091: 'Falco',
  1300000092: 'Mr. Waggor',
  1300000093: 'Rockie',
  1300000094: 'Beaston',
  1300000095: 'Dreki',
  1300000096: 'Moony',
  1300000097: 'Sensei Tig',
  1300000098: 'Agent Hop',
  1300000099: 'Yeti',
  1300000100: 'Flash',
  1300000101: 'Zasil',
  1300000102: 'Finn',
  1300000103: 'Hoot',
  1300000104: 'Fang',
  1300000105: 'Arvon',
  1300000106: 'Kactus',
  1300000107: 'Pug',
}

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex')
}

function solvePow(challenge, difficulty) {
  const prefix = '0'.repeat(difficulty)
  for (let t = 0; ; t++) {
    const pow = t.toString(36)
    if (sha256(`${challenge}:${pow}`).startsWith(prefix)) {
      return pow
    }
  }
}

async function getChallengeToken(referer = FF_BASE_URL) {
  const res = await fetch(`${FF_BASE_URL}/api/token`, {
    headers: {
      'User-Agent': DEFAULT_UA,
      Referer: referer,
    },
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) {
    throw new Error(`Gagal mengambil challenge token: HTTP ${res.status}`)
  }

  return await res.json()
}

async function getAuthHeaders(apiPath, referer = FF_BASE_URL) {
  const { token, challenge, difficulty } = await getChallengeToken(referer)
  const pow = solvePow(challenge, difficulty)
  const sig = sha256(`${token}|${apiPath}|${pow}`)

  return {
    'x-fp-token': token,
    'x-fp-pow': pow,
    'x-fp-sig': sig,
    'User-Agent': DEFAULT_UA,
    Referer: referer,
  }
}

function getPermanentIcon(id) {
  if (!id) return null
  return `https://cdn.jsdelivr.net/gh/ShahGCreator/icon@main/PNG/${id}.png`
}

function getBrRank(points) {
  let rankName = 'Bronze I'
  let rankId = 1
  for (const [threshold, [name, id]] of Object.entries(BR_RANK_MAP).reverse()) {
    if (points >= Number(threshold)) {
      rankName = name
      rankId = id
      break
    }
  }
  return { name: rankName, id: rankId, points }
}

function getCsRank(csRank, csPoints = 0) {
  let rankName = 'None'
  let rankId = 0
  let star = 0
  for (const [threshold, [name, id]] of Object.entries(CS_RANK_MAP).reverse()) {
    if (csRank >= Number(threshold)) {
      rankName = name
      rankId = id
      break
    }
  }
  if (rankId >= 1 && rankId <= 20) star = ((csRank - 100) % 10) + 1
  return { name: rankName, id: rankId, star, points: csPoints }
}

function formatFullDate(ts) {
  if (!ts || ts === '0' || Number(ts) === 0) return null
  const num = Number(ts)
  const date = new Date(num > 1e11 ? num : num * 1000)
  if (isNaN(date.getTime())) return null
  return date.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function formatIsoDate(ts) {
  if (!ts || ts === '0' || Number(ts) === 0) return null
  const num = Number(ts)
  const date = new Date(num > 1e11 ? num : num * 1000)
  if (isNaN(date.getTime())) return null
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
}

function formatLastLogin(ts) {
  if (!ts || ts === '0' || Number(ts) === 0) return null
  const num = Number(ts)
  const d = new Date(num > 1e11 ? num : num * 1000)
  if (isNaN(d.getTime())) return null
  const diff = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diff < 60) return `${diff} detik lalu`
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`
  if (diff < 2592000) return `${Math.floor(diff / 86400)} hari lalu`
  return d.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatBattleTag(tag) {
  if (!tag) return tag
  return String(tag)
    .replace(/^PlayerBattleTagID_/i, '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatBattleTags(tags, counts) {
  if (!Array.isArray(tags) || tags.length === 0) return []
  return tags.map((t, idx) => ({
    tag: formatBattleTag(t),
    rawTag: t,
    count: Array.isArray(counts) && counts[idx] !== undefined ? counts[idx] : 1,
  }))
}

function formatLanguage(lang) {
  if (!lang) return null
  return String(lang)
    .replace(/^Language_/i, '')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatRankShow(show) {
  if (!show) return null
  return String(show).replace(/^RankShow_/i, '')
}

function rupiah(n) {
  return 'Rp' + Number(n).toLocaleString('id-ID')
}

function calcPrimePrice(primeLevel, primePoints = 0) {
  const price = {
    primeLevel: null,
    primePoints: null,
    booyahPass: null,
  }

  if (primeLevel && primeLevel >= 1 && primeLevel <= 8) {
    const diamonds = PRIME_CONFIG.PRIME_LEVELS[primeLevel]
    price.primeLevel = {
      level: primeLevel,
      diamonds: diamonds,
      ratePerDiamond: PRIME_CONFIG.PRICE_PER_DIAMOND,
      total: diamonds * PRIME_CONFIG.PRICE_PER_DIAMOND,
      totalFormatted: rupiah(diamonds * PRIME_CONFIG.PRICE_PER_DIAMOND),
    }
  }

  if (primePoints && primePoints > 0) {
    price.primePoints = {
      points: primePoints,
      ratePerPoint: PRIME_CONFIG.PRICE_PER_POINT,
      total: primePoints * PRIME_CONFIG.PRICE_PER_POINT,
      totalFormatted: rupiah(primePoints * PRIME_CONFIG.PRICE_PER_POINT),
    }
  }

  let estimatedDiamonds = 0
  if (primePoints && primePoints > 0) {
    estimatedDiamonds = Math.floor(
      primePoints * (PRIME_CONFIG.PRICE_PER_POINT / PRIME_CONFIG.PRICE_PER_DIAMOND)
    )
  } else if (primeLevel && primeLevel >= 1 && primeLevel <= 8) {
    estimatedDiamonds = PRIME_CONFIG.PRIME_LEVELS[primeLevel]
  }

  if (estimatedDiamonds > 0) {
    price.booyahPass = {
      estimatedDiamonds: estimatedDiamonds,
      diamondsPerLevel: PRIME_CONFIG.BOOYAH_DIAMONDS_PER_LEVEL,
      estimatedLevels: Math.floor(
        estimatedDiamonds / PRIME_CONFIG.BOOYAH_DIAMONDS_PER_LEVEL
      ),
      ratePerDiamond: PRIME_CONFIG.PRICE_PER_DIAMOND,
      total: estimatedDiamonds * PRIME_CONFIG.PRICE_PER_DIAMOND,
      totalFormatted: rupiah(estimatedDiamonds * PRIME_CONFIG.PRICE_PER_DIAMOND),
    }
  }

  return price
}

/**
 * Fetch profile directly from primary engine (freefire.my.id)
 */
async function fetchPrimaryFF(uid) {
  const apiPath = '/api/ff'
  const referer = `${FF_BASE_URL}/stalk/${uid}`
  const headers = await getAuthHeaders(apiPath, referer)

  const res = await fetch(`${FF_BASE_URL}${apiPath}?uid=${encodeURIComponent(uid)}`, {
    headers,
    signal: AbortSignal.timeout(15000),
  })

  const json = await res.json().catch(() => null)

  if (res.status === 404 || (json && json.error && !json.player)) {
    return {
      notFound: true,
      error: json?.error || 'Player tidak ditemukan.',
    }
  }

  if (!res.ok || !json?.player) {
    throw new Error(json?.error || `Primary HTTP ${res.status}`)
  }

  return { notFound: false, data: json }
}

/**
 * Fallback to secondary source (adenpedia)
 */
async function fetchFallbackFF(uid) {
  const url = `${ADEN_BASE_URL}/info.php?uid=${encodeURIComponent(uid)}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': DEFAULT_UA,
      Referer: `${ADEN_BASE_URL}/`,
      Origin: 'https://adenpedia.my.id',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) throw new Error(`Fallback HTTP ${res.status}`)
  const json = await res.json()

  if (json.error || !json.basicInfo?.nickname) {
    return {
      notFound: true,
      error: json.error || 'Player tidak ditemukan / UID tidak valid',
    }
  }

  return { notFound: false, data: json }
}

export default {
  name: 'Free Fire Stalker',
  description:
    'Cek info lengkap akun Free Fire via UID (Level, Rank, Banned status, Pet, Outfit, Character, Diamond Cost, & Prime Price Calculator)',
  category: 'Stalker',
  methods: ['GET', 'POST'],
  params: ['uid'],
  paramsSchema: {
    uid: {
      type: 'string',
      required: true,
      description: 'Free Fire UID (8-11 digit angka)',
      example: '1531107934',
      minLength: 8,
      maxLength: 11,
      pattern: '^\\d+$',
    },
  },

  async run(req, res) {
    const { uid } = { ...req.query, ...req.body }

    if (!uid || !/^\d{8,11}$/.test(String(uid).trim())) {
      return res.status(400).json({
        status: false,
        error: 'UID tidak valid (harus 8-11 digit angka)',
        example: '1531107934',
      })
    }

    const cleanUid = String(uid).trim()

    try {
      const [primaryResult, fallbackResult] = await Promise.allSettled([
        fetchPrimaryFF(cleanUid),
        fetchFallbackFF(cleanUid),
      ])

      const primary = primaryResult.status === 'fulfilled' ? primaryResult.value : null
      const fallback = fallbackResult.status === 'fulfilled' ? fallbackResult.value : null

      if (primary?.notFound && fallback?.notFound) {
        return res.status(404).json({
          status: false,
          error: primary.error || fallback.error || 'Player tidak ditemukan.',
        })
      }

      if ((primary?.notFound && !fallback?.data) || (fallback?.notFound && !primary?.data)) {
        return res.status(404).json({
          status: false,
          error: primary?.error || fallback?.error || 'Player tidak ditemukan.',
        })
      }

      if (!primary?.data && !fallback?.data) {
        const errMsg =
          primaryResult.reason?.message ||
          fallbackResult.reason?.message ||
          'Gagal mengambil data dari server Free Fire'
        throw new Error(errMsg)
      }

      const primaryData = primary?.data || null
      const adenData = fallback?.data || null

      const player = primaryData?.player || {}
      const guildData = primaryData?.guild || {}
      const petData = primaryData?.pet || {}
      const socialData = primaryData?.social || {}
      const banData = primaryData?.ban || {}
      const creditData = primaryData?.credit || {}

      const basic = adenData?.basicInfo || {}
      const clan = adenData?.clanBasicInfo || {}
      const social = adenData?.socialInfo || {}
      const adenPet = adenData?.petInfo || {}

      const region = player.region || basic.region || 'ID'
      const serverName = SERVER_NAMES[region] || region
      const rankingPoints = player.rankingPoints ?? basic.rankingPoints ?? 0
      const brRank = getBrRank(rankingPoints)
      const csRank = getCsRank(player.csRank || basic.csRank || 0, basic.csRankingPoints || 0)

      const primeLevel = player.primeInfo?.primeLevel || basic.primeInfo?.primeLevel || 0
      const primePoints = basic.primeInfo?.primePoints || 0
      const primePrice = calcPrimePrice(primeLevel, primePoints)

      const maxRank = basic.maxRank ?? player.rank ?? null
      const maxRankName = maxRank ? getBrRank(maxRank).name : null
      const csMaxRank = basic.csMaxRank ?? player.csRank ?? null
      const csMaxRankName = csMaxRank ? getCsRank(csMaxRank, 0).name : null

      const headPic = player.headPic || basic.headPic
      const bannerId = player.equippedBanner?.id || basic.bannerId
      const charId = player.equippedCharacter?.id || adenData?.profileInfo?.avatarId
      const petId = petData.id || adenPet.id || null
      const petSkinId = petData.skinId || adenPet.skinId || null

      const avatar = player.avatarUrl || getPermanentIcon(headPic)
      const banner = player.equippedBanner?.icon || getPermanentIcon(bannerId)

      const equippedAvatar = player.equippedAvatar || (headPic ? {
        id: headPic,
        name: null,
        icon: getPermanentIcon(headPic),
        type: 'Avatars',
        description: null,
      } : null)

      const equippedBanner = player.equippedBanner || (bannerId ? {
        id: bannerId,
        name: null,
        icon: getPermanentIcon(bannerId),
        type: 'Banners',
        description: null,
      } : null)

      const equippedCharacter = player.equippedCharacter || (charId ? {
        id: charId,
        name: CHARACTER_MAP[charId] || null,
        icon: getPermanentIcon(charId),
        type: 'Characters',
        description: null,
      } : null)

      const hasGuild = Boolean(
        guildData.guildName || guildData.guildId || clan.clanName || clan.clanId
      )
      const guild = hasGuild
        ? {
            name: guildData.guildName || clan.clanName || null,
            id: guildData.guildId || clan.clanId || null,
            level: guildData.guildLevel || clan.clanLevel || 0,
            memberNum: guildData.memberNum || clan.memberNum || 0,
            capacity: guildData.capacity || clan.capacity || 0,
            leader: clan.leaderName || null,
          }
        : null

      const hasPet = Boolean(
        petData.name || petData.id || petData.speciesName || adenPet.name || adenPet.id
      )
      const pet = hasPet
        ? {
            id: petId,
            name: petData.name || adenPet.name || null,
            speciesName: petData.speciesName || PET_MAP[petId] || null,
            level: petData.level || adenPet.level || 0,
            exp: petData.exp || adenPet.exp || 0,
            isSelected: Boolean(petData.isSelected ?? adenPet.isSelected),
            skinId: petSkinId,
            skinName: petData.skinName || null,
            skinIconUrl: petData.skinIconUrl || getPermanentIcon(petSkinId),
            selectedSkillId: petData.selectedSkillId || adenPet.selectedSkillId || null,
            skillName: petData.skillName || null,
          }
        : null

      const signature = socialData.signature || social.signature || null
      const language = formatLanguage(social.language)
      const rankShow = formatRankShow(social.rankShow)
      const battleTags = formatBattleTags(social.battleTag, social.battleTagCount)

      const socialResult = (signature || language || rankShow || battleTags.length > 0)
        ? {
            signature,
            language,
            rankShow,
            battleTags,
          }
        : null

      const createAtTs = player.createAt || basic.createAt
      const lastLoginTs = player.lastLoginAt || basic.lastLoginAt

      const creditScore =
        creditData.creditScore ?? adenData?.creditScoreInfo?.creditScore ?? basic.creditScore ?? 100

      const ban = {
        isBanned: Boolean(banData.isBanned),
        status: banData.status || (banData.isBanned ? 'BANNED' : 'NOT BANNED'),
        banPeriod: banData.banPeriod ?? 0,
        lastLoginAt: banData.lastLoginAt ?? null,
      }

      const diamondCost = adenData?.diamondCostRes?.diamondCost ?? null

      const result = {
        uid: cleanUid,
        nickname: player.nickname || basic.nickname || null,
        region,
        server: serverName,
        level: player.level || basic.level || 0,
        exp: player.exp || basic.exp || 0,
        likes: player.liked || basic.liked || 0,
        diamondCost,
        accountType: basic.accountType ?? null,
        seasonId: basic.seasonId ?? null,
        badgeId: basic.badgeId ?? null,
        rank: player.rank || basic.rank || 0,
        rankName: brRank.name,
        rankId: brRank.id,
        rankingPoints,
        maxRank,
        maxRankName,
        csRank: player.csRank || basic.csRank || 0,
        csRankName: csRank.name,
        csRankId: csRank.id,
        csMaxRank,
        csMaxRankName,
        hasElitePass: Boolean(player.hasElitePass ?? basic.hasElitePass),
        createdAt: formatFullDate(createAtTs),
        createdAtFormatted: formatIsoDate(createAtTs),
        lastLoginAt: formatLastLogin(lastLoginTs),
        lastLoginAtFormatted: formatIsoDate(lastLoginTs),
        avatar,
        banner,
        equippedAvatar,
        equippedBanner,
        equippedCharacter,
        equippedTitle: player.equippedTitle || null,
        equippedPin: player.equippedPin || null,
        equippedOutfitItems: player.equippedOutfitItems || [],
        equippedWeaponOutfitItems: player.equippedWeaponOutfitItems || [],
        equippedLookChangerItems: player.equippedLookChangerItems || [],
        equippedArrivalAnimationItems: player.equippedArrivalAnimationItems || [],
        guild,
        pet,
        social: socialResult,
        creditScore,
        ban,
        primePrice: {
          primeLevel: primePrice.primeLevel,
          primePoints: primePrice.primePoints,
          booyahPass: primePrice.booyahPass,
        },
      }

      return res.json({
        status: true,
        result,
        timestamp: new Date().toISOString(),
      })
    } catch (e) {
      logger.error(`[FF Stalker] Error for UID ${cleanUid}: ${e.message}`)
      return res.status(500).json({
        status: false,
        error: 'Gagal mengambil data dari sumber Free Fire',
        detail: e.message,
      })
    }
  },
}
