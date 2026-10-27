import { PDFParse } from "pdf-parse";
export async function extractPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
  });
  try {
    const result = await parser.getText({ first: 30 });
    return result.text.slice(0, 30000);
  } finally {
    await parser.destroy();
  }
}
