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

    const computedName=e.computedName?.();

    if (computedName) return computedName;
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
