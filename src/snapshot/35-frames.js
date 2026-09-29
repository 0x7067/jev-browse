  const frames=[];

  const frameLoads=cache.frameLoads ||= new WeakMap();

  const readFrames=(doc,depth)=>{
    if (depth>4 || frames.length>=40) return;

    for (const frame of doc.querySelectorAll('iframe,frame')) {
      const rect=frame.getBoundingClientRect();

      if (!visible(frame) || !rect.width || !rect.height) continue;

      const source=frame.getAttribute('srcdoc') ?? frame.getAttribute('src') ?? '';
      let load=frameLoads.get(frame);

      if (!load) {
        load={source,observed:false};
        frameLoads.set(frame,load);
        frame.addEventListener('load',()=>{
          load.source=frame.getAttribute('srcdoc') ?? frame.getAttribute('src') ?? '';
          load.observed=true;
        });
      } else if (load.source!==source) {
        load.source=source;
        load.observed=false;
      }

      let child=null;

      try { child=frame.contentDocument; } catch { }

      const provider=frame.closest('[data-loaded],[data-ready]');
      const attribute=provider?.hasAttribute('data-loaded') ? 'data-loaded' : 'data-ready';

      const app_readiness=provider ? {
        attribute,value:provider.getAttribute(attribute),
        source:provider.tagName.toLowerCase()+(provider.id ? '#'+provider.id : '')
      } : null;

      frames.push({node:identity(frame),title:frame.title||frame.name||'',
        src:frame.hasAttribute('srcdoc') ? 'about:srcdoc' : frame.src||'about:blank',
        document_url:child?.URL??null,accessibility:child ? 'same_origin' : 'inaccessible',
        ready_state:child?.readyState??null,load_event:load.observed ? 'observed' : 'unknown',
        app_readiness});

      if (child) readFrames(child,depth+1);

      if (frames.length>=40) break;
    }
  };

  readFrames(document,0);
