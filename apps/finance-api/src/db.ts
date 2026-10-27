import { PrismaClient } from "../../../.generated/finance/index.js";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
export const db = new PrismaClient({
  datasourceUrl: process.env.FINANCE_DATABASE_URL,
});
export const hash = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
function master() {
  const key = process.env.MASTER_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(key))
    throw new Error("MASTER_KEY 必须为 32 字节十六进制密钥");
  return Buffer.from(key, "hex");
}
export function encrypt(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", master(), iv);
  const result = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    result.toString("hex"),
  ].join(".");
}
export function decrypt(value: string) {
  const [iv, tag, data] = value.split(".");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    master(),
    Buffer.from(iv, "hex"),
  );
  cipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    cipher.update(Buffer.from(data, "hex")),
    cipher.final(),
  ]).toString("utf8");
}
export async function audit(
  tenantId: string,
  userId: string,
  action: string,
  resourceId: string,
  detail: object = {},
) {
  return db.audit.create({
    data: { tenantId, userId, action, resourceId, detail },
  });
}
