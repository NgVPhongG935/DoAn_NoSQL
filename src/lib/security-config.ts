// Server-only configuration. Never fall back to a key shipped with the source.
export function getJwtSecret(): Uint8Array {
  const value = process.env.JWT_SECRET;
  if (!value || value !== value.trim() || new TextEncoder().encode(value).length < 32
    || new Set(value).size < 12
    || /replace|change.?me|example|password|secret|local-demo/i.test(value)) {
    throw new Error("JWT_SECRET must be an independently generated random secret of at least 32 bytes; placeholders are forbidden.");
  }
  return new TextEncoder().encode(value);
}

export function getAdminAccount() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  if (!email || !passwordHash) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(passwordHash)) {
    return null;
  }
  return {
    id: "admin-demo", name: "Quản trị RideFlow", email, passwordHash,
  };
}
