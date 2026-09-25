  const roles=['button','link','checkbox','radio','switch','tab','menuitem','menuitemradio',
    'menuitemcheckbox','option','treeitem','gridcell','cell','columnheader',
    'rowheader','combobox','textbox','searchbox','spinbutton','slider','scrollbar'];

  const CONTAINER_ROLES=['listbox','menu','menubar','tablist','tree','treegrid',
    'radiogroup','grid','table','rowgroup'];

  const LANDMARK_TAGS={NAV:'navigation',MAIN:'main',HEADER:'banner',FOOTER:'contentinfo',ASIDE:'complementary'};

  const LANDMARK_ROLES=['navigation','main','banner','contentinfo','complementary','search','form','region'];

  const landmarkOf=e=>{
    for (let a=e.parentElement;a;a=a.parentElement) {
      const computed=a.computedRole?.();

      if (computed && LANDMARK_ROLES.includes(computed))
        return ((a.computedName?.()||'')||computed).replace(/\s+/g,' ').slice(0,40);

      const explicit=a.getAttribute('role');

      if (explicit && LANDMARK_ROLES.includes(explicit))
        return (a.getAttribute('aria-label')||explicit).replace(/\s+/g,' ').slice(0,40);

      if ((a.tagName==='SECTION'||a.tagName==='FORM') && a.getAttribute('aria-label'))
        return a.getAttribute('aria-label').replace(/\s+/g,' ').slice(0,40);

      const implicit=LANDMARK_TAGS[a.tagName];

      if (implicit) return (a.getAttribute('aria-label')||implicit).replace(/\s+/g,' ').slice(0,40);
    }

    return '';
  };

  const hoverSel='[aria-haspopup],[onmouseover],[oncontextmenu]';

  const dragHandleSel='[draggable="true"],[aria-grabbed],[aria-roledescription],'+
    '[class*="drag-handle"],[class*="sortable-handle"],.ui-sortable-handle';

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
    const computed=e.computedRole?.();

    if (computed && roles.includes(computed)) return computed;

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
