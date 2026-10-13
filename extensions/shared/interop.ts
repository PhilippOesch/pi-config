export function isWslEnvironment(process: NodeJS.Process): boolean {
  return Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
}
