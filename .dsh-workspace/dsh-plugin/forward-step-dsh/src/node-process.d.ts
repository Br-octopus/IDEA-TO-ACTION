declare module 'node:process' {
  export function cwd(): string
  export const env: Record<string, string | undefined>
}

declare module 'node:crypto' {
  export function randomUUID(): string
  export interface Hash { update(value: string | Uint8Array, encoding?: string): Hash; digest(encoding: string): string }
  export function createHash(algorithm: string): Hash
}
declare module 'node:module' { export function createRequire(url: string | URL): (id: string) => any }

declare module 'node:path' { export function join(...parts: string[]): string }
