use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;

pub fn list_cipher_algos() -> &'static [&'static str] {
    &["aes-256-gcm", "aes-256-cbc", "des-ede3"]
}

pub fn is_cipher_algo(name: &str) -> bool {
    let lower = name.to_lowercase();
    list_cipher_algos().iter().any(|&a| a == lower)
}

pub fn from_b64(value: &str) -> Result<Vec<u8>, String> {
    let clean = value
        .trim()
        .replace(' ', "+")
        .replace('-', "+")
        .replace('_', "/");
    B64.decode(clean).map_err(|e| format!("Base64 decode error: {}", e))
}

pub fn to_b64(bytes: &[u8]) -> String {
    B64.encode(bytes)
}

pub fn generate_random_bytes(len: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes
}
