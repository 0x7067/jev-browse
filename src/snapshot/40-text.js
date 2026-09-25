  const words=[];

let node,length=0;

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

  {
    const pageLinks=[...document.querySelectorAll('link[rel]')]
      .flatMap(l=>{
        const rel=(l.getAttribute('rel')||'').trim().toLowerCase(), href=(l.getAttribute('href')||'').trim();

        return rel && href ? [[rel,href.slice(0,120)]] : [];
      });

    if (pageLinks.length) state.page_links=pageLinks.slice(0,8);

    const LIVE_ROLES=['status','alert','log','marquee','timer'];

    const live=[...document.querySelectorAll('[aria-live],output,[role]')]
      .flatMap(e=>{
        const role=(e.getAttribute('role')||'').toLowerCase()||
          (e.tagName==='OUTPUT' ? 'status' : '');

        if (!e.ariaLive && !LIVE_ROLES.includes(role)) return [];

        if (!visible(e)) return [];

        return [[(e.ariaLive||role).slice(0,12),
          (e.textContent||'').trim().replace(/\s+/g,' ').slice(0,80)]];
      });

    if (live.length) state.live_regions=live.slice(0,8);
  }

  return state;
