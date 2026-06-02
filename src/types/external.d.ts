declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string
  }

  export default function pdfParse(buffer: Buffer): Promise<PdfParseResult>
}

declare module 'mammoth' {
  interface ExtractRawTextInput {
    path: string
  }

  interface ExtractRawTextResult {
    value: string
    messages: unknown[]
  }

  export function extractRawText(input: ExtractRawTextInput): Promise<ExtractRawTextResult>
}
