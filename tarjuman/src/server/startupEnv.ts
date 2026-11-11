/**
 * Node decides at process start whether its built-in `fetch` honours HTTPS_PROXY
 * (NODE_USE_ENV_PROXY=1, Node 22.21 or newer). A value that only appears later, from a
 * .env file, has no effect.
 */
export function nodeSupportsEnvProxy(version: string = process.versions.node): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 21);
}
