async function collectStream(
  stream: { next: () => Promise<string | null> },
  maxBytes?: number
): Promise<{ text: string; truncated: boolean }> {
  const chunks: string[] = [];
  let totalBytes = 0;
  let truncated = false;
  while (true) {
    const line = await stream.next();
    if (line === null) break;
    const chunk = String(line);
    const buf = Buffer.from(chunk);
    if (typeof maxBytes === "number") {
      if (totalBytes + buf.length > maxBytes) {
        const remaining = Math.max(0, maxBytes - totalBytes);
        if (remaining > 0) {
          chunks.push(buf.subarray(0, remaining).toString());
        }
        truncated = true;
        break;
      }
    }
    chunks.push(chunk);
    totalBytes += buf.length;
  }
  return { text: chunks.join(""), truncated };
}

export async function execInBox(
  box: { exec: (...args: any[]) => Promise<any> },
  command: string,
  args: string[],
  env?: Record<string, string>,
  tty?: boolean,
  maxOutputBytes?: number
): Promise<{ exitCode: number; stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean }> {
  const envArray = env
    ? Object.entries(env).map(([key, value]) => [key, value])
    : undefined;
  const execution = await box.exec(command, args, envArray, tty ?? false);

  let stdoutText = "";
  let stderrText = "";
  let stdoutTruncated = false;
  let stderrTruncated = false;

  try {
    const stdout = await execution.stdout();
    try {
      const collected = await collectStream(stdout, maxOutputBytes);
      stdoutText = collected.text;
      stdoutTruncated = collected.truncated;
    } catch {
      // stream ended
    }
  } catch {
    // stdout not available
  }

  try {
    const stderr = await execution.stderr();
    try {
      const collected = await collectStream(stderr, maxOutputBytes);
      stderrText = collected.text;
      stderrTruncated = collected.truncated;
    } catch {
      // stream ended
    }
  } catch {
    // stderr not available
  }

  const waitResult = await execution.wait();
  const exitCode =
    typeof waitResult?.exitCode === "number"
      ? waitResult.exitCode
      : waitResult?.exit_code ?? 0;

  return {
    exitCode,
    stdout: stdoutText,
    stderr: stderrText,
    stdoutTruncated,
    stderrTruncated,
  };
}
