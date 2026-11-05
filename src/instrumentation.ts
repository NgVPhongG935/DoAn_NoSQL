export async function register() {
  const { getJwtSecret } = await import("./lib/security-config");
  getJwtSecret();
}
