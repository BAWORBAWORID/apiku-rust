// QrisInfo — native conversion of api/tools/qris-info.js (EMVCo MPM parser + CRC16)
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

fn crc16(data: &str) -> String {
    let mut crc: u32 = 0xFFFF;
    for b in data.bytes() {
        crc ^= (b as u32) << 8;
        for _ in 0..8 {
            if crc & 0x8000 != 0 {
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
            } else {
                crc = (crc << 1) & 0xFFFF;
            }
        }
    }
    format!("{:04X}", crc)
}

fn parse_tlv(s: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let bytes: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i + 4 <= bytes.len() {
        let tag: String = bytes[i..i + 2].iter().collect();
        let len_str: String = bytes[i + 2..i + 4].iter().collect();
        let len: usize = match len_str.parse() {
            Ok(l) => l,
            Err(_) => break,
        };
        if i + 4 + len > bytes.len() {
            break;
        }
        let val: String = bytes[i + 4..i + 4 + len].iter().collect();
        out.push((tag, val));
        i += 4 + len;
    }
    out
}

fn tlv_get<'a>(tlv: &'a [(String, String)], tag: &str) -> Option<&'a str> {
    tlv.iter().find(|(t, _)| t == tag).map(|(_, v)| v.as_str())
}

fn sub_tlv(parent: Option<&str>, tag: &str) -> Option<String> {
    parent.and_then(|p| {
        parse_tlv(p)
            .iter()
            .find(|(t, _)| t == tag)
            .map(|(_, v)| v.clone())
    })
}

fn detect_brand(acquirer: &Option<String>) -> String {
    let a = match acquirer {
        Some(a) if !a.is_empty() => a.to_uppercase(),
        _ => return "Unknown".to_string(),
    };
    if a.contains("DANA") {
        "DANA".into()
    } else if a.contains("GOPAY") || a.contains("GOJEK") {
        "GoPay".into()
    } else if a.contains("OVO") {
        "OVO".into()
    } else if a.contains("SHOPEE") {
        "ShopeePay".into()
    } else if a.contains("LINKAJA") {
        "LinkAja".into()
    } else if a.contains("BCA") {
        "BCA".into()
    } else if a.contains("BRI") {
        "Bank BRI".into()
    } else if a.contains("BNI") {
        "Bank BNI".into()
    } else if a.contains("MANDIRI") {
        "Bank Mandiri".into()
    } else if a.contains("BSI") {
        "Bank Syariah Indonesia".into()
    } else if a.contains("CIMB") {
        "CIMB Niaga".into()
    } else if a.contains("PERMATA") {
        "Bank Permata".into()
    } else if a.contains("NOBU") {
        "Bank Nobu".into()
    } else {
        acquirer.clone().unwrap_or_default()
    }
}

fn criteria_name(code: &str) -> String {
    match code {
        "UMI" => "Usaha Mikro",
        "UKE" => "Usaha Kecil",
        "UME" => "Usaha Menengah",
        "UBE" => "Usaha Besar",
        "PSO" => "Perusahaan Publik / Sosial",
        _ => return code.to_string(),
    }
    .to_string()
}

fn mcc_category(code: &str) -> String {
    match code {
        "6540" => "POI Funding / Uang Elektronik & Dompet Digital",
        "5411" => "Supermarket / Minimarket / Toko Kelontong",
        "5812" => "Restoran / Rumah Makan",
        "5814" => "Makanan Cepat Saji (Fast Food)",
        "5999" => "Toko Retail / Aneka Barang",
        "4111" => "Transportasi Umum / Komuter",
        "4121" => "Taksi / Layanan Transportasi Online",
        "5311" => "Department Store",
        "5541" => "SPBU / Bahan Bakar Minyak",
        "8299" => "Pendidikan / Kursus & Pelatihan",
        "7999" => "Hiburan / Rekreasi",
        "8099" => "Layanan Medis & Kesehatan",
        _ => return "Lainnya".to_string(),
    }
    .to_string()
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get = |k: &str| {
        query.get(k).cloned().or_else(|| {
            body.as_ref()
                .and_then(|b| b.get(k))
                .and_then(|v| v.as_str().map(|s| s.to_string()))
        })
    };

    let raw_text = get("text")
        .or_else(|| get("qris"))
        .or_else(|| get("string"));

    let raw_text = match raw_text {
        Some(t) if !t.trim().is_empty() => t.trim().to_string(),
        _ => {
            return Json(json!({
                "status": false,
                "message": "Parameter 'text' wajib diisi dengan string QRIS."
            }))
            .into_response()
        }
    };

    if raw_text.len() < 25 {
        return Json(
            json!({"status": false, "message": "String QRIS terlalu pendek atau tidak valid."}),
        )
        .into_response();
    }

    let calc_crc = crc16(&raw_text[..raw_text.len() - 4]);
    let expected_crc = raw_text[raw_text.len() - 4..].to_uppercase();
    let is_crc_valid = calc_crc == expected_crc;

    let root = parse_tlv(&raw_text);
    let pid = tlv_get(&root, "00");
    if pid != Some("01") {
        return Json(json!({
            "status": false,
            "message": "Format QRIS tidak sesuai standar EMVCo MPM (Payload Indicator bukan '01')."
        }))
        .into_response();
    }

    let point_of_initiation = if tlv_get(&root, "01") == Some("12") {
        "Dynamic"
    } else {
        "Static"
    };

    let mut acquirer: Option<String> = None;
    let mut merchant_pan: Option<String> = None;
    let mut internal_merchant_id: Option<String> = None;
    let mut merchant_criteria: Option<String> = None;

    for tag in 26..=45 {
        let tag_str = format!("{:02}", tag);
        if let Some(parent) = tlv_get(&root, &tag_str) {
            for (t, v) in parse_tlv(parent) {
                match t.as_str() {
                    "00" => { acquirer.get_or_insert(v); }
                    "01" => { merchant_pan.get_or_insert(v); }
                    "02" => { internal_merchant_id.get_or_insert(v); }
                    "03" => { merchant_criteria.get_or_insert(v); }
                    _ => continue,
                };
            }
        }
    }

    let mut nmid: Option<String> = None;
    let mut national_gui: Option<String> = None;
    if let Some(parent51) = tlv_get(&root, "51") {
        for (t, v) in parse_tlv(parent51) {
            match t.as_str() {
                "00" => national_gui = Some(v),
                "02" => nmid = Some(v),
                "03" => { merchant_criteria.get_or_insert(v); }
                _ => continue,
            }
        }
    }

    let mcc = tlv_get(&root, "52").map(|s| s.to_string());
    let currency_code = tlv_get(&root, "53").unwrap_or("360").to_string();
    let amount = tlv_get(&root, "54").and_then(|v| v.parse::<f64>().ok());
    let fee_type = tlv_get(&root, "55").map(|s| s.to_string());
    let fee_fixed = tlv_get(&root, "56").and_then(|v| v.parse::<f64>().ok());
    let fee_percentage = tlv_get(&root, "57").and_then(|v| v.parse::<f64>().ok());
    let country_code = tlv_get(&root, "58").unwrap_or("ID").to_string();
    let merchant_name = tlv_get(&root, "59").map(|s| s.to_string());
    let merchant_city = tlv_get(&root, "60").map(|s| s.to_string());
    let postal_code = tlv_get(&root, "61").map(|s| s.to_string());

    let mut additional_data: Value = Value::Null;
    if let Some(parent62) = tlv_get(&root, "62") {
        let sub = parse_tlv(parent62);
        additional_data = json!({
            "billNumber": sub_tlv(Some(parent62), "01"),
            "mobileNumber": sub_tlv(Some(parent62), "02"),
            "storeLabel": sub_tlv(Some(parent62), "03"),
            "loyaltyNumber": sub_tlv(Some(parent62), "04"),
            "referenceLabel": sub_tlv(Some(parent62), "05"),
            "customerLabel": sub_tlv(Some(parent62), "06"),
            "terminalLabel": sub_tlv(Some(parent62), "07"),
            "purpose": sub_tlv(Some(parent62), "08"),
        });
        let _ = &sub;
    }

    Json(json!({
        "status": true,
        "result": {
            "valid": is_crc_valid,
            "merchantName": merchant_name,
            "nmid": nmid,
            "nationalGui": national_gui,
            "brand": detect_brand(&acquirer),
            "acquirer": acquirer,
            "merchantPan": merchant_pan,
            "internalMerchantId": internal_merchant_id,
            "type": point_of_initiation,
            "amount": amount,
            "currency": if currency_code == "360" { "IDR" } else { currency_code.as_str() },
            "fee": { "indicator": fee_type, "fixed": fee_fixed, "percentage": fee_percentage },
            "criteria": {
                "code": merchant_criteria,
                "name": merchant_criteria.as_deref().map(criteria_name).unwrap_or_default(),
            },
            "mcc": {
                "code": mcc,
                "category": mcc.as_deref().map(mcc_category).unwrap_or_else(|| "Lainnya".to_string()),
            },
            "city": merchant_city,
            "postalCode": postal_code,
            "country": country_code,
            "additionalData": additional_data,
            "crc": { "expected": expected_crc, "calculated": calc_crc, "valid": is_crc_valid },
            "raw": raw_text,
        }
    })).into_response()

}
