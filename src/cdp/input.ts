import {
  StalePage,
  type ActResult,
  type JsonObject,
  type ObservedAction,
  type PageState,
} from "../types.ts";
import { sleep } from "./socket.ts";
import type { CdpEvents } from "./events.ts";

export interface ActHost {
  session: string;
  afterInput: ObservedAction | null;
  selectAllModifier: number;
  events: CdpEvents;
  call<T>(method: string, params?: JsonObject): Promise<T>;
  evaluate<T>(expression: string, awaitPromise?: boolean): Promise<T | undefined>;
  fresh(
    page: PageState,
    action?: ObservedAction,
    level?: "full" | "page" | "structure",
  ): Promise<boolean>;
  settle(budgetMs: number, quietMs?: number): Promise<void>;
  pendingNav(): boolean;
}

interface KeyEventParams {
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  text?: string;
}

const KEYS: ReadonlyMap<string, KeyEventParams> = new Map(
  Object.entries({
    enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
    tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
    escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
    backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
    delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
    arrowup: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
    arrowdown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
    arrowleft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
    arrowright: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
    home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
    end: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
    pageup: { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 },
    pagedown: { key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 },
    space: { key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " },
  }),
);

const KEY_TYPED_INPUTS = new Set(["date", "time", "datetime-local", "month", "week"]);

export const VIEWPORT_W = 1120;

export const VIEWPORT_H = 780;

export const SCROLL_DELTA = Math.round(VIEWPORT_H * 0.8);

export const WAIT_BUDGET_MS = 15_000;

export const QUIET_MS = 250;

export const WAIT_POLL_MS = 100;

export const DRAG_STEPS = 8;

export async function act(
  host: ActHost,
  action: ObservedAction,
  page: PageState,
  text?: string | null,
): Promise<ActResult> {
    if (!(await host.fresh(page, action, "page"))) {
      throw new StalePage("Page changed since this decision. Observe again.");
    }

    const kind = action.kind;

    if (kind === "wait") {
      const deadline = Date.now() + WAIT_BUDGET_MS;

      for (;;) {
        if (!(await host.fresh(page))) break;

        if (host.pendingNav() || host.events.pendingCount(host.session) > 0) {
          if (Date.now() >= deadline) break;
          await sleep(WAIT_POLL_MS);
          continue;
        }

        await host.settle(Math.max(0, deadline - Date.now()), QUIET_MS);
        break;
      }

      return { executed: action.id };
    }

    if (kind === "scroll" && action.node !== undefined) {
      const moved = await host.evaluate(
        `(() => {
          const e=window.__jevFast?.node(${JSON.stringify(action.node)});
          if (!e?.isConnected) return null;
          const b=e.scrollTop;
          e.scrollBy({top:${JSON.stringify(action.delta ?? SCROLL_DELTA)},behavior:'instant'});
          return e.scrollTop!==b;
        })()`,
      ).catch(() => null);

      if (moved === null) throw new StalePage("Scroll region is gone. Observe again.");

      host.afterInput = action;

      return { executed: action.id };
    }

    if (kind === "scroll") {
      await host.evaluate(
        `(delta => {
          const sign=Math.sign(delta)||1;
          const dy=Math.round(sign*innerHeight*0.8);
          const moved=(n,by)=>{const b=n.scrollTop;n.scrollBy({top:by,behavior:'instant'});return n.scrollTop!==b;};
          for (const fx of [0.5,0.3,0.7,0.15,0.85]) {
            const x=Math.round(innerWidth*fx), y=Math.round(innerHeight*0.6);
            const e=window.__jevFast?.deepHit(document,x,y);
            for (let n=e; n && n!==document.documentElement && n!==document.body; n=n.parentElement||n.getRootNode()?.host) {
              if (n.tagName==='IFRAME') {
                try { const w=n.contentWindow, b=w.scrollY; w.scrollBy({top:dy,behavior:'instant'}); if (w.scrollY!==b) return 'iframe'; } catch {}
                continue;
              }
              const cs=getComputedStyle(n);
              if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight>n.clientHeight+1 && moved(n,dy)) return 'element';
            }
          }
          const b=scrollY; scrollBy({top:dy,behavior:'instant'});
          return scrollY!==b ? 'window' : 'none';
        })(${JSON.stringify(action.delta ?? SCROLL_DELTA)})`,
      ).catch(() => null);

      host.afterInput = action;

      return { executed: action.id };
    }

    if (kind === "back" || kind === "forward") {
      await host.evaluate(`history.${kind === "back" ? "back" : "forward"}()`);

      return { executed: action.id };
    }

    if (kind === "press") {
      const key = KEYS.get(String(action.key));

      if (!key) throw new Error(`Unknown key ${action.key}`);
      await host.call("Input.dispatchKeyEvent", { type: "keyDown", ...key });
      await host.call("Input.dispatchKeyEvent", { type: "keyUp", ...key });
      host.afterInput = action;

      return { executed: action.id };
    }

    if (action.node === undefined) throw new Error("Invalid observed node");
    let target: { x: number; y: number; type?: string; why?: string } | null | undefined;

    try {
      target = await host.evaluate(`(action => {
        const e=window.__jevFast?.node(action.node);
        // Visibility alone doesn't decide clickability — opacity:0 custom
        // controls fail checkVisibility yet win their own hit test. The
        // covered check below is the real arbiter.
        if (!e?.isConnected) return {why:'gone'};
        if (e.matches(':disabled') || e.closest('[aria-disabled="true"],[inert]')) return {why:'disabled'};
        if (action.kind==='fill' && (e.readOnly || e.getAttribute('aria-readonly')==='true')) return {why:'readonly'};
        const d=e.ownerDocument, w=d.defaultView||window;
        let r=e.getBoundingClientRect(), lx=r.x+r.width/2, ly=r.y+r.height/2;
        // Observed targets drift out of the viewport between snapshot and input
        // (async layout, sticky chrome). One instant re-scroll beats a stale-page
        // re-decision; a still-offscreen or covered target stays fatal.
        if (r.width && r.height && (lx<0 || ly<0 || lx>=w.innerWidth || ly>=w.innerHeight)) {
          e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
          r=e.getBoundingClientRect(); lx=r.x+r.width/2; ly=r.y+r.height/2;
        }
        if (!r.width || !r.height || lx<0 || ly<0 || lx>=w.innerWidth || ly>=w.innerHeight) return {why:'offscreen'};
        const c=window.__jevFast, deepHit=()=>c.deepHit(d,lx,ly);
        let hit=deepHit();
        // A hit on the target's own ancestor is clipping by a scroll
        // container (a long suggestion list, an overflow pane), not cover:
        // bring the target into view once and test again.
        if (hit && hit!==e && c.composedContains(hit,e)) {
          e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
          r=e.getBoundingClientRect(); lx=r.x+r.width/2; ly=r.y+r.height/2;
          hit=deepHit();
        }
        // Not covered when the hit is the target or inside it across shadow
        // boundaries, or is one of e's own shadow hosts. An unrelated overlay
        // in the same shadow root still counts as covered.
        const hosts=new Set(); for (let sr=e.getRootNode();sr instanceof ShadowRoot;sr=sr.host.getRootNode()) hosts.add(sr.host);
        if (!c.composedContains(e,hit) && !hosts.has(hit)) return {why:'covered by '+(hit?hit.tagName.toLowerCase():'nothing')};
        if (action.kind==='select') {
          if (e.tagName!=='SELECT' || ![...e.options].some(o=>o.value===action.value &&
              !o.disabled && !o.closest('optgroup[disabled]'))) return {why:'no such option'};
          e.value=action.value;
          e.dispatchEvent(new Event('input',{bubbles:true}));
          e.dispatchEvent(new Event('change',{bubbles:true}));
        }
        const fx=action.frame?.x||0, fy=action.frame?.y||0;
        return {x:lx+fx,y:ly+fy,type:e.tagName==='INPUT'?e.type:''};
      })(${JSON.stringify(action)})`);
    } catch (error) {
      if (kind === "select") {
        throw new Error("Dropdown execution was interrupted; inspect before retrying.");
      }

      throw error;
    }

    if (target === null || target === undefined || target.why !== undefined) {
      if (kind === "select") {
        throw new Error("Dropdown execution was not confirmed; inspect before retrying.");
      }

      const why = String(target?.why ?? "");

      if (
        (kind === "click" || kind === "context" || kind === "hover") &&
        (why === "offscreen" || why.startsWith("covered"))
      ) {
        return await domDispatch(host,action, text);
      }

      throw new StalePage(`Target ${JSON.stringify(action.label.slice(0, 40))} ${target?.why ?? "changed"}. Observe again.`);
    }

    if (kind === "fill" && target.type === "file") {
      const doc = await host.call<{ root: { nodeId: number } }>("DOM.getDocument", { depth: 1 });

      const found = await host.call<{ nodeId: number }>("DOM.querySelector", {
        nodeId: doc.root.nodeId,
        selector: `input[data-jev-node="${action.node}"]`,
      });

      if (!found.nodeId) throw new StalePage("File input no longer addressable. Observe again.");
      await host.call("DOM.setFileInputFiles", { files: [text ?? ""], nodeId: found.nodeId });
      host.afterInput = action;

      return { executed: action.id };
    }

    if (kind === "hover") {
      await host.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y });
      host.afterInput = action;

      return { executed: action.id };
    }

    if (kind === "drag" && action.dragTo !== undefined) {
      const destFrame = page.actions.find((a) => a.node === action.dragTo)?.frame;

      const dest = await host.evaluate<{ x: number; y: number } | null>(`(() => {
        const e=window.__jevFast?.node(${action.dragTo});
        if (!e?.isConnected) return null;
        const r=e.getBoundingClientRect();
        return {x:r.x+r.width/2+${destFrame?.x ?? 0},y:r.y+r.height/2+${destFrame?.y ?? 0}};
      })()`);

      if (!dest) throw new StalePage("Drag destination changed. Observe again.");

      await host.call("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: target.x,
        y: target.y,
        button: "left",
        clickCount: 1,
      });

      for (let i = 1; i <= DRAG_STEPS; i++) {
        await host.call("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: target.x + ((dest.x - target.x) * i) / DRAG_STEPS,
          y: target.y + ((dest.y - target.y) * i) / DRAG_STEPS,
          button: "left",
          buttons: 1,
        });
      }

      await host.call("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: dest.x,
        y: dest.y,
        button: "left",
        clickCount: 1,
      });
      host.afterInput = action;

      return { executed: action.id };
    }

    if (kind !== "select") {
      for (const type of ["mousePressed", "mouseReleased"]) {
        await host.call("Input.dispatchMouseEvent", {
          type,
          x: target.x,
          y: target.y,
          button: kind === "context" ? "right" : "left",
          clickCount: 1,
        });
      }

      if (kind === "click" || kind === "context" || kind === "fill") {
        await host.evaluate(`(() => {
          const e=window.__jevFast?.node(${action.node});
          if (!e?.isConnected) return;
          const r=e.getBoundingClientRect(), w=e.ownerDocument.defaultView||window;
          if (r.top<0 || r.left<0 || r.bottom>w.innerHeight || r.right>w.innerWidth)
            e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
        })()`).catch(() => {});
      }

      if (kind === "fill") {
        if (target.type && KEY_TYPED_INPUTS.has(target.type)) {
          for (const ch of text ?? "") {
            await host.call("Input.dispatchKeyEvent", { type: "char", text: ch });
          }
        } else {
          const modifiers = host.selectAllModifier;
          await host.call("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "a",
            code: "KeyA",
            modifiers,
            commands: ["selectAll"],
          });
          await host.call("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: "a",
            code: "KeyA",
            modifiers,
          });
          await host.call("Input.insertText", { text: text ?? "" });
        }
      }
    }

    host.afterInput = action;

    return { executed: action.id };
  }


export async function domClick(
  host: ActHost,
  action: ObservedAction,
  page: PageState,
  text?: string | null,
): Promise<ActResult> {
    if (!(await host.fresh(page, action))) {
      throw new StalePage("Page changed since this decision. Observe again.");
    }

    return await domDispatch(host,action, text);
  }

export async function domDispatch(
  host: ActHost,
  action: ObservedAction,
  text?: string | null,
): Promise<ActResult> {
    if (!action.node) {
      return { executed: action.id };
    }

    if (action.kind === "fill") {
      await host.evaluate(
        `(() => {
          const e=window.__jevFast?.node(${action.node});
          if (!e?.isConnected) return "stale";
          if (e.isContentEditable) {
            e.innerText=${JSON.stringify(text ?? "")};
          } else {
            const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement:HTMLInputElement;
            Object.getOwnPropertyDescriptor(proto.prototype,'value').set.call(e,${JSON.stringify(text ?? "")});
          }
          e.dispatchEvent(new Event('input',{bubbles:true}));
          e.dispatchEvent(new Event('change',{bubbles:true}));
          return "ok";
        })()`,
      );
      host.afterInput = action;

      return { executed: action.id };
    }

    if (action.kind === "drag" && action.dragTo !== undefined) {
      await host.evaluate(
        `(() => {
          const c=window.__jevFast;
          const src=c?.node(${action.node}), dst=c?.node(${action.dragTo});
          if (!src || !dst) return "stale";
          const dt=new DataTransfer();
          const fire=(t,el)=>el.dispatchEvent(new DragEvent(t,{bubbles:true,cancelable:true,dataTransfer:dt}));
          fire("dragstart",src); fire("dragenter",dst); fire("dragover",dst);
          fire("drop",dst); fire("dragend",src);
          return "ok";
        })()`,
      );
      host.afterInput = action;

      return { executed: action.id };
    }

    const types =
      action.kind === "hover"
        ? ["mouseover", "mousemove"]
        : action.kind === "context"
          ? ["pointerdown", "mousedown", "pointerup", "mouseup", "contextmenu"]
          : ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];

    await host.evaluate(
      `(() => {
        const e=window.__jevFast?.node(${action.node});
        if (!e) return "stale";
        const r=e.getBoundingClientRect();
        const opts={bubbles:true,cancelable:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2,button:${action.kind === "context" ? 2 : 0}};
        for (const t of ${JSON.stringify(types)}) {
          const Ev = t.startsWith("pointer") ? PointerEvent : MouseEvent;
          e.dispatchEvent(new Ev(t,opts));
        }
        return "ok";
      })()`,
    );
    host.afterInput = action;

    return { executed: action.id };
  }

