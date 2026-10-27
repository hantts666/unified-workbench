import type { Processor } from "../../packages/processor-sdk/index.js";
export interface OCRResult {
  text: string;
  confidence: number;
  provider: string;
}
export type OCRProvider = Processor<
  { buffer: Buffer; mimeType: string },
  OCRResult
>;
// 未配置供应商时明确交由人工录入，不把图片文件名伪装为识别结果。
export const manualOCR: OCRProvider = {
  id: "ocr-manual",
  version: "1.0.0",
  timeoutMs: 1000,
  async run() {
    throw new Error("未配置 OCR 供应商，请对照原始文件人工录入");
  },
};
