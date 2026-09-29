import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const LISTENER_TRACKING = `(() => {
            const map = new WeakMap();
            const orig = EventTarget.prototype.addEventListener;

            EventTarget.prototype.addEventListener = function (type, listener, options) {
              if (typeof type === "string" && this !== null && this !== undefined &&
                  (this instanceof Node || this === window)) {
                let s = map.get(this);

                if (!s) map.set(this, (s = new Set()));

                s.add(type);
              }

              return orig.call(this, type, listener, options);
            };

            Object.defineProperty(window, "__jevListeners", { value: map, configurable: true });
          })()`;

export function createListenerInit() {
  const directory = mkdtempSync(join(tmpdir(), "jev-listeners-"));
  const path = join(directory, "listeners.js");
  writeFileSync(path, LISTENER_TRACKING);

  return { path, dispose: () => rmSync(directory, { recursive: true, force: true }) };
}
