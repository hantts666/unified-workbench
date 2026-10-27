export interface Processor<I, O> {
  id: string;
  version: string;
  timeoutMs: number;
  run(input: I, signal: AbortSignal): Promise<O>;
}
export async function execute<I, O>(
  processor: Processor<I, O>,
  input: I,
): Promise<O> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      processor.run(input, controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`${processor.id} 处理超时`));
        }, processor.timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
