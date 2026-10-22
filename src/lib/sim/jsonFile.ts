// A JSON file with read-modify-write, for the simulated parties' state. Same atomic-rename pattern
// as the app's Store, so state survives Next.js dev hot reload.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export class JsonFile<T> {
  constructor(
    private readonly filePath: string,
    private readonly init: () => T,
  ) {}

  /** The current contents; created from `init` (and saved, so keys stay stable) on first use. */
  read(): T {
    try {
      return JSON.parse(readFileSync(this.filePath, "utf-8")) as T;
    } catch {
      const fresh = this.init();
      this.write(fresh);
      return fresh;
    }
  }

  /** Node runs route handlers on one thread, so a sync update cannot interleave. */
  update<R>(mutate: (data: T) => R): R {
    const data = this.read();
    const result = mutate(data);
    this.write(data);
    return result;
  }

  private write(data: T): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, this.filePath);
  }
}

/** Where the simulated TideCloak and network keep their state. Never the operator's store. */
export function simDir(): string {
  return process.env.ERRAND_SIM_DIR || join(process.cwd(), "data", "sim");
}
