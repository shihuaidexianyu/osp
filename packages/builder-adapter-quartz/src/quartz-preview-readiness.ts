import net from "node:net";

/**
 * Waits for the watched Quartz preview process to start listening on its HTTP port.
 * Timeout handling lives here so the backend module only needs to make a single readiness call.
 */
export async function waitForPortReady(input: {
  exitPromise: Promise<number>;
  host: string;
  port: number;
  timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;

  while (Date.now() < deadline) {
    const exitState = await Promise.race([
      input.exitPromise.then((code) => ({ kind: "exit" as const, code })),
      delay(250).then(() => ({ kind: "wait" as const }))
    ]);

    if (exitState.kind === "exit") {
      throw new Error(`Quartz preview exited before becoming ready with code ${exitState.code}.`);
    }

    if (await canConnect(input.host, input.port)) {
      return;
    }
  }

  throw new Error(`Quartz preview did not open http://localhost:${input.port} within ${input.timeoutMs}ms.`);
}

export function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}
