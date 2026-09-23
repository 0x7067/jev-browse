(() => {
  if (!document.body) return null;
  const cache = window.__jevFast ||= {ids:new WeakMap(), nodes:new Map(), next:1};

  const wake = cache.wake ||= {rev:0, listeners:new Set()};

  if (!wake.observer) {
    wake.quiet = (quietMs, budgetMs) => new Promise(resolve => {
      const deadline = Date.now() + budgetMs;
      let timer;

      const off = () => {wake.listeners.delete(bump); clearTimeout(timer);};

      const done = () => {off(); resolve(wake.rev);};

      const arm = () => {timer = setTimeout(done, Math.max(0, Math.min(quietMs, deadline - Date.now())));};

      const bump = () => {clearTimeout(timer); arm();};

      wake.listeners.add(bump);
      arm();
    });

    wake.observer = new MutationObserver(records => {
      if (records.every(r => r.type === 'attributes' && r.attributeName === 'data-jev-node')) return;
      wake.rev++;

      for (const listener of wake.listeners) listener();
    });

    wake.observer.observe(document.documentElement,
      {subtree:true, childList:true, attributes:true, characterData:true});
  }

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
      (e.tagName==='INPUT' && e.nextElementSibling?.matches?.('label')
        ? name(e.nextElementSibling,seen) : '') ||
      e.getAttribute('title') || e.getAttribute('placeholder') || '';
  };

  const roles=['button','link','checkbox','radio','switch','tab','menuitem','menuitemradio',
    'menuitemcheckbox','option','treeitem','gridcell','cell','columnheader',
    'rowheader','combobox','textbox','searchbox','spinbutton','slider','scrollbar'];

  const CONTAINER_ROLES=['listbox','menu','menubar','tablist','tree','treegrid',
    'radiogroup','grid','table','rowgroup'];

  const hoverSel='[aria-haspopup],[onmouseover],[oncontextmenu]';

  const dragHandleSel='.ui-sortable-handle,[aria-grabbed],[class*="drag-handle"],[class*="sortable-handle"],[draggable="true"]';

  const selector='a[href],button,input,textarea,select,summary,[contenteditable="true"],'+
    '[draggable="true"],[onclick],[ondrop],[ondragover],[ondragenter],'+dragHandleSel+','+roles.map(role=>'[role="'+role+'"]').join(',')+','+hoverSel;

  const tabindexSel='[tabindex]:not([tabindex^="-"])';

  const HANDLER_PROPS=['onclick','oncontextmenu','onmousedown','onkeydown','onkeypress','onmouseover'];
  const DROP_PROPS=['ondrop','ondragover','ondragenter'];

  const hasHandlerProp=e=>{
    for (const p of HANDLER_PROPS) if (e[p]) return true;

    return false;
  };

  const hasDropProp=e=>{
    for (const p of DROP_PROPS) if (e[p]) return true;

    return false;
  };

  const listenSet=e=>{
    const w = e instanceof Window ? e : ((e.ownerDocument||e).defaultView||window);

    return w.__jevListeners?.get(e);
  };

  const CLICK_EVENTS=['click','dblclick','mousedown','mouseup','contextmenu'];
  const HOVER_EVENTS=['mouseover','mouseenter'];

  const listenedClick=e=>{
    const s=listenSet(e);

    return !!s && CLICK_EVENTS.some(k=>s.has(k));
  };

  const listenedHover=e=>{
    const s=listenSet(e);

    return !!s && HOVER_EVENTS.some(k=>s.has(k));
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

    if (CONTAINER_ROLES.includes(explicit)) return null;

    if (e.matches(hoverSel+',[onclick],[draggable="true"],'+tabindexSel+','+dragHandleSel) ||
        hasHandlerProp(e) || hasDropProp(e) || listenSet(e)) return 'button';

    return null;
  };

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

      if (e.tagName==='DIALOG' && e.open && e.matches(':modal')) {
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
        if (fy+r.y>=innerHeight && belowFold.length<64 &&
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

  {
    const NAV_WORD=/^\s*(next|next page|more|older|newer|previous|prev|prev page|back|load more|show more|see more|view more|»|›|→|←|«|‹|\d+|[<>‹›«»]\s*\d+|\d+\s*[<>‹›«»]?)\s*$/i;

    const navScore=(e)=>{
      const rel=e.getAttribute('rel');

      if (rel==='next' || rel==='prev') return 0;

      if (NAV_WORD.test(name(e).trim())) return 1;

      if (e.closest('[rel~="next"],[rel~="prev"],[class*="paginat"],nav')) return 2;

      return 3;
    };

    belowFold.sort((a,b)=>navScore(a.e)-navScore(b.e));

    for (const {e,root,r,rname,fx,fy} of belowFold.slice(0,16)) {
      const accessibleName=name(e);
      const frame=(fx||fy)?{x:fx,y:fy}:undefined;

      const base={node:identity(e),role:rname,label:(accessibleName||rname).slice(0,240),
        rect:{x:fx+r.x,y:fy+r.y,w:r.width,h:r.height},below:true};

      cache.sig.set(base.node,[root,rname,accessibleName]);

      if (frame) base.frame=frame;

      if (e.getRootNode() instanceof ShadowRoot) base.shadow=true;

      actions.push({...base,kind:'click'});
    }
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
      const scope=e.closest('li,article,tr,dd,[role="listitem"],[role="row"],[class*="card"],[class*="item"],[class*="product"]');

      if (!scope) continue;

      const ctx=scope.querySelector('h1,h2,h3,h4,h5,h6,label,td:first-child,th:first-child,[class*="name"],[class*="title"],[class*="header"],strong,b')
        ?.textContent?.trim().replace(/\s+/g,' ');

      if (ctx && ctx.length<=80 && !a.label.includes(ctx)) a.label=a.label+' — '+ctx;
    }
  }

  const words=[]; let node,length=0;

  const walkText=(doc)=>{
    const w=doc.defaultView, vw=w?w.innerWidth:innerWidth, vh=w?w.innerHeight:innerHeight;
    const body=doc.body||doc.documentElement, range=doc.createRange();

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
      } catch { }

      if (length>=24000) break;
    }
  };

  walkText(document);

  let text=words.join('\n');

  if (text.length>6000) text=text.slice(0,4500)+'\n[… '+(text.length-6000)+' chars omitted …]\n'+text.slice(-1500);
  const height=document.documentElement.scrollHeight, page_key=cache.pageKey();

  const challenge=actions.length<=10 && (
    /just a moment|verifying you are|verify you are (a )?human|checking your (browser|connection)|are you a (robot|human)|unusual traffic|complete the (captcha|security)|enter the characters|i'?m not a robot|attention required|cf-chl|h-captcha|g-recaptcha|please verify/i
      .test(text+' '+document.title) ||
    !!document.querySelector('iframe[src*="captcha"],iframe[src*="challenges.cloudflare"],.h-captcha,.g-recaptcha,#cf-please-wait,[class*="cf-chl"],[data-sitekey]')
  ) || undefined;

  const semantics=actions.map(({rect: _rect,...action})=>action);

  const marker=[performance.timeOrigin,location.href,scrollX,scrollY,innerWidth,innerHeight,
    document.title,text,semantics,page_key[6]];

  const omitted_actions=Math.max(0,actions.length-MAX_ACTIONS);
  actions.splice(MAX_ACTIONS);

  if (omitted_actions>0)
    text+='\n['+omitted_actions+' more interactive elements not shown — scroll or narrow the page]';

  actions.forEach((a,i)=>{ if (!a.id) a.id='e'+(i+1) });

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

  if (history.length>1) actions.push({id:'go_back',kind:'back',label:'Go back to the previous page'});
  actions.push({id:'go_forward',kind:'forward',label:'Go forward in history'});

  const editing=ae && (ae.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(ae.tagName));
  const scrollable=height>innerHeight+2;
  const keys=new Set(['tab','escape']);

  if (focused) for (const k of ['enter','space','arrowup','arrowdown','arrowleft','arrowright']) keys.add(k);

  if (editing) for (const k of ['backspace','delete','home','end']) keys.add(k);

  if (scrollable) for (const k of ['pageup','pagedown','home','end']) keys.add(k);

  for (const k of keys) actions.push({id:'press_'+k,kind:'press',key:k,label:'Press '+k});

  const delegatedContextmenu=[window,document,document.documentElement,document.body,
      ...(document.body ? [...document.body.children] : [])]
    .some(e=>e && listenSet(e)?.has('contextmenu'));

  const state={url:location.href,title:document.title,w:innerWidth,h:innerHeight,text,
    scroll:{y:scrollY,height},actions,marker,page_key,guards,omitted_actions,focused};

  if (challenge) state.challenge=true;

  if (delegatedContextmenu) state.delegatedContextmenu=true;

  return state;
})()
