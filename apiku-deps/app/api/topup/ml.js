import crypto from "crypto"
import QRCode from "qrcode"
import path from "path"
import fs from "fs"
import logger from "../../src/utils/logger.js"
import { trackQR } from "./assets/topupTraker.js"

const uploadDir = path.join(process.cwd(), "files")
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir)

const TOKOGAKE_BASE = "https://api.tokogame.com/core/v1"

const PRODUCT_ID = "60f39f1e70a6874c6a151e4e"

function makeHeaders() {
  const requestId = crypto.randomUUID()
  const secretId = crypto.createHmac("sha256", "tokogame.com").update(requestId).digest("hex")
  const appInstanceId = crypto.randomUUID().replace(/-/g, "")
  return {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "X-Language": "ID",
    "X-Region": "ID",
    "X-Currency": "IDR",
    "X-Request-Id": requestId,
    "X-Secret-Id": secretId,
    "X-App-Instance-Id": appInstanceId,
    Origin: "https://www.tokogame.com",
    Referer: "https://www.tokogame.com/",
  }
}

const PACKAGES = [
  { code: "1818", label: "3 Diamonds (3 + 0 Bonus)", group: "Diamonds" },
  { code: "ML_5--2", label: "5 Diamonds (5 + 0 Bonus)", group: "Diamonds" },
  { code: "ML_10--2", label: "10 Diamonds (9 + 1 Bonus)", group: "Diamonds" },
  { code: "ML11", label: "11 Diamonds (10 + 1 Bonus)", group: "Diamonds" },
  { code: "ML12", label: "12 Diamonds (11 + 1 Bonus)", group: "Diamonds" },
  { code: "ML14", label: "14 Diamonds (13 + 1 Bonus)", group: "Diamonds" },
  { code: "ML15", label: "15 Diamonds (14 + 1 Bonus)", group: "Diamonds" },
  { code: "ML15_2-S121", label: "17 Diamonds (15 + 2 Bonus)", group: "Diamonds" },
  { code: "ML18", label: "18 Diamonds (17 + 1 Bonus)", group: "Diamonds" },
  { code: "ML19", label: "19 Diamonds (17 + 2 Bonus)", group: "Diamonds" },
  { code: "ML20", label: "20 Diamonds (18 + 2 Bonus)", group: "Diamonds" },
  { code: "ML22", label: "22 Diamonds (21 + 1 Bonus)", group: "Diamonds" },
  { code: "ML28", label: "28 Diamonds (25 + 3 Bonus)", group: "Diamonds" },
  { code: "ML_30--2", label: "30 Diamonds (28 + 2 Bonus)", group: "Diamonds" },
  { code: "ML30_3-S121", label: "33 Diamonds (30 + 3 Bonus)", group: "Diamonds" },
  { code: "ML34", label: "34 Diamonds (31 + 3 Bonus)", group: "Diamonds" },
  { code: "ML36", label: "36 Diamonds (33 + 3 Bonus)", group: "Diamonds" },
  { code: "ML44", label: "44 Diamonds (40 + 4 Bonus)", group: "Diamonds" },
  { code: "ML45", label: "45 Diamonds (41 + 4 Bonus)", group: "Diamonds" },
  { code: "ML46", label: "46 Diamonds (42 + 4 Bonus)", group: "Diamonds" },
  { code: "ML50", label: "50 Diamonds (45 + 5 Bonus)", group: "Diamonds" },
  { code: "ML_54--2", label: "54 Diamonds (50 + 4 Bonus)", group: "Diamonds" },
  { code: "ML56", label: "56 Diamonds (51 + 5 Bonus)", group: "Diamonds" },
  { code: "ML59", label: "59 Diamonds (53 + 6 Bonus)", group: "Diamonds" },
  { code: "ML60", label: "60 Diamonds (56 + 4 Bonus)", group: "Diamonds" },
  { code: "ML64", label: "64 Diamonds (58 + 6 Bonus)", group: "Diamonds" },
  { code: "ML65", label: "65 Diamonds (59 + 6 Bonus)", group: "Diamonds" },
  { code: "ML66", label: "66 Diamonds (60 + 6 Bonus)", group: "Diamonds" },
  { code: "ML67", label: "67 Diamonds (61 + 6 Bonus)", group: "Diamonds" },
  { code: "ML70", label: "70 Diamonds (64 + 6 Bonus)", group: "Diamonds" },
  { code: "ML71", label: "71 Diamonds (64 + 7 Bonus)", group: "Diamonds" },
  { code: "ML74", label: "74 Diamonds (67 + 7 Bonus)", group: "Diamonds" },
  { code: "ML75", label: "75 Diamonds (69 + 6 Bonus)", group: "Diamonds" },
  { code: "ML70_8-S1A", label: "78 Diamonds (70 + 8 Bonus)", group: "Diamonds" },
  { code: "ML80", label: "80 Diamonds (71 + 7 Bonus)", group: "Diamonds" },
  { code: "ML85", label: "85 Diamonds (77 + 8 Bonus)", group: "Diamonds" },
  { code: "ML86", label: "86 Diamonds (78 + 8 Bonus)", group: "Diamonds" },
  { code: "ML88", label: "88 Diamonds (80 + 8 Bonus)", group: "Diamonds" },
  { code: "ML89", label: "89 Diamonds (81 + 8 Bonus)", group: "Diamonds" },
  { code: "ML92", label: "92 Diamonds (84 + 8 Bonus)", group: "Diamonds" },
  { code: "ML98", label: "98 Diamonds (90 + 8 Bonus)", group: "Diamonds" },
  { code: "ML100", label: "100 Diamonds (91 + 9 Bonus)", group: "Diamonds" },
  { code: "ML110", label: "110 Diamonds (100 + 10 Bonus)", group: "Diamonds" },
  { code: "ML112", label: "112 Diamonds (102 + 10 Bonus)", group: "Diamonds" },
  { code: "ML113", label: "113 Diamonds (102 + 11 Bonus)", group: "Diamonds" },
  { code: "ML116", label: "116 Diamonds (106 + 10 Bonus)", group: "Diamonds" },
  { code: "ML_128--2", label: "128 Diamonds (117 + 11 Bonus)", group: "Diamonds" },
  { code: "ML129", label: "129 Diamonds (118 + 11 Bonus)", group: "Diamonds" },
  { code: "ML140", label: "140 Diamonds (128 + 12 Bonus)", group: "Diamonds" },
  { code: "ML141", label: "141 Diamonds (130 + 11 Bonus)", group: "Diamonds" },
  { code: "ML_144--2", label: "144 Diamonds (133 + 11 Bonus)", group: "Diamonds" },
  { code: "ML_148--2", label: "148 Diamonds (134 + 14 Bonus)", group: "Diamonds" },
  { code: "ML150", label: "150 Diamonds (135 + 15 Bonus)", group: "Diamonds" },
  { code: "ML153", label: "153 Diamonds (139 + 14 Bonus)", group: "Diamonds" },
  { code: "ML167", label: "167 Diamonds (152 + 15 Bonus)", group: "Diamonds" },
  { code: "ML169", label: "169 Diamonds (154 + 15 Bonus)", group: "Diamonds" },
  { code: "ML170", label: "170 Diamonds (154 + 16 Bonus)", group: "Diamonds" },
  { code: "ML172", label: "172 Diamonds (156 + 16 Bonus)", group: "Diamonds" },
  { code: "ML173", label: "173 Diamonds (157 + 16 Bonus)", group: "Diamonds" },
  { code: "ML_176--2", label: "176 Diamonds (160 + 16 Bonus)", group: "Diamonds" },
  { code: "ML185", label: "185 Diamonds (170 + 15 Bonus)", group: "Diamonds" },
  { code: "ML194", label: "194 Diamonds (178 + 16 Bonus)", group: "Diamonds" },
  { code: "ML200", label: "200 Diamonds (184 + 16 Bonus)", group: "Diamonds" },
  { code: "ML210", label: "210 Diamonds (193 + 17 Bonus)", group: "Diamonds" },
  { code: "ML222", label: "222 Diamonds (200 + 22 Bonus)", group: "Diamonds" },
  { code: "ML223", label: "223 Diamonds (201 + 22 Bonus)", group: "Diamonds" },
  { code: "ML224", label: "224 Diamonds (202 + 22 Bonus)", group: "Diamonds" },
  { code: "ML225", label: "225 Diamonds (203 + 22 Bonus)", group: "Diamonds" },
  { code: "ML228", label: "228 Diamonds (206 + 22 Bonus)", group: "Diamonds" },
  { code: "ML207_22-S1A", label: "229 Diamonds (207 + 22 Bonus)", group: "Diamonds" },
  { code: "ML240", label: "240 Diamonds (217 + 23 Bonus)", group: "Diamonds" },
  { code: "ML250", label: "250 Diamonds (225 + 25 Bonus)", group: "Diamonds" },
  { code: "ML253", label: "253 Diamonds (231 + 23 Bonus)", group: "Diamonds" },
  { code: "ML257", label: "257 Diamonds (234 + 23 Bonus)", group: "Diamonds" },
  { code: "ML258", label: "258 Diamonds (233 + 25 Bonus)", group: "Diamonds" },
  { code: "ML259", label: "259 Diamonds (234 + 25 Bonus)", group: "Diamonds" },
  { code: "ML261", label: "261 Diamonds (235 + 26 Bonus)", group: "Diamonds" },
  { code: "ML276", label: "276 Diamonds (249 + 27 Bonus)", group: "Diamonds" },
  { code: "ML277", label: "277 Diamonds (250 + 27 Bonus)", group: "Diamonds" },
  { code: "ML279", label: "279 Diamonds (252 + 27 Bonus)", group: "Diamonds" },
  { code: "ML281", label: "281 Diamonds (254 + 27 Bonus)", group: "Diamonds" },
  { code: "ML284", label: "284 Diamonds (257 + 27 Bonus)", group: "Diamonds" },
  { code: "ML296", label: "296 Diamonds (256 + 40 Bonus)", group: "Diamonds" },
  { code: "ML300", label: "300 Diamonds (260 + 40 Bonus)", group: "Diamonds" },
  { code: "ML_300--9", label: "301 Diamonds (276 + 27 Bonus)", group: "Diamonds" },
  { code: "ML305", label: "305 Diamonds (276 + 29 Bonus)", group: "Diamonds" },
  { code: "ML323", label: "323 Diamonds (291 + 32 Bonus)", group: "Diamonds" },
  { code: "ML281_43-S1A", label: "324 Diamonds (281 + 43 Bonus)", group: "Diamonds" },
  { code: "ML332", label: "332 Diamonds (299 + 33 Bonus)", group: "Diamonds" },
  { code: "ML336", label: "336 Diamonds (303 + 33 Bonus)", group: "Diamonds" },
  { code: "ML340", label: "340 Diamonds (306 + 34 Bonus)", group: "Diamonds" },
  { code: "ML344", label: "344 Diamonds (310 + 34 Bonus)", group: "Diamonds" },
  { code: "ML345", label: "345 Diamonds (311 + 34 Bonus)", group: "Diamonds" },
  { code: "ML355", label: "355 Diamonds (309 + 46 Bonus)", group: "Diamonds" },
  { code: "ML369", label: "369 Diamonds (332 + 37 Bonus)", group: "Diamonds" },
  { code: "ML370", label: "370 Diamonds (333 + 37 Bonus)", group: "Diamonds" },
  { code: "ML373", label: "373 Diamonds (336 + 37 Bonus)", group: "Diamonds" },
  { code: "ML380", label: "380 Diamonds (343 + 37 Bonus)", group: "Diamonds" },
  { code: "ML381", label: "381 Diamonds (344 + 37 Bonus)", group: "Diamonds" },
  { code: "ML_384--2", label: "384 Diamonds (346 + 38 Bonus)", group: "Diamonds" },
  { code: "ML388", label: "388 Diamonds (351 + 37 Bonus)", group: "Diamonds" },
  { code: "ML406", label: "406 Diamonds (366 + 40 Bonus)", group: "Diamonds" },
  { code: "ML408", label: "408 Diamonds (367 + 41 Bonus)", group: "Diamonds" },
  { code: "ML415", label: "415 Diamonds (375 + 40 Bonus)", group: "Diamonds" },
  { code: "ML425", label: "425 Diamonds (379 + 46 Bonus)", group: "Diamonds" },
  { code: "ML429", label: "429 Diamonds (383 + 46 Bonus)", group: "Diamonds" },
  { code: "ML444", label: "444 Diamonds (398 + 46 Bonus)", group: "Diamonds" },
  { code: "ML448", label: "448 Diamonds (402 + 46 Bonus)", group: "Diamonds" },
  { code: "ML453", label: "453 Diamonds (408 + 45 Bonus)", group: "Diamonds" },
  { code: "ML460", label: "460 Diamonds (415 + 45 Bonus)", group: "Diamonds" },
  { code: "ML500", label: "500 Diamonds (454 + 46 Bonus)", group: "Diamonds" },
  { code: "ML509", label: "509 Diamonds (458 + 51 Bonus)", group: "Diamonds" },
  { code: "ML513", label: "513 Diamonds (462 + 51 Bonus)", group: "Diamonds" },
  { code: "ML514", label: "514 Diamonds (463 + 51 Bonus)", group: "Diamonds" },
  { code: "ML_518--9", label: "518 Diamonds (467 + 51 Bonus)", group: "Diamonds" },
  { code: "ML471_51-S1A", label: "522 Diamonds (471 + 51 Bonus)", group: "Diamonds" },
  { code: "ML530", label: "530 Diamonds (477 + 53 Bonus)", group: "Diamonds" },
  { code: "ML554", label: "554 Diamonds (499 + 55 Bonus)", group: "Diamonds" },
  { code: "ML568", label: "568 Diamonds (503 + 65 Bonus)", group: "Diamonds" },
  { code: "ML570", label: "570 Diamonds (505 + 65 Bonus)", group: "Diamonds" },
  { code: "ML600", label: "600 Diamonds (532 + 68 Bonus)", group: "Diamonds" },
  { code: "ML533_68-S1A", label: "601 Diamonds (533 + 68 Bonus)", group: "Diamonds" },
  { code: "ML635", label: "635 Diamonds (564 + 71 Bonus)", group: "Diamonds" },
  { code: "ML_642--2", label: "642 Diamonds (570 + 72 Bonus)", group: "Diamonds" },
  { code: "ML_649--2", label: "659 Diamonds (585 + 74 Bonus)", group: "Diamonds" },
  { code: "ML666", label: "666 Diamonds (592 + 74 Bonus)", group: "Diamonds" },
  { code: "ML702", label: "702 Diamonds (623 + 79 Bonus)", group: "Diamonds" },
  { code: "ML706", label: "706 Diamonds (627 + 79 Bonus)", group: "Diamonds" },
  { code: "ML708", label: "708 Diamonds (629 + 79 Bonus)", group: "Diamonds" },
  { code: "ML710", label: "710 Diamonds (631 + 79 Bonus)", group: "Diamonds" },
  { code: "ML715", label: "715 Diamonds (636 + 79 Bonus)", group: "Diamonds" },
  { code: "ML_716--2", label: "716 Diamonds (637 + 79 Bonus)", group: "Diamonds" },
  { code: "ML638_79-S1A", label: "717 Diamonds (638 + 79 Bonus)", group: "Diamonds" },
  { code: "ML724", label: "724 DIamonds (710 + 14 Bonus)", group: "Diamonds" },
  { code: "ML_738--2", label: "738 Diamonds (663 + 75 Bonus)", group: "Diamonds" },
  { code: "ML740", label: "740 Diamonds (659 + 81 Bonus)", group: "Diamonds" },
  { code: "ML_750--73", label: "750 Diamonds (675 + 75 Bonus)", group: "Diamonds" },
  { code: "ML760", label: "760 Diamonds (672 + 83 Bonus)", group: "Diamonds" },
  { code: "ML666_96-S1A", label: "762 Diamonds (666 + 96 Bonus)", group: "Diamonds" },
  { code: "ML_790--2", label: "790 Diamonds (703 + 87 Bonus)", group: "Diamonds" },
  { code: "ML792", label: "792 Diamonds (705 + 87 Bonus)", group: "Diamonds" },
  { code: "ML720_88-S1A", label: "808 Diamonds (720 + 88 Bonus)", group: "Diamonds" },
  { code: "ML875", label: "875 Diamonds (774 + 101 Bonus)", group: "Diamonds" },
  { code: "ML878", label: "878 Diamonds (777 + 101 Bonus)", group: "Diamonds" },
  { code: "ML882", label: "882 Diamonds (780 + 102 Bonus)", group: "Diamonds" },
  { code: "ML_938--2", label: "938 Diamonds (836 + 102 Bonus)", group: "Diamonds" },
  { code: "ML975", label: "975 Diamonds (870 + 105 Bonus)", group: "Diamonds" },
  { code: "ML978", label: "978 Diamonds (873 + 105 Bonus)", group: "Diamonds" },
  { code: "ML1000", label: "1000 Diamonds (891 + 109 Bonus)", group: "Diamonds" },
  { code: "ML1045", label: "1045 Diamonds (928 + 117 Bonus)", group: "Diamonds" },
  { code: "ML1050", label: "1050 Diamonds (935 + 115 Bonus)", group: "Diamonds" },
  { code: "ML1134", label: "1134 Diamonds (1004 + 130 Bonus)", group: "Diamonds" },
  { code: "ML1136", label: "1136 Diamonds (1006 + 130 Bonus)", group: "Diamonds" },
  { code: "ML1159", label: "1159 Diamonds (1028 + 131 Bonus)", group: "Diamonds" },
  { code: "ML1165", label: "1165 Diamonds (1033 + 132 Bonus)", group: "Diamonds" },
  { code: "ML1188", label: "1188 Diamonds (1055 + 133 Bonus)", group: "Diamonds" },
  { code: "ML1200", label: "1200 Diamonds (1066 + 134 Bonus)", group: "Diamonds" },
  { code: "ML1220", label: "1220 Diamonds (1093 + 127 Bonus)", group: "Diamonds" },
  { code: "ML1083_147-S1A", label: "1230 Diamonds (1083 + 147 Bonus)", group: "Diamonds" },
  { code: "ML1647", label: "1647 Diamonds (1463 + 184 Bonus)", group: "Diamonds" },
  { code: "ML1669", label: "1669 Diamonds (1483 + 186 Bonus)", group: "Diamonds" },
  { code: "ML_1704--2", label: "1704 Diamonds (1509 + 195 Bonus)", group: "Diamonds" },
  { code: "ML1750", label: "1750 Diamonds (1555 + 195 Bonus)", group: "Diamonds" },
  { code: "ML1756", label: "1756 Diamonds (1561 + 195 Bonus)", group: "Diamonds" },
  { code: "ML1780", label: "1780 Diamonds (1582 + 198 Bonus)", group: "Diamonds" },
  { code: "ML1801", label: "1801 Diamonds (1601 + 200 Bonus)", group: "Diamonds" },
  { code: "ML1830", label: "1830 Diamonds (1627 + 203 Bonus)", group: "Diamonds" },
  { code: "ML1841", label: "1841 Diamonds (1637 + 204 Bonus)", group: "Diamonds" },
  { code: "ML1887", label: "1887 Diamonds (1679 + 208 Bonus)", group: "Diamonds" },
  { code: "ML2010", label: "2010 Diamonds (1708 + 302 Bonus)", group: "Diamonds" },
  { code: "ML2012", label: "2012 Diamonds (1710 + 302 Bonus)", group: "Diamonds" },
  { code: "ML2016", label: "2016 Diamonds (1714 + 302 Bonus)", group: "Diamonds" },
  { code: "ML1741_305-S1A", label: "2046 Diamonds (1741 + 305 Bonus)", group: "Diamonds" },
  { code: "ML2166", label: "2166 Diamonds (1860 + 306 Bonus)", group: "Diamonds" },
  { code: "ML_2195--2", label: "2195 Diamonds (1860 + 335 Bonus)", group: "Diamonds" },
  { code: "ML2196", label: "2196 Diamonds (1887 + 309 Bonus)", group: "Diamonds" },
  { code: "ML1879_320-S1A", label: "2199 Diamonds (1879 + 320 Bonus)", group: "Diamonds" },
  { code: "1621", label: "2232 Diamonds (1908 + 324 Bonus)", group: "Diamonds" },
  { code: "ML2350", label: "2350 Diamonds (2035 + 315 Bonus)", group: "Diamonds" },
  { code: "ML_2380--2", label: "2380 Diamonds (2041 + 339 Bonus)", group: "Diamonds" },
  { code: "ML2398", label: "2398 Diamonds (2079 + 319 Bonus)", group: "Diamonds" },
  { code: "ML2500", label: "2500 Diamonds (2150 + 350 Bonus)", group: "Diamonds" },
  { code: "ML2515", label: "2515 Diamonds (2165 + 350 Bonus)", group: "Diamonds" },
  { code: "ML2539", label: "2539 Diamonds (2189 + 350 Bonus)", group: "Diamonds" },
  { code: "ML_2578--2", label: "2578 Diamonds (2211 + 367 Bonus)", group: "Diamonds" },
  { code: "ML2602", label: "2602 Diamonds (2242 + 360 Bonus)", group: "Diamonds" },
  { code: "ML_2625--9", label: "2625 Diamonds (2253 + 372 Bonus)", group: "Diamonds" },
  { code: "ML2767", label: "2767 Diamonds (2397 + 370 Bonus)", group: "Diamonds" },
  { code: "ML_2855--2", label: "2855 Diamonds (2461 + 394 Bonus)", group: "Diamonds" },
  { code: "ML_2901--2", label: "2901 Diamonds (2485 + 416 Bonus)", group: "Diamonds" },
  { code: "ML2499_405-S1A", label: "2904 Diamonds (2499 + 405 Bonus)", group: "Diamonds" },
  { code: "ML_2976--2", label: "2976 Diamonds (2556 + 420 Bonus)", group: "Diamonds" },
  { code: "ML2565_412-S1A", label: "2977 Diamonds (2565 + 412 Bonus)", group: "Diamonds" },
  { code: "ML3024", label: "3024 Diamonds (2624 + 400 Bonus)", group: "Diamonds" },
  { code: "ML3198", label: "3198 Diamonds (2788 + 410 Bonus)", group: "Diamonds" },
  { code: "ML3423", label: "3423 Diamonds (2983 + 440 Bonus)", group: "Diamonds" },
  { code: "ML3436", label: "3436 Diamonds (2996 + 440 Bonus)", group: "Diamonds" },
  { code: "ML2985_468-S1A", label: "3453 Diamonds (2985 + 468 Bonus)", group: "Diamonds" },
  { code: "ML3010_471-S1A", label: "3481 Diamonds (3010 + 471 Bonus)", group: "Diamonds" },
  { code: "ML3543", label: "3543 Diamonds (3093 + 450 Bonus)", group: "Diamonds" },
  { code: "ML3568", label: "3568 Diamonds (3118 + 450 Bonus)", group: "Diamonds" },
  { code: "ML3638", label: "3638 Diamonds (3178 + 460 Bonus)", group: "Diamonds" },
  { code: "ML3673", label: "3673 Diamonds (3213 + 460 Bonus)", group: "Diamonds" },
  { code: "ML_3688--2", label: "3688 Diamonds (3099 + 589 Bonus)", group: "Diamonds" },
  { code: "ML_3738--2", label: "3738 Diamonds (3247 + 491 Bonus)", group: "Diamonds" },
  { code: "ML_3760--2", label: "3760 Diamonds (3261 + 499 Bonus)", group: "Diamonds" },
  { code: "ML_4020--2", label: "4020 Diamonds (3416 + 604 Bonus)", group: "Diamonds" },
  { code: "ML3426_604-S1A", label: "4030 Diamonds (3426 + 604 Bonus)", group: "Diamonds" },
  { code: "ML_4394--2", label: "4394 Diamonds (3724 + 670 Bonus)", group: "Diamonds" },
  { code: "ML4396", label: "4396 Diamonds (3866 + 530 Bonus)", group: "Diamonds" },
  { code: "ML3763_641-S1A", label: "4404 Diamonds (3763 + 641 Bonus)", group: "Diamonds" },
  { code: "ML4588", label: "4588 Diamonds (3919 + 669 Bonus)", group: "Diamonds" },
  { code: "ML4001_677-S1A", label: "4678 Diamonds (4001 + 677 Bonus)", group: "Diamonds" },
  { code: "ML_4830--2", label: "4830 Diamonds (4003 + 827 Bonus)", group: "Diamonds" },
  { code: "ML4826_546-S1A", label: "5372 Diamonds (4826 + 546 Bonus)", group: "Diamonds" },
  { code: "ML4506_892-S1A", label: "5398 Diamonds (4506 + 892 Bonus)", group: "Diamonds" },
  { code: "ML_5532--2", label: "5532 Diamonds (4649 + 883 Bonus)", group: "Diamonds" },
  { code: "ML4660_908-S1A", label: "5568 Diamonds (4660 + 908 Bonus)", group: "Diamonds" },
  { code: "ML_6030--2", label: "6030 Diamonds (5124 + 906 Bonus)", group: "Diamonds" },
  { code: "ML6042", label: "6042 Diamonds (5342 + 700 Bonus)", group: "Diamonds" },
  { code: "ML6050", label: "6050 Diamonds (5350 + 700 Bonus)", group: "Diamonds" },
  { code: "ML_6234--2", label: "6234 Diamonds (5256 + 978 Bonus)", group: "Diamonds" },
  { code: "ML_6238--9", label: "6238 Diamonds (5260 + 978 Bonus)", group: "Diamonds" },
  { code: "ML5274_983-S1A", label: "6257 Diamonds (5274 + 983 Bonus)", group: "Diamonds" },
  { code: "ML_6840--2", label: "6840 Diamonds (6056 + 784 Bonus)", group: "Diamonds" },
  { code: "ML6020_1175-S1A", label: "7195 Diamonds (6020 + 1175 Bonus)", group: "Diamonds" },
  { code: "ML_7502--2", label: "7502 Diamonds (6317 + 1185 Bonus)", group: "Diamonds" },
  { code: "ML_7727--2", label: "7727 Diamonds (6509 + 1218 Bonus)", group: "Diamonds" },
  { code: "ML_8040--2", label: "8040 Diamonds (6832 + 1208 Bonus)", group: "Diamonds" },
  { code: "ML7005_1297-S1A", label: "8302 Diamonds (7005 + 1297 Bonus)", group: "Diamonds" },
  { code: "ML8850", label: "8850 Diamonds (7870 + 980 Bonus)", group: "Diamonds" },
  { code: "ML_9288--2", label: "9288 Diamonds (7740 + 1548 Bonus)", group: "Diamonds" },
  { code: "ML7826_1476-S1A", label: "9302 Diamonds (7826 + 1476 Bonus)", group: "Diamonds" },
  { code: "ML_9660--2", label: "9660 Diamonds (8148 + 1512 Bonus)", group: "Diamonds" },
  { code: "ML_10050--2", label: "10050 Diamonds (8540 + 1510 Bonus)", group: "Diamonds" },
  { code: "ML9714_1956-S1A", label: "11670 Diamonds (9714 + 1956 Bonus)", group: "Diamonds" },
  { code: "ML10248_1812-S1A", label: "12060 Diamonds (10248 + 1812 Bonus)", group: "Diamonds" },
  { code: "ML_12976--2", label: "12976 Diamonds (10839 + 2137 Bonus)", group: "Diamonds" },
  { code: "ML11422_2258-S1A", label: "13680 Diamonds (11422 + 2258 Bonus)", group: "Diamonds" },
  { code: "ML12009_2481-S1A", label: "14490 Diamonds (12009 + 2481 Bonus)", group: "Diamonds" },
  { code: "ML_14820--2", label: "14820 Diamonds (12389 + 2431 Bonus)", group: "Diamonds" },
  { code: "ML_16080--2", label: "16080 Diamonds (13664 + 2416 Bonus)", group: "Diamonds" },
  { code: "ML13717_2783-S1A", label: "16500 Diamonds (13717 + 2783 Bonus)", group: "Diamonds" },
  { code: "2857", label: "18090 Diamonds (15372 + 2718 Bonus)", group: "Diamonds" },
  { code: "ML15425_3085-S1A", label: "18510 Diamonds (15425 + 3085 Bonus)", group: "Diamonds" },
  { code: "ML16012_3308-S1A", label: "19320 Diamonds (16012 + 3308 Bonus)", group: "Diamonds" },
  { code: "ML_20100--2", label: "20100 Diamonds (17080 + 3020 Bonus)", group: "Diamonds" },
  { code: "ML16786_3409-S1A", label: "20195 Diamonds (16786 + 3409 Bonus)", group: "Diamonds" },
  { code: "ML17720_3610-S1A", label: "21330 Diamonds (17720 + 3610 Bonus)", group: "Diamonds" },
  { code: "ML20015_4135-S1A", label: "24150 Diamonds (20015 + 4135 Bonus)", group: "Diamonds" },
  { code: "ML_27864--2", label: "27864 Diamonds (23220 + 4644 Bonus)", group: "Diamonds" },
  { code: "ML24018_4962-S1A", label: "28980 Diamonds (24018 + 4962 Bonus)", group: "Diamonds" },
  { code: "MLWEB-S50A", label: "Weekly Elite Bundle", group: "Elite Bundles" },
  { code: "MLMEB-S50A", label: "Monthly Epic Bundle", group: "Elite Bundles" },
  { code: "ML_MEB--2", label: "Monthly Elite Bundle", group: "Elite Bundles" },
  { code: "ML50_50FR-S50AUTO", label: "100 Diamonds [50 + 50]", group: "First Time Bonus" },
  { code: "ML150_150FR-S50AUTO", label: "300 Diamonds [150 + 150]", group: "First Time Bonus" },
  { code: "ML250_250FR-S50AUTO", label: "500 Diamonds [250 + 250]", group: "First Time Bonus" },
  { code: "ML500_500FR-S50AUTO", label: "1000 Diamonds [500 + 500]", group: "First Time Bonus" },
  { code: "ML_WDP--2", label: "Weekly Diamond Pass (Event Topup + 100)", group: "Weekly Diamond Pass" },
  { code: "MLWEEKLYDIAMONDPASS-S1A", label: "Weekly Diamond Pass", group: "Weekly Diamond Pass" },
  { code: "MLWEEKLYDIAMONDPASS2-S1A", label: "Weekly Diamond Pass x2", group: "Weekly Diamond Pass" },
  { code: "WDP2", label: "Weekly Diamond Pass (Event Topup + 100) x2", group: "Weekly Diamond Pass" },
  { code: "MLWEEKLYDIAMONDPASS3-S1A", label: "Weekly Diamond Pass x3", group: "Weekly Diamond Pass" },
  { code: "WDP3", label: "Weekly Diamond Pass (Event Topup + 100) x3", group: "Weekly Diamond Pass" },
  { code: "MLWEEKLYDIAMONDPASS4-S1A", label: "Weekly Diamond Pass x4", group: "Weekly Diamond Pass" },
  { code: "WDP4", label: "Weekly Diamond Pass (Event Topup + 100) x4", group: "Weekly Diamond Pass" },
  { code: "MLWEEKLYDIAMONDPASS5-S1A", label: "Weekly Diamond Pass x5", group: "Weekly Diamond Pass" },
  { code: "WDP5", label: "Weekly Diamond Pass (Event Topup + 100) x5", group: "Weekly Diamond Pass" },
  { code: "MLTL-S1A", label: "Twilight Pass", group: "Twilight Pass" },
]

const PAKET_ENUM = [...new Set(PACKAGES.map(p => p.label))]

function randomName(ext = ".png") {
  return crypto.randomBytes(16).toString("hex") + ext
}

function scheduleDelete(filePath, delayMs = 300000) {
  setTimeout(() => {
    fs.unlink(filePath, err => {
      if (err) logger.warn(`[CLEANUP] Gagal hapus ${filePath}: ${err.message}`)
    })
  }, delayMs)
}

export default {
  name: "MOBILE LEGENDS TOP UP",
  description: "Top-up Mobile Legends diamonds & bundles via QRIS",
  category: "Topup",
  methods: ["GET", "POST"],

  params: ["user_id", "zone_id", "paket"],

  paramsSchema: {
    user_id: {
      type: "string",
      required: true,
      description: "Mobile Legends User ID (5-15 digit angka)",
      example: "1234567890",
      minLength: 5,
      maxLength: 15,
    },
    zone_id: {
      type: "string",
      required: true,
      description: "Zone ID (3-6 digit angka)",
      example: "1234",
      minLength: 3,
      maxLength: 6,
    },
    paket: {
      type: "string",
      required: true,
      enum: PAKET_ENUM,
      default: "20 Diamonds (18 + 2 Bonus)",
      description: `Nama paket Mobile Legends.\n\n--- DIAMONDS ---\n${PACKAGES.filter(p => p.group === "Diamonds").map(p => p.label).join("\n")}\n\n--- ELITE BUNDLES ---\n${PACKAGES.filter(p => p.group === "Elite Bundles").map(p => p.label).join("\n")}\n\n--- WEEKLY DIAMOND PASS ---\n${PACKAGES.filter(p => p.group === "Weekly Diamond Pass").map(p => p.label).join("\n")}\n\n--- TWILIGHT PASS ---\n${PACKAGES.filter(p => p.group === "Twilight Pass").map(p => p.label).join("\n")}\n\n--- FIRST TIME BONUS ---\n${PACKAGES.filter(p => p.group === "First Time Bonus").map(p => p.label).join("\n")}`,
      example: "20 Diamonds (18 + 2 Bonus)",
    },
  },

  async run(req, res) {
    try {
      const { user_id, zone_id, paket } = { ...req.query, ...req.body }

      if (!user_id) {
        return res.status(400).json({ status: false, message: "Parameter 'user_id' wajib diisi" })
      }

      const cleanedId = user_id.replace(/[^0-9]/g, "")
      if (!cleanedId || cleanedId.length < 5 || cleanedId.length > 15) {
        return res.status(400).json({ status: false, message: "User ID tidak valid — 5-15 digit angka" })
      }

      if (!zone_id) {
        return res.status(400).json({ status: false, message: "Parameter 'zone_id' wajib diisi" })
      }

      const cleanedZone = zone_id.replace(/[^0-9]/g, "")
      if (!cleanedZone || cleanedZone.length < 3 || cleanedZone.length > 6) {
        return res.status(400).json({ status: false, message: "Zone ID tidak valid — 3-6 digit angka" })
      }

      if (!paket) {
        return res.status(400).json({ status: false, message: "Parameter 'paket' wajib diisi" })
      }

      const pkg = PACKAGES.find(p => p.label.toLowerCase() === paket.toLowerCase())
      if (!pkg) {
        return res.status(400).json({
          status: false,
          message: `Paket '${paket}' tidak tersedia`,
        })
      }

      const headers = makeHeaders()

      const body = {
        contact: {
          emailAddress: "",
          phoneNumber: "+6283140961614",
        },
        paymentMethod: "QRIS_ID_BNC",
        productId: PRODUCT_ID,
        productPackageCode: pkg.code,
        questionnaireAnswers: [
          {
            questionnaire: {
              code: "userid",
              inputType: "STRING",
              regexValidation: {
                regex: "^[0-9]{5,15}$",
                errorMessages: [
                  { language: "ID", title: "Format ID Salah", body: "ID hanya boleh mengandung angka. Silakan periksa kembali dan coba lagi 😊" },
                  { language: "EN", title: "Invalid ID Format", body: "ID must contain numbers only. Please check and try again 😊" },
                ],
              },
              translations: [
                { language: "ID", question: "Masukkan User ID", description: "User ID", choices: [] },
              ],
            },
            answer: cleanedId,
          },
          {
            questionnaire: {
              code: "zoneid",
              inputType: "STRING",
              regexValidation: {
                regex: "^[0-9]{3,6}$",
                errorMessages: [
                  { language: "ID", title: "Format Zone Salah", body: "Zone hanya boleh mengandung angka. Silakan periksa kembali dan coba lagi 😊" },
                  { language: "EN", title: "Invalid ID Format", body: "Zone must contain numbers only. Please check and try again 😊" },
                ],
              },
              translations: [
                { language: "ID", question: "(Zone ID)", description: "Zone ID", choices: [] },
              ],
            },
            answer: cleanedZone,
          },
        ],
      }

      logger.info(`[TOPUP-ML] Creating order | user_id=${cleanedId} | zone=${cleanedZone} | package=${pkg.code} | label=${pkg.label}`)

      const createRes = await fetch(`${TOKOGAKE_BASE}/orders/create-order`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })

      const createData = await createRes.json()

      if (!createRes.ok || createData.code !== "SUCCESS") {
        logger.error(`[TOPUP-ML] Tokogame error | status=${createRes.status} | body=${JSON.stringify(createData)}`)
        return res.status(502).json({
          status: false,
          message: createData.message || "Gagal membuat order",
          detail: createData,
        })
      }

      const { id: orderId, code: orderCode, totalPriceInCents, checkoutUrl } = createData.data
      const harga = totalPriceInCents / 100

      let qrImageUrl = null
      const qrisContent = checkoutUrl?.qr || null
      const qrisImageUrl = checkoutUrl?.qrUrl || null

      if (qrisContent) {
        try {
          const filename = randomName(".png")
          const filePath = path.join(uploadDir, filename)
          await QRCode.toFile(filePath, qrisContent, { scale: 8, margin: 1 })
          scheduleDelete(filePath)
          trackQR(orderId, orderCode, "ml", filePath, `${req.protocol}://${req.get("host")}/files/${filename}`)
          qrImageUrl = `${req.protocol}://${req.get("host")}/files/${filename}`
        } catch (qrErr) {
          logger.warn(`[TOPUP-ML] QR generation failed | ${qrErr.message}`)
        }
      }

      logger.info(`[TOPUP-ML] Order created | id=${orderId} | code=${orderCode} | harga=${harga}`)

      return res.json({
        status: true,
        result: {
          orderId,
          orderCode,
          user_id: cleanedId,
          zone_id: cleanedZone,
          paket: pkg.label,
          group: pkg.group,
          harga,
          qr_url: qrImageUrl,
          qris_content: qrisContent,
        },
        timestamp: Date.now(),
      })
    } catch (err) {
      logger.error(`[TOPUP-ML] Error | ip=${req.ip} | error=${err.message}`)
      return res.status(500).json({ status: false, message: err.message || "Gagal membuat order" })
    }
  },
}
