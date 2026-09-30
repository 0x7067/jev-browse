export function doubleClickScript(node: number): string {
  return `(() => {
    const e=window.__jevFast?.node(${node});
    if (!e?.isConnected || e.matches(':disabled') || e.closest('[aria-disabled="true"],[inert]')) throw new Error('Double-click target is unavailable');
    const w=e.ownerDocument.defaultView,r=e.getBoundingClientRect();
    const base={bubbles:true,cancelable:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2,button:0};
    for (const detail of [1,2]) {
      for (const type of ['pointerdown','mousedown','pointerup','mouseup','click']) {
        const Event=type.startsWith('pointer')?w.PointerEvent:w.MouseEvent;
        e.dispatchEvent(new Event(type,{...base,detail,buttons:type.endsWith('down')?1:0}));
      }
    }
    e.dispatchEvent(new w.MouseEvent('dblclick',{...base,detail:2,buttons:0}));
  })()`;
}
