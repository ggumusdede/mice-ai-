export function notImplemented(name: string): never {
  throw new Error(`@mice/domain: ${name} not implemented yet`);
}
