import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { env } from "./env.js";
import { unwrapObjectKey, wrapObjectKey } from "./privacy.js";
const client = new S3Client({ endpoint: env.S3_ENDPOINT, region: env.S3_REGION, forcePathStyle: true, credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } });
const magic = Buffer.from("SL02");
function encrypt(body: Buffer, encryptionKey: Buffer) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(body), cipher.final()]); const tag = cipher.getAuthTag();
  return Buffer.concat([magic, iv, tag, ciphertext]);
}
function decrypt(body: Buffer, encryptionKey: Buffer) {
  if (!body.subarray(0, 4).equals(magic) || body.length < 32) throw new Error("Stored object is not a valid Salus encrypted payload");
  const iv = body.subarray(4, 16); const tag = body.subarray(16, 32); const ciphertext = body.subarray(32);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, iv); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
export async function putPrivateObject(key: string, body: Buffer, contentType: string) {
  const encryptionKey = randomBytes(32);
  const traceId = randomUUID();
  const wrappedKey = await wrapObjectKey(encryptionKey.toString("base64"), traceId);
  await client.send(new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    Body: encrypt(body, encryptionKey),
    ContentType: "application/octet-stream",
    Metadata: {
      originalContentType: contentType,
      encrypted: "aes-256-gcm+protegrity-wrapped-dek",
      wrappedKey: Buffer.from(wrappedKey, "utf8").toString("base64url"),
      protectionTrace: traceId
    }
  }));
}
export async function getPrivateObject(key: string) {
  const response = await client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  const wrapped = response.Metadata?.wrappedkey;
  if (!wrapped) throw new Error("Stored object is missing its Protegrity-protected data key");
  const traceId = randomUUID();
  const unwrapped = await unwrapObjectKey(Buffer.from(wrapped, "base64url").toString("utf8"), traceId);
  const encryptionKey = Buffer.from(unwrapped, "base64");
  if (encryptionKey.length !== 32) throw new Error("Protegrity returned an invalid object data key");
  return decrypt(Buffer.from(await response.Body!.transformToByteArray()), encryptionKey);
}
export async function inspectEncryptedObject(key: string) {
  const response = await client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  return {
    body: Buffer.from(await response.Body!.transformToByteArray()),
    metadata: response.Metadata ?? {},
    contentType: response.ContentType ?? "application/octet-stream"
  };
}
export async function deletePrivateObject(key: string) {
  await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}
