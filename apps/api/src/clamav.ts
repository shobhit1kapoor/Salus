import net from "node:net";
import { env } from "./env.js";

export async function scanForMalware(buffer: Buffer) {
  return new Promise<void>((resolve, reject) => {
    const socket = net.createConnection(env.CLAMAV_PORT, env.CLAMAV_HOST);
    const chunks: Buffer[] = [];
    const fail = (error: Error) => { socket.destroy(); reject(new Error(`Malware scan unavailable: ${error.message}`)); };
    socket.setTimeout(30_000, () => fail(new Error("timeout")));
    socket.on("error", fail);
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => {
      const result = Buffer.concat(chunks).toString("utf8");
      if (result.includes("FOUND")) reject(new Error("Upload rejected: malicious content detected"));
      else if (result.includes("OK")) resolve();
      else reject(new Error("Malware scan returned an invalid response"));
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let offset = 0; offset < buffer.length; offset += 64 * 1024) {
        const chunk = buffer.subarray(offset, Math.min(offset + 64 * 1024, buffer.length));
        const size = Buffer.alloc(4); size.writeUInt32BE(chunk.length); socket.write(size); socket.write(chunk);
      }
      socket.end(Buffer.alloc(4));
    });
  });
}
