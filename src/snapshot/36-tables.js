  const tables=[];

  const tableSelector='table,[role="table"],[role="grid"],[role="treegrid"]';

  let omitted_tables=0, tableTextBudget=6000;

  for (const root of tableRoots) {
    for (const table of root.querySelectorAll(tableSelector)) {
      if (!visible(table) || table.matches('[role="presentation"],[role="none"]') || behindModal(table)) continue;

      if (tables.length>=3 || tableTextBudget<=0) { omitted_tables++; continue; }

      const rowElements=[...table.querySelectorAll('tr,[role="row"]')]
        .filter(row=>row.closest(tableSelector)===table);

      const visibleRows=rowElements.filter(visible);
      const caption=table.querySelector('caption');

      const label=table.getAttribute('aria-label') || (table.getAttribute('aria-labelledby')||'').split(/\s+/)
        .map(id=>table.ownerDocument.getElementById(id)?.textContent||'').join(' ').trim() || caption?.innerText || '';

      const observed={label:label.slice(0,160),document_url:table.ownerDocument.URL,rows:[],truncated:rowElements.length>16 || visibleRows.length!==rowElements.length};

      for (const [rowIndex,row] of visibleRows.slice(0,16).entries()) {
        const cells=[...row.querySelectorAll('th,td,[role="columnheader"],[role="rowheader"],[role="cell"],[role="gridcell"]')]
          .filter(cell=>cell.closest('tr,[role="row"]')===row && visible(cell));

        const observedRow={row:rowIndex+1,cells:[]};

        if (cells.length>12) observed.truncated=true;

        for (const cell of cells.slice(0,12)) {
          const text=(cell.innerText??cell.textContent??'').replace(/\s+/g,' ').trim();
          const cap=Math.min(160,tableTextBudget);

          if (text.length>cap) observed.truncated=true;
          tableTextBudget-=Math.min(text.length,cap);
          observedRow.cells.push({text:text.slice(0,cap),kind:cell.tagName==='TH' || cell.matches('[role="columnheader"],[role="rowheader"]') ? 'header' : 'data',
            row_span:cell.rowSpan??(Number(cell.getAttribute('aria-rowspan'))||1),column_span:cell.colSpan??(Number(cell.getAttribute('aria-colspan'))||1),
            scope:cell.getAttribute('scope')||'',sort:cell.getAttribute('aria-sort')||''});
        }

        observed.rows.push(observedRow);
      }

      tables.push(observed);
    }
  }
