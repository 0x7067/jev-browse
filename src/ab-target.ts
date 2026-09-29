import { doubleClickScript } from "./double-click.ts";
import type { ObservedAction } from "./types.ts";

export interface TaggedTarget {
  inputType: string;
  frames: string[];
  point: { x: number; y: number };
}

export type TargetProbe = TaggedTarget | { blocked: true } | null;

export function tagTarget(action: ObservedAction): string {
  return `(action => {
    const cache=window.__jevFast, e=cache?.node(action.node);
    if (!e?.isConnected || e.matches(':disabled') || e.closest('[aria-disabled="true"],[inert]')) return null;
    if (action.kind==='fill' && (e.readOnly || e.getAttribute('aria-readonly')==='true')) return null;
    const hit = target => {
      const doc=target.ownerDocument, win=doc.defaultView, r=target.getBoundingClientRect();
      const x=r.x+r.width/2, y=r.y+r.height/2;
      return r.width>0 && r.height>0 && x>=0 && y>=0 && x<win.innerWidth && y<win.innerHeight &&
        cache.composedContains(target,cache.deepHit(doc,x,y));
    };
    if (!hit(e)) e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    if (action.kind!=='select' && !hit(e)) return {blocked:true};
    if (action.kind==='select' && (e.tagName!=='SELECT' ||
      ![...e.options].some(o=>o.value===String(action.value) && !o.disabled && !o.closest('optgroup[disabled]')))) return null;
    const frames=[];
    for (let w=e.ownerDocument.defaultView;w!==window;w=w.parent) {
      const frame=w.frameElement;
      if (!frame) return null;
      if (!hit(frame)) return {blocked:true};
      frames.unshift(frame);
    }
    e.setAttribute('data-jev-node',String(action.node));
    return {
      inputType:e.tagName==='INPUT'?e.type:'',
      point:{x:e.getBoundingClientRect().x+e.getBoundingClientRect().width/2+(action.frame?.x||0),y:e.getBoundingClientRect().y+e.getBoundingClientRect().height/2+(action.frame?.y||0)},
      frames:frames.map((frame,i)=>{
        const value='frame-'+action.node+'-'+i;
        frame.setAttribute('data-jev-node',value);
        return '[data-jev-node="'+value+'"]';
      })
    };
  })(${JSON.stringify(action)})`;
}

export function clearTarget(node: number): string {
  return `(() => {
    const e=window.__jevFast?.node(${node});
    if (!e) return;
    e.removeAttribute('data-jev-node');
    for (let w=e.ownerDocument.defaultView;w && w!==window;w=w.parent) w.frameElement?.removeAttribute('data-jev-node');
  })()`;
}

export async function actBoundary(
  action: ObservedAction,
  target: TaggedTarget,
  text: string | null | undefined,
  run: (args: string[]) => Promise<void>,
  evaluate: (expression: string) => Promise<void>,
): Promise<boolean> {
  if (!action.shadow && !target.frames.length) return false;

  if (action.kind === "double_click" && action.node !== undefined) {
    await evaluate(doubleClickScript(action.node));

    return true;
  }

  if (action.kind === "click" || action.kind === "hover") {
    await run(["mouse", "move", String(Math.round(target.point.x)), String(Math.round(target.point.y))]);

    if (action.kind === "click") {
      await run(["mouse", "down"]);
      await run(["mouse", "up"]);
    }

    return true;
  }

  if (action.kind === "fill" && target.inputType !== "file") {
    await evaluate(`(() => {
      const e=window.top.__jevFast.node(${action.node});
      e.focus();
      if (e.isContentEditable) {
        const range=e.ownerDocument.createRange();range.selectNodeContents(e);
        const selection=e.ownerDocument.getSelection();selection.removeAllRanges();selection.addRange(range);
      } else e.select();
    })()`);
    await run(["keyboard", "inserttext", text ?? ""]);

    return true;
  }

  if (action.kind === "select") {
    await evaluate(`(() => {
      const e=window.top.__jevFast.node(${action.node}), w=e.ownerDocument.defaultView;
      e.value=${JSON.stringify(String(action.value))};
      e.dispatchEvent(new w.Event('input',{bubbles:true}));
      e.dispatchEvent(new w.Event('change',{bubbles:true}));
    })()`);

    return true;
  }

  return false;
}
