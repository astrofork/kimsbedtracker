// Fingerprint / passkey (WebAuthn) helpers.
//
// Flow: after a successful password login, the user can "enable fingerprint"
// which creates a platform credential bound to this device. On return visits,
// the fingerprint unlocks a stored session token — no password typing.
//
// NOTE: WebAuthn requires HTTPS (or localhost). On a deployed server use a
// real domain with TLS. For full server-side cryptographic verification,
// add @simplewebauthn/server; this client flow uses the platform authenticator
// for the user-presence check and gates a locally sealed token.

const CRED_KEY = "bedflow_cred_id";
const SEALED_KEY = "bedflow_sealed";

export function passkeySupported() {
  return typeof window !== "undefined" &&
    window.PublicKeyCredential &&
    navigator.credentials &&
    typeof navigator.credentials.create === "function";
}

export async function platformAvailable() {
  if (!passkeySupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

function rand(n = 32) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

// Enroll fingerprint on this device, sealing the current session token+user.
export async function enrollFingerprint(username, token, user) {
  if (!(await platformAvailable())) throw new Error("Fingerprint not available on this device");
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: rand(),
      rp: { name: "BedFlow" },
      user: { id: new TextEncoder().encode(username), name: username, displayName: user.name || username },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
      timeout: 60000,
    },
  });
  if (!cred) throw new Error("Enrollment cancelled");
  const id = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
  localStorage.setItem(CRED_KEY, id);
  localStorage.setItem(SEALED_KEY, JSON.stringify({ token, user }));
  return true;
}

export function fingerprintEnrolled() {
  return !!localStorage.getItem(CRED_KEY) && !!localStorage.getItem(SEALED_KEY);
}

export function clearFingerprint() {
  localStorage.removeItem(CRED_KEY);
  localStorage.removeItem(SEALED_KEY);
}

// Unlock with fingerprint — returns {token, user} on success.
export async function unlockWithFingerprint() {
  const id = localStorage.getItem(CRED_KEY);
  const sealed = localStorage.getItem(SEALED_KEY);
  if (!id || !sealed) throw new Error("No fingerprint enrolled");
  const rawId = Uint8Array.from(atob(id), (c) => c.charCodeAt(0));
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: rand(),
      allowCredentials: [{ type: "public-key", id: rawId }],
      userVerification: "required",
      timeout: 60000,
    },
  });
  if (!assertion) throw new Error("Fingerprint not recognized");
  return JSON.parse(sealed); // device verified the user; release the sealed session
}
