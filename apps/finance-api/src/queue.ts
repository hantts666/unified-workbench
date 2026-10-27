import { Queue } from "bullmq";
export function redisConnection() {
  const u = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password || undefined,
    maxRetriesPerRequest: null,
  };
}
export const queue = new Queue("documents", {
  connection: redisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: 500,
    removeOnFail: 500,
  },
});
export function enqueue(id: string, version: number) {
  return queue.add("process", { id, version }, { jobId: `${id}-${version}` });
}
