import crypto from "crypto";

// 32-byte key is required for AES-256-GCM
// This should be set in environment variables as OAUTH_ENCRYPTION_KEY
const getEncryptionKey = (): Buffer => {
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
export function encryptToken(text: string): string {
  if (!text) return text;
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const authTag = cipher.getAuthTag().toString("hex");
  
  return `${iv.toString("hex")}:${encrypted}:${authTag}`;
}

/**
 * Decrypts a previously encrypted token.
 */
export function decryptToken(encryptedText: string): string {
  if (!encryptedText) return encryptedText;
  
  const parts = encryptedText.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token format");
  }
  
  const iv = Buffer.from(parts[0], "hex");
  const encrypted = parts[1];
  const authTag = Buffer.from(parts[2], "hex");
  
  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
}
