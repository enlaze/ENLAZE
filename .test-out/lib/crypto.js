"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptToken = encryptToken;
exports.decryptToken = decryptToken;
exports.safeDecryptToken = safeDecryptToken;
const crypto_1 = __importDefault(require("crypto"));
// 32-byte key is required for AES-256-GCM
// This should be set in environment variables as OAUTH_ENCRYPTION_KEY
const getEncryptionKey = () => {
    const key = process.env.OAUTH_ENCRYPTION_KEY;
    if (!key || key.length !== 64) { // Expecting 64 hex characters = 32 bytes
        throw new Error("OAUTH_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
    }
    return Buffer.from(key, "hex");
};
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 12 bytes is standard for GCM
const AUTH_TAG_LENGTH = 16; // 16 bytes auth tag
/**
 * Encrypts a string using AES-256-GCM.
 * Returns a hex string in the format: iv:encrypted:authTag
 */
function encryptToken(text) {
    if (!text)
        return text;
    const iv = crypto_1.default.randomBytes(IV_LENGTH);
    const cipher = crypto_1.default.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return `${iv.toString("hex")}:${encrypted}:${authTag}`;
}
/**
 * Decrypts a previously encrypted token.
 *
 * Throws on any failure (bad format, wrong key, tampered ciphertext). Callers
 * that just need a probe should use {@link safeDecryptToken} instead — it
 * narrows failures into a structured result so route handlers can degrade
 * gracefully (e.g. when `OAUTH_ENCRYPTION_KEY` differs between environments).
 */
function decryptToken(encryptedText) {
    if (!encryptedText)
        return encryptedText;
    const parts = encryptedText.split(":");
    if (parts.length !== 3) {
        throw new Error("Invalid encrypted token format");
    }
    const iv = Buffer.from(parts[0], "hex");
    const encrypted = parts[1];
    const authTag = Buffer.from(parts[2], "hex");
    const decipher = crypto_1.default.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}
/**
 * Non-throwing variant of {@link decryptToken}. Used by agent endpoints to
 * distinguish "no token stored" from "token stored but undecryptable with the
 * current OAUTH_ENCRYPTION_KEY" — the latter happens when local connections
 * were made with a different key than production.
 */
function safeDecryptToken(encryptedText) {
    if (!encryptedText) {
        return { ok: false, reason: "missing", error: "No encrypted token provided" };
    }
    const parts = encryptedText.split(":");
    if (parts.length !== 3) {
        return { ok: false, reason: "bad_format", error: "Invalid encrypted token format" };
    }
    try {
        const plaintext = decryptToken(encryptedText);
        return { ok: true, plaintext };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("OAUTH_ENCRYPTION_KEY")) {
            return { ok: false, reason: "no_key", error: message };
        }
        return { ok: false, reason: "bad_key_or_tampered", error: message };
    }
}
