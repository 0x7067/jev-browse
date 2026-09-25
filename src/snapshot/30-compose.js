  const composedContains=cache.composedContains=(a,n)=>{
    for (let x=n;x;) {
      if (x===a) return true;
      const r=x.getRootNode();
      x=x.parentElement??(r instanceof ShadowRoot?r.host:null);
    }

    return false;
  };

  const modalsByDoc=new Map();

  const behindModal=e=>{
    const modals=modalsByDoc.get(e.ownerDocument);

    return modals!==undefined && !modals.some(m=>composedContains(m,e));
  };

  const panes=new Map();

  const belowFold=[];

  gather(document,0,0,0);

    for (const {e,root,r,rname,fx,fy} of belowFold.slice(0,120)) {
      const accessibleName=name(e);
      const frame=(fx||fy)?{x:fx,y:fy}:undefined;

      const base={node:identity(e),role:rname,label:(accessibleName||rname).slice(0,240),
        rect:{x:fx+r.x,y:fy+r.y,w:r.width,h:r.height},below:true};

      cache.sig.set(base.node,[root,rname,accessibleName]);

      const rel=e.getAttribute('rel');

      if (rel) base.rel=rel;

      const href=e.getAttribute('href');

      if (rname==='link' && href && href!=='#' && !href.startsWith('javascript:'))
        base.href=href.slice(0,120);

      if (frame) base.frame=frame;

      if (e.getRootNode() instanceof ShadowRoot) base.shadow=true;

      actions.push({...base,kind:'click'});
    }

  for (const [e,off] of panes) {
    const r=e.getBoundingClientRect();

    if (!r.width || !r.height) continue;

    const nm=(name(e)||(e.getAttribute('class')||'').split(/\s+/).slice(0,3).join(' ')||e.tagName.toLowerCase())
      .replace(/\s+/g,' ').trim().slice(0,80);

    const base={node:identity(e),role:'region',
      rect:{x:off.fx+r.x,y:off.fy+r.y,w:r.width,h:r.height}};

    if (off.fx||off.fy) base.frame={x:off.fx,y:off.fy};

    if (e.getRootNode() instanceof ShadowRoot) base.shadow=true;

    const delta=Math.round(e.clientHeight*0.8);

    if (e.scrollTop+e.clientHeight<e.scrollHeight-2)
      actions.push({...base,id:'scroll_pane_down_'+base.node,kind:'scroll',delta,label:'Scroll "'+nm+'" down'});

    if (e.scrollTop>2)
      actions.push({...base,id:'scroll_pane_up_'+base.node,kind:'scroll',delta:-delta,label:'Scroll "'+nm+'" up'});
  }

  if (modalsByDoc.size) {
    for (let i=actions.length-1;i>=0;i--) if (behindModal(cache.nodes.get(actions[i].node))) actions.splice(i,1);

    for (const a of hoverZones.keys()) if (behindModal(a)) hoverZones.delete(a);
  }

  {
    const offered=new Set();

    for (const a of actions) {
      const el=a.node===undefined||a.kind==='hover' ? null : cache.nodes.get(a.node);

      if (el) offered.add(el);
    }

    const drop=new Set();

    for (const a of actions) {
      if (a.kind!=='click') continue;
      const e=a.node===undefined ? null : cache.nodes.get(a.node);

      if (!e || drop.has(a.node) || hasDropProp(e) ||
          e.matches(INTERACTIVE+',[draggable="true"],[contenteditable="true"]') ||
          e.hasAttribute('oncontextmenu') || e.oncontextmenu) continue;

      const r=e.getBoundingClientRect(), area=r.width*r.height;
      let covered=0;

      for (const d of e.querySelectorAll('*')) {
        if (!offered.has(d)) continue;
        const dr=d.getBoundingClientRect();

        covered+=Math.max(0,Math.min(r.right,dr.right)-Math.max(r.left,dr.left))*
          Math.max(0,Math.min(r.bottom,dr.bottom)-Math.max(r.top,dr.top));

        if (covered>=area*0.6) break;
      }

      if (area>0 && covered>=area*0.6) drop.add(a.node);
    }

    for (let i=actions.length-1;i>=0;i--) if (drop.has(actions[i].node)) actions.splice(i,1);
  }

  cache.node=id=>{
    const e=cache.nodes.get(id);

    if (e?.isConnected) return e;
    const sig=cache.sig.get(id);

    if (!sig) return e;
    const [root,r,n]=sig;
    let found=null;

    try {
      for (const c of root.querySelectorAll(selector)) {
        if (role(c)!==r || name(c)!==n) continue;

        if (found) return e;
        found=c;
      }
    } catch { return e; }

    if (!found) return e;

    if (!cache.ids.has(found)) { cache.ids.set(found,id); cache.nodes.set(id,found); }

    return found;
  };

  for (const [a,off] of hoverZones) {
    const ar=a.getBoundingClientRect();

    const base={node:identity(a),role:'group',
      label:('Hover '+((name(a)||'element').replace(/\s+/g,' ').trim())).slice(0,240),
      rect:{x:off.fx+ar.x,y:off.fy+ar.y,w:ar.width,h:ar.height}};

    if (off.fx||off.fy) base.frame={x:off.fx,y:off.fy};

    if (a.getRootNode() instanceof ShadowRoot) base.shadow=true;
    actions.push({...base,kind:'hover'});
  }

  const byLabel=new Map();

  for (const a of actions) {
    if (!a.node) continue;
    const key=a.kind+'|'+a.label;
    byLabel.set(key,[...(byLabel.get(key)??[]),a]);
  }

  for (const group of byLabel.values()) {
    if (group.length<2) continue;

    for (const a of group) {
      const e=cache.nodes.get(a.node);

      if (!e) continue;

      const scope=e.closest('li,article,tr,dd,figure,details,section[aria-label],'+
        '[role="listitem"],[role="row"],[role="article"],[role="group"],[role="figure"]');

      if (!scope) continue;

      const ctx=scope.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"],label,caption,legend,dt,'+
        'td:first-child,th:first-child,strong,b')
        ?.textContent?.trim().replace(/\s+/g,' ');

      if (ctx && ctx.length<=80 && !a.label.includes(ctx)) a.label=a.label+' — '+ctx;
    }
  }
