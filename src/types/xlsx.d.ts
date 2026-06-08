declare module 'xlsx' {
  export function read(data: Buffer | Uint8Array, opts?: { type?: string }): {
    SheetNames: string[]
    Sheets: Record<string, Record<string, unknown>>
  }
}
