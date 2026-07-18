const crypto = require('crypto');

// 32-byte key derived from VAULT_KEY env var, falling back to JWT_SECRET.
// SHA-256 normalises it to exactly 32 bytes regardless of the source length.
const VAULT_KEY = crypto.createHash('sha256')
  .update(process.env.VAULT_KEY || process.env.JWT_SECRET || 'hr-vault-fallback-key')
  .digest();

function encrypt(plaintext) {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', VAULT_KEY, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return {
    iv:  iv.toString('base64'),
    enc: enc.toString('base64'),
    tag: tag.toString('base64'),
  };
}

function decrypt({ iv, enc, tag }) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', VAULT_KEY, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return decipher.update(Buffer.from(enc, 'base64'), undefined, 'utf8') + decipher.final('utf8');
}

module.exports = { encrypt, decrypt };
