// Base64URL ⇄ ArrayBuffer helpers
export function b64ToBuf(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'))
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

export function bufToB64(buf) {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Convert server options to navigator.credentials.create() format
export function prepareCreationOptions(options) {
  return {
    publicKey: {
      rp: options.publicKey.rp,
      user: {
        ...options.publicKey.user,
        id: b64ToBuf(options.publicKey.user.id),
      },
      challenge: b64ToBuf(options.publicKey.challenge),
      pubKeyCredParams: options.publicKey.pubKeyCredParams,
      timeout: options.publicKey.timeout,
      excludeCredentials: (options.publicKey.excludeCredentials || []).map(c => ({
        ...c,
        id: b64ToBuf(c.id),
      })),
      authenticatorSelection: options.publicKey.authenticatorSelection,
      attestation: options.publicKey.attestation,
    },
  }
}

// Convert server options to navigator.credentials.get() format
export function prepareRequestOptions(options) {
  return {
    publicKey: {
      challenge: b64ToBuf(options.publicKey.challenge),
      timeout: options.publicKey.timeout,
      rpId: options.publicKey.rpId,
      allowCredentials: (options.publicKey.allowCredentials || []).map(c => ({
        ...c,
        id: b64ToBuf(c.id),
      })),
      userVerification: options.publicKey.userVerification,
    },
  }
}

// Parse credential response for JSON transport to server
export function parseCredential(cred) {
  const response = cred.response
  return {
    id: cred.id,
    type: cred.type,
    rawId: bufToB64(cred.rawId),
    response: {
      clientDataJSON: bufToB64(response.clientDataJSON),
      attestationObject: response.attestationObject ? bufToB64(response.attestationObject) : undefined,
      authenticatorData: response.authenticatorData ? bufToB64(response.authenticatorData) : undefined,
      signature: response.signature ? bufToB64(response.signature) : undefined,
      userHandle: response.userHandle ? bufToB64(response.userHandle) : undefined,
    },
  }
}
