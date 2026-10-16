/** Unlike ReadableStream.tee(), the faster branch cannot buffer the entire file for the slower one. */
export function backpressuredTee(
  source: ReadableStream<Uint8Array>,
): [ReadableStream<Uint8Array>, ReadableStream<Uint8Array>] {
  const reader = source.getReader();
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
  const requested = [false, false];
  let reading = false,
    closed = false;
  const cancel = async (reason: unknown) => {
    if (closed) return;
    closed = true;
    await reader.cancel(reason).catch(() => {});
    for (const controller of controllers) {
      try {
        controller.error(reason);
      } catch {
        /* Already closed. */
      }
    }
  };
  const pump = async () => {
    if (closed || reading || !requested[0] || !requested[1]) return;
    reading = true;
    try {
      const item = await reader.read();
      if (closed) return;
      requested[0] = requested[1] = false;
      if (item.done) {
        closed = true;
        for (const c of controllers) c.close();
        reader.releaseLock();
      } else
        for (const [index, c] of controllers.entries())
          c.enqueue(index === 0 ? item.value.slice() : item.value);
    } catch (error) {
      await cancel(error);
    } finally {
      reading = false;
      void pump();
    }
  };
  const branch = (index: number) =>
    new ReadableStream<Uint8Array>(
      {
        start(c) {
          controllers[index] = c;
        },
        pull() {
          requested[index] = true;
          void pump();
        },
        cancel,
      },
      { highWaterMark: 1 },
    );
  return [branch(0), branch(1)];
}
