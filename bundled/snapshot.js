(() => {
  if (!document.body) return null;
  const cache = window.__jevFast ||= {ids:new WeakMap(), nodes:new Map(), next:1};

  const identity = e => {
    if (!cache.ids.has(e)) cache.ids.set(e,cache.next++);
    const id=cache.ids.get(e); cache.nodes.set(id,e);

 return id;
  };

  cache.sig ||= new Map();

  for (const [id,e] of cache.nodes) {
    if (e.isConnected) continue;
    cache.nodes.delete(id);
    cache.sig.delete(id);
  }

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
        n.nodeType===1 && !(e.tagName==='SELECT' && (n.tagName==='OPTION'||n.tagName==='OPTGROUP')) &&
          !SKIP_NAME.has(n.tagName) && n.getAttribute('aria-hidden')!=='true' ? name(n,seen) : '').join(' ').trim()) ||
      // Sibling labels name unlabelled inputs — the input+label pattern is
      // how most checkboxes and toggles get their text.
      (e.tagName==='INPUT' && e.nextElementSibling?.matches?.('label')
        ? name(e.nextElementSibling,seen) : '') ||
      e.getAttribute('title') || e.getAttribute('placeholder') || '';
  };

  const roles=['button','link','checkbox','radio','switch','tab','menuitem','menuitemradio',
    'menuitemcheckbox','option','listbox','treeitem','gridcell','cell','columnheader',
    'rowheader','combobox','textbox','searchbox','spinbutton','slider','scrollbar'];

  // Popup/hover handlers mark elements that reveal content — indexed so they
  // can be offered as hover actions even without an interactive role. Class
  // substrings (menu/dropdown/tooltip) are NOT candidates: Tailwind-style
  // utilities make them match arbitrary elements.
  const hoverSel='[aria-haspopup],[onmouseover],[oncontextmenu]';

  // [onclick], [draggable] and handler attributes mark interactivity with no
  // role or link semantics — custom widgets live on plain divs. tabindex is
  // gathered separately (tabindexSel): focus order alone isn't clickability.
  const selector='a[href],button,input,textarea,select,summary,[contenteditable="true"],'+
    '[draggable="true"],[onclick],[ondrop],[ondragover],[ondragenter],'+roles.map(role=>'[role="'+role+'"]').join(',')+','+hoverSel;

  const tabindexSel='[tabindex]:not([tabindex^="-"])';

  // Handler properties are invisible to selectors: el.oncontextmenu=... wires
  // the same interactivity as the attribute, and drop zones are usually plain
  // divs. Gather scans every element and tests these in JS.
  const HANDLER_PROPS=['onclick','oncontextmenu','onmousedown','onkeydown','onkeypress','onmouseover'];
  const DROP_PROPS=['ondrop','ondragover','ondragenter'];

  // An unset on* handler reads null; a non-callable assignment turns into
  // null too — a truthy read is a wired handler.
  const hasHandlerProp=e=>{
    for (const p of HANDLER_PROPS) if (e[p]) return true;

    return false;
  };

  const hasDropProp=e=>{
    for (const p of DROP_PROPS) if (e[p]) return true;

    return false;
  };

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

      if (e.type==='file') return 'file';

      if (['text','email','url','tel','password','date','time','datetime-local',
           'month','week'].includes(e.type)) return 'textbox';
    }

    // No-role interactivity: click/hover handlers, focusable widgets, drag
    // sources. They matched the candidacy test for a reason — call them
    // buttons so they reach the action table.
    if (e.matches(hoverSel+',[onclick],[draggable="true"],'+tabindexSel) ||
        hasHandlerProp(e) || hasDropProp(e)) return 'button';

    return null;
  };

  // No node identity here: a re-render that swaps nodes but keeps the
  // fields is the same page.
  cache.pageKey=()=>[performance.timeOrigin,location.href,scrollX,scrollY,innerWidth,innerHeight,
    [...document.querySelectorAll('input,textarea,select')]
      .flatMap(e=>safe(e)?[[e.tagName,e.type||null,name(e),e.value,e.checked,e.selectedIndex,e.disabled,e.readOnly]]:[])];
  // The click guard: identity, semantics, and rounded geometry. Ambient text
  // (a clock next to the button) is not part of it — a control that kept
  // its node, name, state, and place is the control the model chose.
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

  // Offered-control cap. Labels are capped at 240 chars and choose() shrinks
  // the state on context overflow, so a larger table costs tokens, not runs.
  const MAX_ACTIONS=500;

  const actions=[];

  // Hit-test through open shadow roots: document.elementFromPoint stops at
  // the outermost host, so nested shadow content is never "hit" directly.
  // Shared with the drivers' input scripts via window.__jevFast.
  const deepHit=cache.deepHit=(doc,x,y)=>{
    let hit=doc.elementFromPoint(x,y);

    while (hit?.shadowRoot) {
      const deeper=hit.shadowRoot.elementFromPoint(x,y);

      if (!deeper || deeper===hit) break;
      hit=deeper;
    }

    return hit;
  };

  // Interactive elements hidden by CSS (menus, captions revealed on :hover)
  // never reach the action table — but their visible container can be
  // hovered to reveal them. ancestor → {fx,fy} for post-gather hover offers.
  const hoverZones=new Map();

  const INTERACTIVE='a[href],button,select,input,textarea,summary,'+
    roles.map(role=>'[role="'+role+'"]').join(',');

  // Only real hover-reveal signals qualify. Ancestors of hidden interactive
  // descendants are offered separately via hoverZones.
  const hoverable=e=>e.matches(hoverSel);

  // Piercing gather: same-origin iframes recurse with accumulated viewport
  // offsets; open shadow roots recurse in the same coordinate space. `frame`
  // records the offset so execution can hit-test and click correctly.
  const gather=(root,fx,fy,depth)=>{
    if (depth>4) return;

    for (const e of root.querySelectorAll('*')) {
      if (e.shadowRoot) gather(e.shadowRoot,fx,fy,depth+1);

      if (e.tagName==='DIALOG' && e.open && e.matches(':modal')) {
        const doc=e.ownerDocument;
        modalsByDoc.set(doc,[...(modalsByDoc.get(doc)??[]),e]);
      }

      const dropZone=hasDropProp(e);

      // Candidacy: selector match, a handler property, or a drop handler.
      // tabindex>=0 alone is routine focus management, not clickability —
      // it needs a second signal: handler/jsaction attribute or property,
      // pointer cursor, or an interactive descendant.
      if (!dropZone && !e.matches(selector) && !hasHandlerProp(e) &&
          !(e.matches(tabindexSel) &&
            (e.matches('[onclick],[onkeydown],[onkeypress],[onmousedown],[jsaction]') ||
              (e.ownerDocument.defaultView||window).getComputedStyle(e).cursor==='pointer' ||
              e.querySelector(INTERACTIVE)))) continue;

      // Opacity:0 custom controls (iOS toggles, styled checkboxes, material
      // switches) fail checkVisibility yet remain the real click target —
      // the hit test, not the visibility check, is the arbiter of
      // clickability. Rescue them when they win a point inside their
      // on-viewport area; a <label> covering its control counts too.
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
        // An interactive element hidden only by CSS (menus revealed on
        // :hover) can be exposed by hovering a visible ancestor — record
        // that zone. Hidden inputs and disabled controls are not
        // hover-revealable and don't feed it.
        if (!vis && safe(e) && !e.matches(':disabled') && !e.closest('[aria-disabled="true"]') &&
            e.matches(INTERACTIVE) && hoverZones.size < 24) {
          // Walk up to a visible ancestor sized like a hover zone — keep
          // climbing past oversized wrappers where hovering means nothing.
          let a=e.parentElement, hops=0;

          while (a && hops++<6 && !hoverZones.has(a)) {
            // The nearest visible ancestor is the hover target even when it
            // is itself indexed — climbing past it lands on wrappers whose
            // center hits dead space (or a disabled sibling menu item).
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

      if (!rname || r.width<=0 || r.height<=0 ||
          fx+r.x>=innerWidth || fy+r.y>=innerHeight ||
          fx+r.x+r.width<=0 || fy+r.y+r.height<=0) continue;

      if (rname==='gridcell' && e.querySelector('button,[role="button"]')) continue;

      const frame=(fx||fy)?{x:fx,y:fy}:undefined;
      const shadow=e.getRootNode() instanceof ShadowRoot;

      // Accessible names are short; a cap bounds per-element token cost and
      // contains pathological pages (giant labels once blew the model request).
      const accessibleName=name(e);

      const base={node:identity(e),role:rname,label:(accessibleName||rname).slice(0,240),
        rect:{x:fx+r.x,y:fy+r.y,w:r.width,h:r.height}};

      cache.sig.set(base.node,[root,rname,accessibleName]);

      if (e.getAttribute('draggable')==='true' || e.ondragstart) base.draggable=true;

      if (e.hasAttribute('oncontextmenu') || e.oncontextmenu) base.contextMenu=true;

      if (dropZone) base.dropZone=true;

      // Classes often carry the only semantic signal a control has
      // (button.success is the green one). Truncate aggressively.
      const cls=(e.getAttribute('class')||'').trim().replace(/\s+/g,' ');

      if (cls) base.cls=cls.slice(0,80);

      if (frame) base.frame=frame;

      if (shadow) base.shadow=true;

      for (const key of ['checked','selected','expanded','pressed','valuenow','valuemin','valuemax']) {
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

        // File inputs: fill is the only sane action — TYPE_TEXT carries the
        // path into DOM.setFileInputFiles; a click opens a native chooser we
        // cannot drive, so no click or Focus companion is offered.
        if (e.type==='file') {
          actions.push({...base,kind:'fill',value});
        } else {
          actions.push({...base,kind:editable?'fill':'click',value});

          if (editable) actions.push({...base,kind:'click',value,label:'Focus '+base.label});
        }
      }

      // A container's hover duplicates its offered descendants — hovering
      // the specific child is the useful action (menu roots swallow the
      // choice). Offer the leaf, not the root.
      if (hoverable(e) && !e.querySelector(selector))
        actions.push({...base,kind:'hover',value:undefined,label:'Hover '+base.label});
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

  // Ancestor test across shadow boundaries: parents first, then the host
  // once the root is reached — jumping to the host early skips the
  // ancestors inside the shadow tree. Shared with the drivers.
  const composedContains=cache.composedContains=(a,n)=>{
    for (let x=n;x;) {
      if (x===a) return true;
      const r=x.getRootNode();
      x=x.parentElement??(r instanceof ShadowRoot?r.host:null);
    }

    return false;
  };

  // An open modal dialog makes everything outside it inert without any
  // attribute to match. gather records them as it walks; offers outside
  // every modal of the same document are dropped afterwards.
  const modalsByDoc=new Map();

  const behindModal=e=>{
    const modals=modalsByDoc.get(e.ownerDocument);

    return modals!==undefined && !modals.some(m=>composedContains(m,e));
  };

  gather(document,0,0,0);

  if (modalsByDoc.size) {
    for (let i=actions.length-1;i>=0;i--) if (behindModal(cache.nodes.get(actions[i].node))) actions.splice(i,1);

    for (const a of hoverZones.keys()) if (behindModal(a)) hoverZones.delete(a);
  }

  // Event-delegation containers (ul.onclick, grid.onclick) carry a handler
  // but no semantics of their own; they precede their children in DOM order
  // and take the children's text as a name, so a model picks the container
  // and the click lands between the real targets. Suppress one only when
  // offered descendants cover most of its area — a container whose matching
  // descendants were all filtered out (hidden, disabled), or whose own
  // region does distinct work (a clickable card with one nested button), is
  // the only way to reach that behavior and stays.
  {
    const offered=new Set();

    for (const a of actions) {
      const el=a.node===undefined||a.kind==='hover' ? null : cache.nodes.get(a.node);

      if (el) offered.add(el);
    }

    const drop=new Set();

    for (const a of actions) {
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

  // Node lookup with one re-resolution: a virtual-DOM re-render swaps the
  // element behind an observed node between decision and input. When the
  // observed node is gone, the unique element in the same root with the
  // same role and accessible name is the same control; bind it to the id
  // unless a newer snapshot already named it.
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

  const words=[]; let node,length=0;

  const walkText=(doc)=>{
    const w=doc.defaultView, vw=w?w.innerWidth:innerWidth, vh=w?w.innerHeight:innerHeight;
    const body=doc.body||doc.documentElement, range=doc.createRange();
    // Open shadow roots hold real text (dialogs, custom widgets); walk
    // them in place, in document order, so the model reads what it sees.

    const walkRoot=(root,depth)=>{
      const walker=doc.createTreeWalker(root,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);

      while ((node=walker.nextNode()) && length<24000) {
        if (node.nodeType===1) {
          if (node.shadowRoot && depth<4) walkRoot(node.shadowRoot,depth+1);
          continue;
        }

        const value=node.textContent.trim(), parent=node.parentElement;

        if (!value || !parent || parent.closest('script,style,noscript,template') || !visible(parent)) continue;
        range.selectNodeContents(node); const r=range.getBoundingClientRect();

        if (r.width>0 && r.height>0 && r.bottom>0 && r.top<vh && r.right>0 && r.left<vw) {
          words.push(value); length+=value.length;
        }
      }
    };

    walkRoot(body,0);

    for (const f of doc.querySelectorAll('iframe,frame')) {
      try {
        const fr=f.getBoundingClientRect();

        if (f.contentDocument && fr.width>0 && fr.height>0 && visible(f)) walkText(f.contentDocument);
      } catch { /* cross-origin */ }

      if (length>=24000) break;
    }
  };

  walkText(document);

  // The budget keeps the head of the DOM; confirmations, toasts, and results
  // usually land at its tail. Over budget, keep both ends.
  let text=words.join('\n');

  if (text.length>6000) text=text.slice(0,4500)+'\n[… '+(text.length-6000)+' chars omitted …]\n'+text.slice(-1500);
  const height=document.documentElement.scrollHeight, page_key=cache.pageKey();
  // Compare meaning and identity. Geometry is always resolved and hit-tested just before input.
  const semantics=actions.map(({rect: _rect,...action})=>action);

  const marker=[performance.timeOrigin,location.href,scrollX,scrollY,innerWidth,innerHeight,
    document.title,text,semantics,page_key[6]];

  const omitted_actions=Math.max(0,actions.length-MAX_ACTIONS);
  actions.splice(MAX_ACTIONS);

  if (omitted_actions>0)
    text+='\n['+omitted_actions+' more interactive elements not shown — scroll or narrow the page]';

  actions.forEach((a,i)=>a.id='e'+(i+1));

  // Guards pay a synchronous-layout innerText cost — compute them only for
  // elements that survived the cap.
  const guards={};

  for (const a of actions) if (!(a.node in guards)) guards[a.node]=cache.guard(cache.nodes.get(a.node));

  let focused;
  const ae=document.activeElement;

  if (ae && ae!==document.body && ae!==document.documentElement) {
    const offered=actions.find(a=>a.node && cache.nodes.get(a.node)===ae);
    focused=offered?.id || name(ae).replace(/\s+/g,' ').trim().slice(0,80) || undefined;
  }

  if (scrollY+innerHeight<height-2) actions.push({id:'scroll_down',kind:'scroll',label:'Scroll down',delta:560});

  if (scrollY>0) actions.push({id:'scroll_up',kind:'scroll',label:'Scroll up',delta:-560});
  actions.push({id:'wait',kind:'wait',label:'Wait for the page to update'});
  actions.push({id:'go_back',kind:'back',label:'Go back to the previous page'});
  actions.push({id:'go_forward',kind:'forward',label:'Go forward in history'});

  for (const k of ['enter','tab','escape','backspace','delete','arrowup','arrowdown',
                   'arrowleft','arrowright','home','end','pageup','pagedown','space'])
    actions.push({id:'press_'+k,kind:'press',key:k,label:'Press '+k});

  return {url:location.href,title:document.title,w:innerWidth,h:innerHeight,text,
    scroll:{y:scrollY,height},actions,marker,page_key,guards,omitted_actions,focused};
})()
