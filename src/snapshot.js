(() => {
  if (!document.body) return null;
  const cache = window.__jevFast ||= {ids:new WeakMap(), nodes:new Map(), next:1};

  const identity = e => {
    if (!cache.ids.has(e)) cache.ids.set(e,cache.next++);
    const id=cache.ids.get(e); cache.nodes.set(id,e);

 return id;
  };

  for (const [id,e] of cache.nodes) if (!e.isConnected) cache.nodes.delete(id);
  const safe = e => e.type !== 'hidden';

  const visible = e => !e.closest('[aria-hidden="true"],[inert]') &&
    e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});

  // Data-only descendants contribute nothing to an accessible name — inline
  // scripts inside links would otherwise name the element with their source.
  const SKIP_NAME = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE']);

  const name = (e,seen=new Set()) => {
    if (!e || seen.has(e)) return '';
    seen.add(e);
    const doc=e.ownerDocument||document;

    const referenced=(e.getAttribute('aria-labelledby')||'').split(/\s+/)
      .map(id=>name(doc.getElementById(id),seen)).filter(Boolean).join(' ');

    return referenced || e.getAttribute('aria-label') ||
      [...(e.labels||[])].flatMap(l=>{const s=name(l,seen);

return s?[s]:[]}).join(' ') ||
      (['button','submit','reset'].includes(e.type) ? e.value : '') || e.getAttribute('alt') ||
      (e.tagName==='INPUT' ? '' : [...e.childNodes].map(n=>n.nodeType===3 ? n.textContent :
        n.nodeType===1 && !SKIP_NAME.has(n.tagName) && n.getAttribute('aria-hidden')!=='true' ? name(n,seen) : '').join(' ').trim()) ||
      e.getAttribute('title') || e.getAttribute('placeholder') || '';
  };

  const roles=['button','link','checkbox','radio','switch','tab','menuitem','menuitemradio',
    'option','gridcell','combobox','textbox','searchbox','spinbutton'];

  // Hover candidates are indexed too: menus and popups often live on elements
  // with no interactive role until hovered.
  const hoverSel='[aria-haspopup],[onmouseover],[class*="menu"],[class*="dropdown"],'+
    '[class*="tooltip"],[class*="hover"]';

  const selector='a[href],button,input,textarea,select,summary,[contenteditable="true"],'+
    roles.map(role=>'[role="'+role+'"]').join(',')+','+hoverSel;

  const role = e => {
    const explicit=e.getAttribute('role');

    if (roles.includes(explicit)) return explicit;

    if (e.tagName==='BUTTON' || e.tagName==='SUMMARY') return 'button';

    if (e.tagName==='A') return 'link';

    if (e.tagName==='SELECT') return 'combobox';

    if (e.tagName==='TEXTAREA' || e.isContentEditable) return 'textbox';

    if (e.tagName==='INPUT') {
      if (['checkbox','radio'].includes(e.type)) return e.type;

      if (['button','submit','reset','image'].includes(e.type)) return 'button';

      if (e.type==='search') return 'searchbox';

      if (e.type==='number') return 'spinbutton';

      if (e.type==='range') return 'slider';

      if (['text','email','url','tel','password','date','time','datetime-local',
           'month','week','file'].includes(e.type)) return 'textbox';
    }

    if (e.matches(hoverSel)) return 'button';

    return null;
  };

  cache.pageKey=()=>[performance.timeOrigin,location.href,scrollX,scrollY,innerWidth,innerHeight,
    [...document.querySelectorAll('input,textarea,select')]
      .flatMap(e=>safe(e)?[[identity(e),e.value,e.checked,e.selectedIndex,e.disabled,e.readOnly]]:[])];
  cache.guard=e=>{
    if (!e?.isConnected || !visible(e)) return null;
    const scope=e.closest('form,dialog,[role="dialog"],article,li,tr,[role="row"]') || e.parentElement;

    return [identity(e),role(e),name(e),e.value??null,e.checked??null,e.selectedIndex??null,
      e.readOnly??null,e.matches(':disabled'),e.getAttribute('aria-disabled'),
      e.getAttribute('aria-expanded'),e.getAttribute('aria-checked'),e.getAttribute('aria-selected'),
      e.getAttribute('href'),scope?.innerText?.slice(0,6000)||''];
  };

  const actions=[];

  // Interactive elements hidden by CSS (menus, captions revealed on :hover)
  // never reach the action table — but their visible container can be
  // hovered to reveal them. ancestor → {fx,fy} for post-gather hover offers.
  const hoverZones=new Map();

  const INTERACTIVE='a[href],button,select,input,textarea,summary,'+
    '[role="link"],[role="button"],[role="menuitem"],[role="option"],[role="tab"]';

  const hoverable=e=>e.matches('[aria-haspopup],[onmouseover],[title]') ||
    !!e.closest('nav,header,[role="navigation"],[role="menu"],[role="menubar"],[class*="menu"],[class*="dropdown"]');

  // Piercing gather: same-origin iframes recurse with accumulated viewport
  // offsets; open shadow roots recurse in the same coordinate space. `frame`
  // records the offset so execution can hit-test and click correctly.
  const gather=(root,fx,fy,depth)=>{
    if (depth>4) return;

    for (const e of root.querySelectorAll(selector)) {
      if (!safe(e) || !visible(e) || e.matches(':disabled') || e.closest('[aria-disabled="true"]')) {
        if (e.matches(INTERACTIVE) && hoverZones.size < 24) {
          // Walk up to the nearest visible ancestor sized like a hover zone —
          // skipping body-sized wrappers where hovering means nothing.
          let a=e.parentElement, hops=0;

          while (a && hops++<6 && !hoverZones.has(a)) {
            if (visible(a) && !a.matches(selector)) {
              const ar=a.getBoundingClientRect();
              const ax=fx+ar.x+ar.width/2, ay=fy+ar.y+ar.height/2;

              if (ar.width>0 && ar.height>0 && ar.width<=800 && ar.height<=400 &&
                  ax>=0 && ay>=0 && ax<innerWidth && ay<innerHeight) hoverZones.set(a,{fx,fy});

              break;
            }

            a=a.parentElement;
          }
        }

        continue;
      }

      const r=e.getBoundingClientRect(), x=fx+r.x+r.width/2, y=fy+r.y+r.height/2, rname=role(e);

      if (!rname || r.width<=0 || r.height<=0 || x<0 || y<0 || x>=innerWidth || y>=innerHeight) continue;

      if (rname==='gridcell' && e.querySelector('button,[role="button"]')) continue;
      const frame=(fx||fy)?{x:fx,y:fy}:undefined;
      const shadow=e.getRootNode() instanceof ShadowRoot;

      // Accessible names are short; a cap bounds per-element token cost and
      // contains pathological pages (giant labels once blew the model request).
      const base={node:identity(e),role:rname,label:(name(e)||rname).slice(0,240),
        rect:{x:fx+r.x,y:fy+r.y,w:r.width,h:r.height}};

      if (frame) base.frame=frame;

      if (shadow) base.shadow=true;

      for (const key of ['checked','selected','expanded']) {
        const value=e.getAttribute('aria-'+key);

        if (value!==null) base[key]=value;
      }

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

        actions.push({...base,kind:editable?'fill':'click',value});

        if (editable) actions.push({...base,kind:'click',value,label:'Focus '+base.label});
      }

      if (hoverable(e)) actions.push({...base,kind:'hover',value:undefined,label:'Hover '+base.label});
    }

    for (const e of root.querySelectorAll('*')) {
      if (e.shadowRoot) gather(e.shadowRoot,fx,fy,depth+1);
    }

    for (const f of root.querySelectorAll('iframe,frame')) {
      try {
        const d=f.contentDocument;

        if (!d?.body || !visible(f)) continue;
        const r=f.getBoundingClientRect();
        gather(d,fx+r.x,fy+r.y,depth+1);
      } catch { /* cross-origin */ }
    }
  };

  gather(document,0,0,0);

  // Emit hover offers on the visible ancestors of hidden interactive content.
  for (const [a,off] of hoverZones) {
    const ar=a.getBoundingClientRect();

    const base={node:identity(a),role:'group',
      label:('Hover '+((name(a)||'element').replace(/\s+/g,' ').trim())).slice(0,240),
      rect:{x:off.fx+ar.x,y:off.fy+ar.y,w:ar.width,h:ar.height}};

    if (off.fx||off.fy) base.frame={x:off.fx,y:off.fy};

    if (a.getRootNode() instanceof ShadowRoot) base.shadow=true;
    actions.push({...base,kind:'hover'});
  }

  // Lists repeat control labels: six "Add to cart" buttons can't be told
  // apart. Enrich duplicates with the item scope's heading or named text.
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
      const scope=e.closest('li,article,tr,dd,[role="listitem"],[role="row"],[class*="card"],[class*="item"],[class*="product"]');

      if (!scope) continue;

      const ctx=scope.querySelector('h1,h2,h3,h4,h5,h6,[class*="name"],[class*="title"],[class*="header"],strong,b')
        ?.textContent?.trim().replace(/\s+/g,' ');

      if (ctx && ctx.length<=80 && !a.label.includes(ctx)) a.label=a.label+' — '+ctx;
    }
  }

  const words=[], range=document.createRange(); let node,length=0;

  const walkText=(doc)=>{
    const body=doc.body||doc.documentElement;
    const walker=doc.createTreeWalker(body,NodeFilter.SHOW_TEXT);

    while ((node=walker.nextNode()) && length<6000) {
      const value=node.textContent.trim(), parent=node.parentElement;

      if (!value || !parent || parent.closest('script,style,noscript,template') || !visible(parent)) continue;
      range.selectNodeContents(node); const r=range.getBoundingClientRect();

      if (r.width>0 && r.height>0 && r.bottom>0 && r.top<innerHeight && r.right>0 && r.left<innerWidth) {
        words.push(value); length+=value.length;
      }
    }

    for (const f of doc.querySelectorAll('iframe,frame')) {
      try { if (f.contentDocument) walkText(f.contentDocument); } catch { /* cross-origin */ }

      if (length>=6000) break;
    }
  };

  walkText(document);

  const text=words.join('\n').slice(0,6000), height=document.documentElement.scrollHeight;
  const page_key=cache.pageKey(), guards={};

  for (const a of actions) if (!(a.node in guards)) guards[a.node]=cache.guard(cache.nodes.get(a.node));
  // Compare meaning and identity. Geometry is always resolved and hit-tested just before input.
  const semantics=actions.map(({rect: _rect,...action})=>action);

  const marker=[performance.timeOrigin,location.href,scrollX,scrollY,innerWidth,innerHeight,
    document.title,text,semantics,page_key[6]];

  const omitted_actions=Math.max(0,actions.length-250);
  actions.splice(250);
  actions.forEach((a,i)=>a.id='e'+(i+1));

  if (scrollY+innerHeight<height-2) actions.push({id:'scroll_down',kind:'scroll',label:'Scroll down',delta:560});

  if (scrollY>0) actions.push({id:'scroll_up',kind:'scroll',label:'Scroll up',delta:-560});
  actions.push({id:'wait',kind:'wait',label:'Wait for the page to update'});
  actions.push({id:'go_back',kind:'back',label:'Go back to the previous page'});
  actions.push({id:'go_forward',kind:'forward',label:'Go forward in history'});

  for (const k of ['enter','tab','escape','backspace','delete','arrowup','arrowdown',
                   'arrowleft','arrowright','home','end','pageup','pagedown','space'])
    actions.push({id:'press_'+k,kind:'press',key:k,label:'Press '+k});

  return {url:location.href,title:document.title,w:innerWidth,h:innerHeight,text,
    scroll:{y:scrollY,height},actions,marker,page_key,guards,omitted_actions};
})()
