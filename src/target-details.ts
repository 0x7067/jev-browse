export function targetDetails(node: number): string {
  return `(() => {
    const e=window.__jevFast?.node(${node});
    if (!e) return null;
    const d=e.closest('dialog,[role="dialog"],[aria-modal="true"]');
    const r=e.getBoundingClientRect();
    return {
      tag:e.tagName, id:e.id, role:e.getAttribute('role'),
      aria_label:e.getAttribute('aria-label'), title:e.getAttribute('title'),
      text:(e.textContent||'').trim().slice(0,240),
      html:e.outerHTML.slice(0,2000), document_url:e.ownerDocument.URL,
      dialog:d ? {label:d.getAttribute('aria-label'),text:(d.textContent||'').trim().slice(0,1000)} : null,
      rect:{x:r.x,y:r.y,width:r.width,height:r.height}
    };
  })()`;
}
