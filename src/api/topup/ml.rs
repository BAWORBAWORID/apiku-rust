// MOBILE LEGENDS TOP UP — native conversion of api/topup/ml.js
// Order creation is fully native via Tokogame. Node also rendered the QR PNG
// via the qrcode package; the native build has no QR image engine, so qr_url
// uses the upstream checkoutUrl.qrUrl when available and reports qr_url=null
// otherwise (qris_content is always included).
use axum::{
    extract::{Query},
    response::{IntoResponse, Response},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use super::tokogame;

fn merged(query: &HashMap<String, String>, body: &Option<Json<Value>>) -> Value {
    let mut m = json!({});
    if let Some(Json(b)) = body {
        if let Some(o) = b.as_object() { for (k, v) in o { m[k] = v.clone(); } }
    }
    for (k, v) in query { m[k] = json!(v); }
    m
}

fn str_param(m: &Value, key: &str) -> Option<String> {
    match m.get(key) {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

const PRODUCT_ID: &str = "60f39f1e70a6874c6a151e4e";

const PACKAGES: &[(&str, &str, &str)] = &[
    ("1818", "3 Diamonds (3 + 0 Bonus)", "Diamonds"),
    ("ML_5--2", "5 Diamonds (5 + 0 Bonus)", "Diamonds"),
    ("ML_10--2", "10 Diamonds (9 + 1 Bonus)", "Diamonds"),
    ("ML11", "11 Diamonds (10 + 1 Bonus)", "Diamonds"),
    ("ML12", "12 Diamonds (11 + 1 Bonus)", "Diamonds"),
    ("ML14", "14 Diamonds (13 + 1 Bonus)", "Diamonds"),
    ("ML15", "15 Diamonds (14 + 1 Bonus)", "Diamonds"),
    ("ML15_2-S121", "17 Diamonds (15 + 2 Bonus)", "Diamonds"),
    ("ML18", "18 Diamonds (17 + 1 Bonus)", "Diamonds"),
    ("ML19", "19 Diamonds (17 + 2 Bonus)", "Diamonds"),
    ("ML20", "20 Diamonds (18 + 2 Bonus)", "Diamonds"),
    ("ML22", "22 Diamonds (21 + 1 Bonus)", "Diamonds"),
    ("ML28", "28 Diamonds (25 + 3 Bonus)", "Diamonds"),
    ("ML_30--2", "30 Diamonds (28 + 2 Bonus)", "Diamonds"),
    ("ML30_3-S121", "33 Diamonds (30 + 3 Bonus)", "Diamonds"),
    ("ML34", "34 Diamonds (31 + 3 Bonus)", "Diamonds"),
    ("ML36", "36 Diamonds (33 + 3 Bonus)", "Diamonds"),
    ("ML44", "44 Diamonds (40 + 4 Bonus)", "Diamonds"),
    ("ML45", "45 Diamonds (41 + 4 Bonus)", "Diamonds"),
    ("ML46", "46 Diamonds (42 + 4 Bonus)", "Diamonds"),
    ("ML50", "50 Diamonds (45 + 5 Bonus)", "Diamonds"),
    ("ML_54--2", "54 Diamonds (50 + 4 Bonus)", "Diamonds"),
    ("ML56", "56 Diamonds (51 + 5 Bonus)", "Diamonds"),
    ("ML59", "59 Diamonds (53 + 6 Bonus)", "Diamonds"),
    ("ML60", "60 Diamonds (56 + 4 Bonus)", "Diamonds"),
    ("ML64", "64 Diamonds (58 + 6 Bonus)", "Diamonds"),
    ("ML65", "65 Diamonds (59 + 6 Bonus)", "Diamonds"),
    ("ML66", "66 Diamonds (60 + 6 Bonus)", "Diamonds"),
    ("ML67", "67 Diamonds (61 + 6 Bonus)", "Diamonds"),
    ("ML70", "70 Diamonds (64 + 6 Bonus)", "Diamonds"),
    ("ML71", "71 Diamonds (64 + 7 Bonus)", "Diamonds"),
    ("ML74", "74 Diamonds (67 + 7 Bonus)", "Diamonds"),
    ("ML75", "75 Diamonds (69 + 6 Bonus)", "Diamonds"),
    ("ML70_8-S1A", "78 Diamonds (70 + 8 Bonus)", "Diamonds"),
    ("ML80", "80 Diamonds (71 + 7 Bonus)", "Diamonds"),
    ("ML85", "85 Diamonds (77 + 8 Bonus)", "Diamonds"),
    ("ML86", "86 Diamonds (78 + 8 Bonus)", "Diamonds"),
    ("ML88", "88 Diamonds (80 + 8 Bonus)", "Diamonds"),
    ("ML89", "89 Diamonds (81 + 8 Bonus)", "Diamonds"),
    ("ML92", "92 Diamonds (84 + 8 Bonus)", "Diamonds"),
    ("ML98", "98 Diamonds (90 + 8 Bonus)", "Diamonds"),
    ("ML100", "100 Diamonds (91 + 9 Bonus)", "Diamonds"),
    ("ML110", "110 Diamonds (100 + 10 Bonus)", "Diamonds"),
    ("ML112", "112 Diamonds (102 + 10 Bonus)", "Diamonds"),
    ("ML113", "113 Diamonds (102 + 11 Bonus)", "Diamonds"),
    ("ML116", "116 Diamonds (106 + 10 Bonus)", "Diamonds"),
    ("ML_128--2", "128 Diamonds (117 + 11 Bonus)", "Diamonds"),
    ("ML129", "129 Diamonds (118 + 11 Bonus)", "Diamonds"),
    ("ML140", "140 Diamonds (128 + 12 Bonus)", "Diamonds"),
    ("ML141", "141 Diamonds (130 + 11 Bonus)", "Diamonds"),
    ("ML_144--2", "144 Diamonds (133 + 11 Bonus)", "Diamonds"),
    ("ML_148--2", "148 Diamonds (134 + 14 Bonus)", "Diamonds"),
    ("ML150", "150 Diamonds (135 + 15 Bonus)", "Diamonds"),
    ("ML153", "153 Diamonds (139 + 14 Bonus)", "Diamonds"),
    ("ML167", "167 Diamonds (152 + 15 Bonus)", "Diamonds"),
    ("ML169", "169 Diamonds (154 + 15 Bonus)", "Diamonds"),
    ("ML170", "170 Diamonds (154 + 16 Bonus)", "Diamonds"),
    ("ML172", "172 Diamonds (156 + 16 Bonus)", "Diamonds"),
    ("ML173", "173 Diamonds (157 + 16 Bonus)", "Diamonds"),
    ("ML_176--2", "176 Diamonds (160 + 16 Bonus)", "Diamonds"),
    ("ML185", "185 Diamonds (170 + 15 Bonus)", "Diamonds"),
    ("ML194", "194 Diamonds (178 + 16 Bonus)", "Diamonds"),
    ("ML200", "200 Diamonds (184 + 16 Bonus)", "Diamonds"),
    ("ML210", "210 Diamonds (193 + 17 Bonus)", "Diamonds"),
    ("ML222", "222 Diamonds (200 + 22 Bonus)", "Diamonds"),
    ("ML223", "223 Diamonds (201 + 22 Bonus)", "Diamonds"),
    ("ML224", "224 Diamonds (202 + 22 Bonus)", "Diamonds"),
    ("ML225", "225 Diamonds (203 + 22 Bonus)", "Diamonds"),
    ("ML228", "228 Diamonds (206 + 22 Bonus)", "Diamonds"),
    ("ML207_22-S1A", "229 Diamonds (207 + 22 Bonus)", "Diamonds"),
    ("ML240", "240 Diamonds (217 + 23 Bonus)", "Diamonds"),
    ("ML250", "250 Diamonds (225 + 25 Bonus)", "Diamonds"),
    ("ML253", "253 Diamonds (231 + 23 Bonus)", "Diamonds"),
    ("ML257", "257 Diamonds (234 + 23 Bonus)", "Diamonds"),
    ("ML258", "258 Diamonds (233 + 25 Bonus)", "Diamonds"),
    ("ML259", "259 Diamonds (234 + 25 Bonus)", "Diamonds"),
    ("ML261", "261 Diamonds (235 + 26 Bonus)", "Diamonds"),
    ("ML276", "276 Diamonds (249 + 27 Bonus)", "Diamonds"),
    ("ML277", "277 Diamonds (250 + 27 Bonus)", "Diamonds"),
    ("ML279", "279 Diamonds (252 + 27 Bonus)", "Diamonds"),
    ("ML281", "281 Diamonds (254 + 27 Bonus)", "Diamonds"),
    ("ML284", "284 Diamonds (257 + 27 Bonus)", "Diamonds"),
    ("ML296", "296 Diamonds (256 + 40 Bonus)", "Diamonds"),
    ("ML300", "300 Diamonds (260 + 40 Bonus)", "Diamonds"),
    ("ML_300--9", "301 Diamonds (276 + 27 Bonus)", "Diamonds"),
    ("ML305", "305 Diamonds (276 + 29 Bonus)", "Diamonds"),
    ("ML323", "323 Diamonds (291 + 32 Bonus)", "Diamonds"),
    ("ML281_43-S1A", "324 Diamonds (281 + 43 Bonus)", "Diamonds"),
    ("ML332", "332 Diamonds (299 + 33 Bonus)", "Diamonds"),
    ("ML336", "336 Diamonds (303 + 33 Bonus)", "Diamonds"),
    ("ML340", "340 Diamonds (306 + 34 Bonus)", "Diamonds"),
    ("ML344", "344 Diamonds (310 + 34 Bonus)", "Diamonds"),
    ("ML345", "345 Diamonds (311 + 34 Bonus)", "Diamonds"),
    ("ML355", "355 Diamonds (309 + 46 Bonus)", "Diamonds"),
    ("ML369", "369 Diamonds (332 + 37 Bonus)", "Diamonds"),
    ("ML370", "370 Diamonds (333 + 37 Bonus)", "Diamonds"),
    ("ML373", "373 Diamonds (336 + 37 Bonus)", "Diamonds"),
    ("ML380", "380 Diamonds (343 + 37 Bonus)", "Diamonds"),
    ("ML381", "381 Diamonds (344 + 37 Bonus)", "Diamonds"),
    ("ML_384--2", "384 Diamonds (346 + 38 Bonus)", "Diamonds"),
    ("ML388", "388 Diamonds (351 + 37 Bonus)", "Diamonds"),
    ("ML406", "406 Diamonds (366 + 40 Bonus)", "Diamonds"),
    ("ML408", "408 Diamonds (367 + 41 Bonus)", "Diamonds"),
    ("ML415", "415 Diamonds (375 + 40 Bonus)", "Diamonds"),
    ("ML425", "425 Diamonds (379 + 46 Bonus)", "Diamonds"),
    ("ML429", "429 Diamonds (383 + 46 Bonus)", "Diamonds"),
    ("ML444", "444 Diamonds (398 + 46 Bonus)", "Diamonds"),
    ("ML448", "448 Diamonds (402 + 46 Bonus)", "Diamonds"),
    ("ML453", "453 Diamonds (408 + 45 Bonus)", "Diamonds"),
    ("ML460", "460 Diamonds (415 + 45 Bonus)", "Diamonds"),
    ("ML500", "500 Diamonds (454 + 46 Bonus)", "Diamonds"),
    ("ML509", "509 Diamonds (458 + 51 Bonus)", "Diamonds"),
    ("ML513", "513 Diamonds (462 + 51 Bonus)", "Diamonds"),
    ("ML514", "514 Diamonds (463 + 51 Bonus)", "Diamonds"),
    ("ML_518--9", "518 Diamonds (467 + 51 Bonus)", "Diamonds"),
    ("ML471_51-S1A", "522 Diamonds (471 + 51 Bonus)", "Diamonds"),
    ("ML530", "530 Diamonds (477 + 53 Bonus)", "Diamonds"),
    ("ML554", "554 Diamonds (499 + 55 Bonus)", "Diamonds"),
    ("ML568", "568 Diamonds (503 + 65 Bonus)", "Diamonds"),
    ("ML570", "570 Diamonds (505 + 65 Bonus)", "Diamonds"),
    ("ML600", "600 Diamonds (532 + 68 Bonus)", "Diamonds"),
    ("ML533_68-S1A", "601 Diamonds (533 + 68 Bonus)", "Diamonds"),
    ("ML635", "635 Diamonds (564 + 71 Bonus)", "Diamonds"),
    ("ML_642--2", "642 Diamonds (570 + 72 Bonus)", "Diamonds"),
    ("ML_649--2", "659 Diamonds (585 + 74 Bonus)", "Diamonds"),
    ("ML666", "666 Diamonds (592 + 74 Bonus)", "Diamonds"),
    ("ML702", "702 Diamonds (623 + 79 Bonus)", "Diamonds"),
    ("ML706", "706 Diamonds (627 + 79 Bonus)", "Diamonds"),
    ("ML708", "708 Diamonds (629 + 79 Bonus)", "Diamonds"),
    ("ML710", "710 Diamonds (631 + 79 Bonus)", "Diamonds"),
    ("ML715", "715 Diamonds (636 + 79 Bonus)", "Diamonds"),
    ("ML_716--2", "716 Diamonds (637 + 79 Bonus)", "Diamonds"),
    ("ML638_79-S1A", "717 Diamonds (638 + 79 Bonus)", "Diamonds"),
    ("ML724", "724 DIamonds (710 + 14 Bonus)", "Diamonds"),
    ("ML_738--2", "738 Diamonds (663 + 75 Bonus)", "Diamonds"),
    ("ML740", "740 Diamonds (659 + 81 Bonus)", "Diamonds"),
    ("ML_750--73", "750 Diamonds (675 + 75 Bonus)", "Diamonds"),
    ("ML760", "760 Diamonds (672 + 83 Bonus)", "Diamonds"),
    ("ML666_96-S1A", "762 Diamonds (666 + 96 Bonus)", "Diamonds"),
    ("ML_790--2", "790 Diamonds (703 + 87 Bonus)", "Diamonds"),
    ("ML792", "792 Diamonds (705 + 87 Bonus)", "Diamonds"),
    ("ML720_88-S1A", "808 Diamonds (720 + 88 Bonus)", "Diamonds"),
    ("ML875", "875 Diamonds (774 + 101 Bonus)", "Diamonds"),
    ("ML878", "878 Diamonds (777 + 101 Bonus)", "Diamonds"),
    ("ML882", "882 Diamonds (780 + 102 Bonus)", "Diamonds"),
    ("ML_938--2", "938 Diamonds (836 + 102 Bonus)", "Diamonds"),
    ("ML975", "975 Diamonds (870 + 105 Bonus)", "Diamonds"),
    ("ML978", "978 Diamonds (873 + 105 Bonus)", "Diamonds"),
    ("ML1000", "1000 Diamonds (891 + 109 Bonus)", "Diamonds"),
    ("ML1045", "1045 Diamonds (928 + 117 Bonus)", "Diamonds"),
    ("ML1050", "1050 Diamonds (935 + 115 Bonus)", "Diamonds"),
    ("ML1134", "1134 Diamonds (1004 + 130 Bonus)", "Diamonds"),
    ("ML1136", "1136 Diamonds (1006 + 130 Bonus)", "Diamonds"),
    ("ML1159", "1159 Diamonds (1028 + 131 Bonus)", "Diamonds"),
    ("ML1165", "1165 Diamonds (1033 + 132 Bonus)", "Diamonds"),
    ("ML1188", "1188 Diamonds (1055 + 133 Bonus)", "Diamonds"),
    ("ML1200", "1200 Diamonds (1066 + 134 Bonus)", "Diamonds"),
    ("ML1220", "1220 Diamonds (1093 + 127 Bonus)", "Diamonds"),
    ("ML1083_147-S1A", "1230 Diamonds (1083 + 147 Bonus)", "Diamonds"),
    ("ML1647", "1647 Diamonds (1463 + 184 Bonus)", "Diamonds"),
    ("ML1669", "1669 Diamonds (1483 + 186 Bonus)", "Diamonds"),
    ("ML_1704--2", "1704 Diamonds (1509 + 195 Bonus)", "Diamonds"),
    ("ML1750", "1750 Diamonds (1555 + 195 Bonus)", "Diamonds"),
    ("ML1756", "1756 Diamonds (1561 + 195 Bonus)", "Diamonds"),
    ("ML1780", "1780 Diamonds (1582 + 198 Bonus)", "Diamonds"),
    ("ML1801", "1801 Diamonds (1601 + 200 Bonus)", "Diamonds"),
    ("ML1830", "1830 Diamonds (1627 + 203 Bonus)", "Diamonds"),
    ("ML1841", "1841 Diamonds (1637 + 204 Bonus)", "Diamonds"),
    ("ML1887", "1887 Diamonds (1679 + 208 Bonus)", "Diamonds"),
    ("ML2010", "2010 Diamonds (1708 + 302 Bonus)", "Diamonds"),
    ("ML2012", "2012 Diamonds (1710 + 302 Bonus)", "Diamonds"),
    ("ML2016", "2016 Diamonds (1714 + 302 Bonus)", "Diamonds"),
    ("ML1741_305-S1A", "2046 Diamonds (1741 + 305 Bonus)", "Diamonds"),
    ("ML2166", "2166 Diamonds (1860 + 306 Bonus)", "Diamonds"),
    ("ML_2195--2", "2195 Diamonds (1860 + 335 Bonus)", "Diamonds"),
    ("ML2196", "2196 Diamonds (1887 + 309 Bonus)", "Diamonds"),
    ("ML1879_320-S1A", "2199 Diamonds (1879 + 320 Bonus)", "Diamonds"),
    ("1621", "2232 Diamonds (1908 + 324 Bonus)", "Diamonds"),
    ("ML2350", "2350 Diamonds (2035 + 315 Bonus)", "Diamonds"),
    ("ML_2380--2", "2380 Diamonds (2041 + 339 Bonus)", "Diamonds"),
    ("ML2398", "2398 Diamonds (2079 + 319 Bonus)", "Diamonds"),
    ("ML2500", "2500 Diamonds (2150 + 350 Bonus)", "Diamonds"),
    ("ML2515", "2515 Diamonds (2165 + 350 Bonus)", "Diamonds"),
    ("ML2539", "2539 Diamonds (2189 + 350 Bonus)", "Diamonds"),
    ("ML_2578--2", "2578 Diamonds (2211 + 367 Bonus)", "Diamonds"),
    ("ML2602", "2602 Diamonds (2242 + 360 Bonus)", "Diamonds"),
    ("ML_2625--9", "2625 Diamonds (2253 + 372 Bonus)", "Diamonds"),
    ("ML2767", "2767 Diamonds (2397 + 370 Bonus)", "Diamonds"),
    ("ML_2855--2", "2855 Diamonds (2461 + 394 Bonus)", "Diamonds"),
    ("ML_2901--2", "2901 Diamonds (2485 + 416 Bonus)", "Diamonds"),
    ("ML2499_405-S1A", "2904 Diamonds (2499 + 405 Bonus)", "Diamonds"),
    ("ML_2976--2", "2976 Diamonds (2556 + 420 Bonus)", "Diamonds"),
    ("ML2565_412-S1A", "2977 Diamonds (2565 + 412 Bonus)", "Diamonds"),
    ("ML3024", "3024 Diamonds (2624 + 400 Bonus)", "Diamonds"),
    ("ML3198", "3198 Diamonds (2788 + 410 Bonus)", "Diamonds"),
    ("ML3423", "3423 Diamonds (2983 + 440 Bonus)", "Diamonds"),
    ("ML3436", "3436 Diamonds (2996 + 440 Bonus)", "Diamonds"),
    ("ML2985_468-S1A", "3453 Diamonds (2985 + 468 Bonus)", "Diamonds"),
    ("ML3010_471-S1A", "3481 Diamonds (3010 + 471 Bonus)", "Diamonds"),
    ("ML3543", "3543 Diamonds (3093 + 450 Bonus)", "Diamonds"),
    ("ML3568", "3568 Diamonds (3118 + 450 Bonus)", "Diamonds"),
    ("ML3638", "3638 Diamonds (3178 + 460 Bonus)", "Diamonds"),
    ("ML3673", "3673 Diamonds (3213 + 460 Bonus)", "Diamonds"),
    ("ML_3688--2", "3688 Diamonds (3099 + 589 Bonus)", "Diamonds"),
    ("ML_3738--2", "3738 Diamonds (3247 + 491 Bonus)", "Diamonds"),
    ("ML_3760--2", "3760 Diamonds (3261 + 499 Bonus)", "Diamonds"),
    ("ML_4020--2", "4020 Diamonds (3416 + 604 Bonus)", "Diamonds"),
    ("ML3426_604-S1A", "4030 Diamonds (3426 + 604 Bonus)", "Diamonds"),
    ("ML_4394--2", "4394 Diamonds (3724 + 670 Bonus)", "Diamonds"),
    ("ML4396", "4396 Diamonds (3866 + 530 Bonus)", "Diamonds"),
    ("ML3763_641-S1A", "4404 Diamonds (3763 + 641 Bonus)", "Diamonds"),
    ("ML4588", "4588 Diamonds (3919 + 669 Bonus)", "Diamonds"),
    ("ML4001_677-S1A", "4678 Diamonds (4001 + 677 Bonus)", "Diamonds"),
    ("ML_4830--2", "4830 Diamonds (4003 + 827 Bonus)", "Diamonds"),
    ("ML4826_546-S1A", "5372 Diamonds (4826 + 546 Bonus)", "Diamonds"),
    ("ML4506_892-S1A", "5398 Diamonds (4506 + 892 Bonus)", "Diamonds"),
    ("ML_5532--2", "5532 Diamonds (4649 + 883 Bonus)", "Diamonds"),
    ("ML4660_908-S1A", "5568 Diamonds (4660 + 908 Bonus)", "Diamonds"),
    ("ML_6030--2", "6030 Diamonds (5124 + 906 Bonus)", "Diamonds"),
    ("ML6042", "6042 Diamonds (5342 + 700 Bonus)", "Diamonds"),
    ("ML6050", "6050 Diamonds (5350 + 700 Bonus)", "Diamonds"),
    ("ML_6234--2", "6234 Diamonds (5256 + 978 Bonus)", "Diamonds"),
    ("ML_6238--9", "6238 Diamonds (5260 + 978 Bonus)", "Diamonds"),
    ("ML5274_983-S1A", "6257 Diamonds (5274 + 983 Bonus)", "Diamonds"),
    ("ML_6840--2", "6840 Diamonds (6056 + 784 Bonus)", "Diamonds"),
    ("ML6020_1175-S1A", "7195 Diamonds (6020 + 1175 Bonus)", "Diamonds"),
    ("ML_7502--2", "7502 Diamonds (6317 + 1185 Bonus)", "Diamonds"),
    ("ML_7727--2", "7727 Diamonds (6509 + 1218 Bonus)", "Diamonds"),
    ("ML_8040--2", "8040 Diamonds (6832 + 1208 Bonus)", "Diamonds"),
    ("ML7005_1297-S1A", "8302 Diamonds (7005 + 1297 Bonus)", "Diamonds"),
    ("ML8850", "8850 Diamonds (7870 + 980 Bonus)", "Diamonds"),
    ("ML_9288--2", "9288 Diamonds (7740 + 1548 Bonus)", "Diamonds"),
    ("ML7826_1476-S1A", "9302 Diamonds (7826 + 1476 Bonus)", "Diamonds"),
    ("ML_9660--2", "9660 Diamonds (8148 + 1512 Bonus)", "Diamonds"),
    ("ML_10050--2", "10050 Diamonds (8540 + 1510 Bonus)", "Diamonds"),
    ("ML9714_1956-S1A", "11670 Diamonds (9714 + 1956 Bonus)", "Diamonds"),
    ("ML10248_1812-S1A", "12060 Diamonds (10248 + 1812 Bonus)", "Diamonds"),
    ("ML_12976--2", "12976 Diamonds (10839 + 2137 Bonus)", "Diamonds"),
    ("ML11422_2258-S1A", "13680 Diamonds (11422 + 2258 Bonus)", "Diamonds"),
    ("ML12009_2481-S1A", "14490 Diamonds (12009 + 2481 Bonus)", "Diamonds"),
    ("ML_14820--2", "14820 Diamonds (12389 + 2431 Bonus)", "Diamonds"),
    ("ML_16080--2", "16080 Diamonds (13664 + 2416 Bonus)", "Diamonds"),
    ("ML13717_2783-S1A", "16500 Diamonds (13717 + 2783 Bonus)", "Diamonds"),
    ("2857", "18090 Diamonds (15372 + 2718 Bonus)", "Diamonds"),
    ("ML15425_3085-S1A", "18510 Diamonds (15425 + 3085 Bonus)", "Diamonds"),
    ("ML16012_3308-S1A", "19320 Diamonds (16012 + 3308 Bonus)", "Diamonds"),
    ("ML_20100--2", "20100 Diamonds (17080 + 3020 Bonus)", "Diamonds"),
    ("ML16786_3409-S1A", "20195 Diamonds (16786 + 3409 Bonus)", "Diamonds"),
    ("ML17720_3610-S1A", "21330 Diamonds (17720 + 3610 Bonus)", "Diamonds"),
    ("ML20015_4135-S1A", "24150 Diamonds (20015 + 4135 Bonus)", "Diamonds"),
    ("ML_27864--2", "27864 Diamonds (23220 + 4644 Bonus)", "Diamonds"),
    ("ML24018_4962-S1A", "28980 Diamonds (24018 + 4962 Bonus)", "Diamonds"),
    ("MLWEB-S50A", "Weekly Elite Bundle", "Elite Bundles"),
    ("MLMEB-S50A", "Monthly Epic Bundle", "Elite Bundles"),
    ("ML_MEB--2", "Monthly Elite Bundle", "Elite Bundles"),
    ("ML50_50FR-S50AUTO", "100 Diamonds [50 + 50]", "First Time Bonus"),
    ("ML150_150FR-S50AUTO", "300 Diamonds [150 + 150]", "First Time Bonus"),
    ("ML250_250FR-S50AUTO", "500 Diamonds [250 + 250]", "First Time Bonus"),
    ("ML500_500FR-S50AUTO", "1000 Diamonds [500 + 500]", "First Time Bonus"),
    ("ML_WDP--2", "Weekly Diamond Pass (Event Topup + 100)", "Weekly Diamond Pass"),
    ("MLWEEKLYDIAMONDPASS-S1A", "Weekly Diamond Pass", "Weekly Diamond Pass"),
    ("MLWEEKLYDIAMONDPASS2-S1A", "Weekly Diamond Pass x2", "Weekly Diamond Pass"),
    ("WDP2", "Weekly Diamond Pass (Event Topup + 100) x2", "Weekly Diamond Pass"),
    ("MLWEEKLYDIAMONDPASS3-S1A", "Weekly Diamond Pass x3", "Weekly Diamond Pass"),
    ("WDP3", "Weekly Diamond Pass (Event Topup + 100) x3", "Weekly Diamond Pass"),
    ("MLWEEKLYDIAMONDPASS4-S1A", "Weekly Diamond Pass x4", "Weekly Diamond Pass"),
    ("WDP4", "Weekly Diamond Pass (Event Topup + 100) x4", "Weekly Diamond Pass"),
    ("MLWEEKLYDIAMONDPASS5-S1A", "Weekly Diamond Pass x5", "Weekly Diamond Pass"),
    ("WDP5", "Weekly Diamond Pass (Event Topup + 100) x5", "Weekly Diamond Pass"),
    ("MLTL-S1A", "Twilight Pass", "Twilight Pass")
];

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let Some(user_id) = str_param(&m, "user_id") else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter \"user_id\" wajib diisi"}))).into_response();
    };
    let cleaned_id: String = user_id.chars().filter(|c| c.is_ascii_digit()).collect();
    if cleaned_id.len() < 5 || cleaned_id.len() > 15 {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "User ID tidak valid — 5-15 digit angka"}))).into_response();
    }
    let Some(zone_id) = str_param(&m, "zone_id") else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter \"zone_id\" wajib diisi"}))).into_response();
    };
    let cleaned_zone: String = zone_id.chars().filter(|c| c.is_ascii_digit()).collect();
    if cleaned_zone.len() < 3 || cleaned_zone.len() > 6 {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Zone ID tidak valid — 3-6 digit angka"}))).into_response();
    }
    let Some(paket) = str_param(&m, "paket") else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter \"paket\" wajib diisi"}))).into_response();
    };
    let Some((pkg_code, pkg_label, pkg_group)) = PACKAGES.iter().find(|(_, l, _)| l.eq_ignore_ascii_case(&paket)) else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": format!("Paket \"{}\" tidak tersedia", paket)}))).into_response();
    };
    let questionnaire = json!([
        {
            "questionnaire": {
                "code": "userid",
                "inputType": "STRING",
                "regexValidation": {
                    "regex": "^[0-9]{5,15}$",
                    "errorMessages": [
                        { "language": "ID", "title": "Format ID Salah", "body": "ID hanya boleh mengandung angka. Silakan periksa kembali dan coba lagi 😊" },
                        { "language": "EN", "title": "Invalid ID Format", "body": "ID must contain numbers only. Please check and try again 😊" }
                    ]
                },
                "translations": [ { "language": "ID", "question": "Masukkan User ID", "description": "User ID", "choices": [] } ]
            },
            "answer": cleaned_id
        },
        {
            "questionnaire": {
                "code": "zoneid",
                "inputType": "STRING",
                "regexValidation": {
                    "regex": "^[0-9]{3,6}$",
                    "errorMessages": [
                        { "language": "ID", "title": "Format Zone Salah", "body": "Zone hanya boleh mengandung angka. Silakan periksa kembali dan coba lagi 😊" },
                        { "language": "EN", "title": "Invalid Zone Format", "body": "Zone must contain numbers only. Please check and try again 😊" }
                    ]
                },
                "translations": [ { "language": "ID", "question": "(Zone ID)", "description": "Zone ID", "choices": [] } ]
            },
            "answer": cleaned_zone
        }
    ]);
    let (status, data) = match tokogame::create_order(PRODUCT_ID, pkg_code, questionnaire).await {
        Ok(v) => v,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": e}))).into_response(),
    };
    if !status.is_success() || data.get("code").and_then(|v| v.as_str()) != Some("SUCCESS") {
        return (StatusCode::BAD_GATEWAY, Json(json!({
            "status": false,
            "message": data.get("message").and_then(|v| v.as_str()).unwrap_or("Gagal membuat order"),
            "detail": data
        }))).into_response();
    }
    let d = data.get("data").cloned().unwrap_or(json!({}));
    let harga = d.get("totalPriceInCents").and_then(|v| v.as_f64()).map(|c| c / 100.0).unwrap_or(0.0);
    let checkout = d.get("checkoutUrl").cloned().unwrap_or(json!({}));
    let qris_content = checkout.get("qr").and_then(|v| v.as_str()).map(|s| s.to_string());
    let qris_image_url = checkout.get("qrUrl").and_then(|v| v.as_str()).map(|s| s.to_string());
    Json(json!({
        "status": true,
        "result": {
            "orderId": d.get("id"),
            "orderCode": d.get("code"),
            "user_id": cleaned_id,
            "zone_id": cleaned_zone,
            "paket": pkg_label,
            "group": pkg_group,
            "harga": harga,
            "qr_url": qris_image_url,
            "qris_content": qris_content
        },
        "timestamp": chrono::Utc::now().timestamp_millis()
    })).into_response()
}
