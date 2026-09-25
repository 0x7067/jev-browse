  cache.pageKey=()=>[performance.timeOrigin,location.href,scrollX,scrollY,innerWidth,innerHeight,
    [...document.querySelectorAll('input,textarea,select')]
      .flatMap(e=>safe(e)?[[e.tagName,e.type||null,name(e),e.value,e.checked,e.selectedIndex,e.disabled,e.readOnly]]:[])];

  cache.guard=e=>{
    if (!e?.isConnected || !visible(e)) return null;
    const r=e.getBoundingClientRect();

    return [identity(e),role(e),name(e),e.value??null,e.checked??null,e.selectedIndex??null,
      e.readOnly??null,e.matches(':disabled'),e.getAttribute('aria-disabled'),
      e.getAttribute('aria-expanded'),e.getAttribute('aria-checked'),e.getAttribute('aria-selected'),
      e.getAttribute('aria-pressed'),e.getAttribute('aria-valuenow'),e.getAttribute('aria-valuemin'),
      e.getAttribute('aria-valuemax'),e.getAttribute('href'),
      [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]];
  };

  const MAX_ACTIONS=500;

  const actions=[];

  const deepHit=cache.deepHit=(doc,x,y)=>{
    let hit=doc.elementFromPoint(x,y);

    while (hit?.shadowRoot) {
      const deeper=hit.shadowRoot.elementFromPoint(x,y);

      if (!deeper || deeper===hit) break;
      hit=deeper;
    }

    return hit;
  };

  const hoverZones=new Map();

  const INTERACTIVE='a[href],button,select,input,textarea,summary,'+
    roles.map(role=>'[role="'+role+'"]').join(',');

  const hoverable=e=>e.matches(hoverSel)||listenedHover(e);

  const gather=(root,fx,fy,depth)=>{
    if (depth>4) return;

    for (const e of root.querySelectorAll('*')) {
      if (e.shadowRoot) gather(e.shadowRoot,fx,fy,depth+1);

      if ((e.tagName==='DIALOG' && e.open && e.matches(':modal')) ||
          (e.matches('[role="dialog"],[role="alertdialog"]') && e.ariaModal==='true')) {
        const doc=e.ownerDocument;
        modalsByDoc.set(doc,[...(modalsByDoc.get(doc)??[]),e]);
      }

      const dropZone=hasDropProp(e);

      const clickCapable = dropZone || e.matches(selector) || hasHandlerProp(e) ||
          listenedClick(e) || e.matches(tabindexSel);

      const isCandidate = dropZone || e.matches(selector) || hasHandlerProp(e) ||
          listenedClick(e) || listenedHover(e) ||
          (e.matches(tabindexSel) &&
            (e.matches('[onclick],[onkeydown],[onkeypress],[onmousedown],[jsaction]') ||
              (e.ownerDocument.defaultView||window).getComputedStyle(e).cursor==='pointer' ||
              e.querySelector(INTERACTIVE)));

      if (!isCandidate && panes.size < 10 && e.scrollHeight > e.clientHeight + 60 &&
          e.clientHeight >= 80 && e.clientHeight < innerHeight * 0.95 &&
          ['auto','scroll'].includes((e.ownerDocument.defaultView||window).getComputedStyle(e).overflowY) &&
          e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) {
        panes.set(e,{fx,fy});
      }

      if (!isCandidate) continue;

      let vis = visible(e);

      if (!vis && e.matches(INTERACTIVE)) {
        const r = e.getBoundingClientRect();
        const d = e.ownerDocument, w = d.defaultView;
        const vw = w ? w.innerWidth : innerWidth, vh = w ? w.innerHeight : innerHeight;

        const ix0 = Math.max(r.x,0), iy0 = Math.max(r.y,0),
              ix1 = Math.min(r.x+r.width,vw), iy1 = Math.min(r.y+r.height,vh);

        if (r.width > 0 && r.height > 0 && ix1 > ix0 && iy1 > iy0) {
          const hit = deepHit(d,(ix0+ix1)/2, (iy0+iy1)/2);
          vis = hit === e || e.contains(hit) || hit?.closest?.('label')?.control === e;
        }
      }

      if (!safe(e) || !vis || e.matches(':disabled') || e.closest('[aria-disabled="true"]')) {
        if (!vis && safe(e) && !e.matches(':disabled') && !e.closest('[aria-disabled="true"]') &&
            e.matches(INTERACTIVE) && hoverZones.size < 24) {
          let a=e.parentElement, hops=0;

          while (a && hops++<6 && !hoverZones.has(a)) {
            if (visible(a)) {
              const ar=a.getBoundingClientRect();
              const ax=fx+ar.x+ar.width/2, ay=fy+ar.y+ar.height/2;

              if (ar.width>0 && ar.height>0 && ar.width<=800 && ar.height<=400 &&
                  ax>=0 && ay>=0 && ax<innerWidth && ay<innerHeight) {
                hoverZones.set(a,{fx,fy});
                break;
              }
            }

            a=a.parentElement;
          }
        }

        continue;
      }

      const r=e.getBoundingClientRect(), rname=role(e);

      if (!rname || r.width<=0 || r.height<=0) continue;

      if (fx+r.x>=innerWidth || fy+r.y>=innerHeight ||
          fx+r.x+r.width<=0 || fy+r.y+r.height<=0) {
        if (fy+r.y>=innerHeight && belowFold.length<300 &&
            (rname==='link' || rname==='button'))
          belowFold.push({e,root,r,rname,fx,fy});

        continue;
      }

      if (rname==='gridcell' && e.querySelector('button,[role="button"]')) continue;

      const frame=(fx||fy)?{x:fx,y:fy}:undefined;
      const shadow=e.getRootNode() instanceof ShadowRoot;

      const accessibleName=name(e);

      const base={node:identity(e),role:rname,label:(accessibleName||rname).slice(0,240),
        rect:{x:fx+r.x,y:fy+r.y,w:r.width,h:r.height}};

      cache.sig.set(base.node,[root,rname,accessibleName]);

      if (e.getAttribute('draggable')==='true' || e.ondragstart || e.matches(dragHandleSel)) {
        base.draggable=true;

        const sibs=[...(e.parentElement?.children||[])].filter(s=>
          s.getAttribute('draggable')==='true' || s.ondragstart || s.matches(dragHandleSel));

        const at=sibs.indexOf(e);

        if (at>=0 && sibs.length>1) base.position=(at+1)+' of '+sibs.length;
      }

      if (e.hasAttribute('oncontextmenu') || e.oncontextmenu) base.contextMenu=true;

      if (dropZone) base.dropZone=true;

      const cls=(e.getAttribute('class')||'').trim().replace(/\s+/g,' ');

      if (cls) base.cls=cls.slice(0,80);

      if (frame) base.frame=frame;

      if (shadow) base.shadow=true;

      for (const key of ['checked','selected','expanded','pressed','valuenow','valuemin','valuemax']) {
        const value=e.getAttribute('aria-'+key);

        if (value!==null) base[key]=value;
      }

      if (e.ariaCurrent) base.current=e.ariaCurrent;

      if (e.required===true || e.ariaRequired==='true') base.required=true;

      const rel=e.getAttribute('rel');

      if (rel) base.rel=rel;

      if (rname==='link') {
        const href=e.getAttribute('href');

        if (href && href!=='#' && !href.startsWith('javascript:')) base.href=href.slice(0,120);
      }

      const landmark=landmarkOf(e);

      if (landmark) base.landmark=landmark;

      if (['checkbox','radio'].includes(e.type)) base.checked=String(e.checked);

      if (e.type==='file') e.setAttribute('data-jev-node', String(base.node));

      if (e.tagName==='SELECT') {
        for (const o of e.options) if (!o.selected && !o.disabled && !o.closest('optgroup[disabled]'))
          actions.push({...base,kind:'select',value:o.value,
            current_value:[...e.selectedOptions].map(o=>o.label).join(', '),label:base.label+' → '+o.label});
      } else {
        const editable=!e.readOnly && e.getAttribute('aria-readonly')!=='true' &&
          (['textbox','searchbox','spinbutton'].includes(rname) ||
            (rname==='combobox' && ['INPUT','TEXTAREA'].includes(e.tagName)));

        const value='value' in e ? String(e.value) :
          e.isContentEditable || rname==='combobox' ? e.innerText.trim() : '';

        if (e.type==='file') {
          actions.push({...base,kind:'fill',value});
        } else {
          actions.push({...base,kind:editable?'fill':clickCapable?'click':'hover',value});

          if (editable) actions.push({...base,kind:'click',value,label:'Focus '+base.label});
        }
      }

      if (clickCapable && hoverable(e) && !e.querySelector(selector))
        actions.push({...base,kind:'hover',value:undefined,label:'Hover '+base.label});
    }

    for (const f of root.querySelectorAll('iframe,frame')) {
      try {
        const d=f.contentDocument;

        if (!d?.body || !visible(f)) continue;
        const r=f.getBoundingClientRect();
        gather(d,fx+r.x,fy+r.y,depth+1);
      } catch { }
    }
  };
