/**
 * Symmetric block cipher untuk api/tools/encrypt.js
 *
 * Algoritma: aes-256-gcm, aes-256-cbc, des-ede3 (3DES)
 *
 * Format: field terpisah (iv / tag / ciphertext), semuanya base64.
 *   - GCM punya authTag (16 byte) yang mendeteksi manipulasi ciphertext.
 *   - CBC dan 3DES TIDAK punya tag -> hasilnya bisa diubah diam-diam.
 *     Untuk algo tanpa tag,_setpadding dan last question: integrity tambahan
 *     harus datang dari luar (HMAC terpisah) atau dari GCM.
 *
 * Kunci acak dibuat per-request dan DIKEMBALIKAN ke pemanggil, tidak disimpan
 * di server. Konsekuensinya: kunci ada di tangan siapa pun yang melihat
 * response, jadi ini cocok untuk "enkripsi sekali pakai dengan kunci di sisi
 * pemanggil" — BUKAN untuk melindungi dari pembaca response. Simpan key
 *_result.key_ di tempat aman; kalau hilang, ciphertext tidak bisa dibuka lagi.
 */

import crypto from "node:crypto";

const ALGOS = {
  "aes-256-gcm": { node: "aes-256-gcm", keyBytes: 32, ivBytes: 12, hasTag: true },
  "aes-256-cbc": { node: "aes-256-cbc", keyBytes: 32, ivBytes: 16, hasTag: false },
  // Node memberi nama "des-ede3-cbc" (bukan "des-ede3c") untuk Triple DES mode CBC.
  "des-ede3": { node: "des-ede3-cbc", keyBytes: 24, ivBytes: 8, hasTag: false },
};

export function isCipherAlgo(name) {
  return Object.hasOwn(ALGOS, String(name || "").toLowerCase());
}

export function listCipherAlgos() {
  return Object.keys(ALGOS);
}

function spec(name) {
  return ALGOS[String(name || "").toLowerCase()];
}

/**
 * Decode base64 yang toleran terhadap transport.
 *
 * Dua masalah nyata kalau field ini lewat query string:
 *   1. "+" di-decode jadi SPASI oleh parser query, sehingga kunci/iv/ciphertext
 *      ikut rusak. Diperbaiki dengan mengubah spasi kembali jadi "+".
 *   2. Varian base64url memakai "-" dan "_" — juga diterima di sini.
 */
function fromB64(value) {
  return Buffer.from(
    String(value).trim().replace(/\s/g, "+").replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  );
}

/**
 * Enkripsi dengan kunci acak baru.
 * @returns {{algorithm,key,iv,tag,ciphertext,keyBytes,note}}
 */
export function cipherEncrypt(plaintext, algo) {
  const s = spec(algo);
  if (!s) throw new Error(`Algoritma '${algo}' tidak didukung. Pilihan: ${listCipherAlgos().join(", ")}`);

  const key = crypto.randomBytes(s.keyBytes);
  const iv = crypto.randomBytes(s.ivBytes);
  const cipher = crypto.createCipheriv(s.node, key, iv);

  // GCM di Node default tag 16 byte; setAuthTagLength hanya ada di decipher.
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);

  return {
    algorithm: String(algo).toLowerCase(),
    key: key.toString("base64"),
    iv: iv.toString("base64"),
    tag: s.hasTag ? cipher.getAuthTag().toString("base64") : null,
    ciphertext: ciphertext.toString("base64"),
    keyBytes: s.keyBytes,
    note: s.hasTag
      ? "Tag tersedia — ciphertext terverifikasi, manipulasi akan terdeteksi."
      : "Tanpa authentication tag — ciphertext bisa dimodifikasi tanpa terdeteksi.",
  };
}

/**
 * Dekripsi dengan kunci, iv, dan tag yang diberikan pemanggil.
 */
export function cipherDecrypt({ ciphertext, key, iv, tag, algo }) {
  const s = spec(algo);
  if (!s) throw new Error(`Algoritma '${algo}' tidak didukung. Pilihan: ${listCipherAlgos().join(", ")}`);
  if (!ciphertext) throw new Error("Parameter 'ciphertext' wajib diisi.");
  if (!key) throw new Error("Parameter 'key' wajib diisi (dari result encrypt).");
  if (!iv) throw new Error("Parameter 'iv' wajib diisi (dari result encrypt).");
  if (s.hasTag && !tag) throw new Error("Parameter 'tag' wajib diisi untuk aes-256-gcm.");

  const keyBuf = fromB64(key);
  if (keyBuf.length !== s.keyBytes) {
    throw new Error(
      `Panjang kunci tidak cocok untuk ${algo}: butuh ${s.keyBytes} byte, diterima ${keyBuf.length}.`
    );
  }

  const decipher = crypto.createDecipheriv(s.node, keyBuf, fromB64(iv));
  if (s.hasTag) decipher.setAuthTag(fromB64(tag));

  try {
    const plain = Buffer.concat([
      decipher.update(fromB64(ciphertext)),
      decipher.final(),
    ]);
    return {
      algorithm: String(algo).toLowerCase(),
      text: plain.toString("utf8"),
      verified: s.hasTag ? true : null,
    };
  } catch (e) {
    if (s.hasTag) {
      throw new Error(
        "Dekripsi gagal: kunci/iv/tag salah, atau ciphertext sudah dimanipulasi (auth tag tidak cocok)."
      );
    }
    throw new Error("Dekripsi gagal: kunci atau iv salah.");
  }
}
