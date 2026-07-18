const crypto = require('crypto');

function getKey() {
  const hex = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  if (!hex || Buffer.from(hex, 'hex').length !== 32) {
    throw new Error(
      'OAUTH_TOKEN_ENCRYPTION_KEY must be set to a 32-byte hex string ' +
      '(generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))")'
    );
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

function decrypt(payload) {
  const [ivHex, authTagHex, ciphertextHex] = payload.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = { encrypt, decrypt };
