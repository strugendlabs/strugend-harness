/** Isolated-world observations include same-origin frame editors without exposing credentials. */

/** Fresh reference table, frame-aware control labels and bounded page text. */
export const OBSERVE = `(() => {
  const editable=el=>el.isContentEditable || el.ownerDocument.designMode==='on' && el===el.ownerDocument.body;
  const sensitive=el=>el.matches('input[type="password"],[autocomplete="one-time-code"],[autocomplete="current-password"],[autocomplete="new-password"]') || /password|passcode|secret|api.?key|token|credit.?card|cvv/i.test([el.name,el.id,el.getAttribute('aria-label')].join(' '));
  const visible=el=>{const r=el.getBoundingClientRect(),s=el.ownerDocument.defaultView.getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const candidates=[],documents=[],opaque=[];
  const visit=(doc,depth)=>{
    if(!doc || depth>8 || documents.length>=32)return;
    documents.push(doc);
    for(const el of doc.querySelectorAll('a[href],button,input,textarea,select,canvas,[role="button"],[role="textbox"],[contenteditable]:not([contenteditable="false"]),iframe,frame')){
      if(!visible(el)&&!el.matches('input[type="file"]'))continue;
      if(el.matches('iframe,frame')){
        let child;try{child=el.contentDocument;}catch(error){/* Cross-origin frames remain opaque. */}
        if(child)visit(child,depth+1);else opaque.push(el.getAttribute('title')||el.getAttribute('name')||'Embedded frame');
      }else if(candidates.length<180 && (!editable(el)||!editable(el.parentElement??el.ownerDocument.documentElement)))candidates.push(el);
    }
    if(doc.designMode==='on'&&doc.body&&!candidates.includes(doc.body)&&candidates.length<180)candidates.push(doc.body);
  };
  visit(document,0);
  globalThis.__agentOSNodes=new Map();globalThis.__agentOSIdentities=new Map();
  globalThis.__agentOSDocuments=documents;
  globalThis.__agentOSIdentity=el=>JSON.stringify([el.tagName,el.getAttribute('role'),el.getAttribute('type'),el.getAttribute('href'),el.name,el.id,el.getAttribute('aria-label'),el.getAttribute('aria-labelledby'),el.labels?.[0]?.textContent,el.getAttribute('title'),el.matches('input,textarea')||editable(el)?'':el.innerText?.trim().slice(0,300)]);
  let remaining=24000;
  const elements=candidates.map((el,i)=>{
    const ref='e'+i;globalThis.__agentOSNodes.set(ref,el);globalThis.__agentOSIdentities.set(ref,globalThis.__agentOSIdentity(el));
    const frame=el.ownerDocument.defaultView.frameElement;
    const label=el.getAttribute('aria-label')||el.labels?.[0]?.textContent||el.getAttribute('placeholder')||el.getAttribute('title')||(editable(el)?(frame?.getAttribute('title')||'Message editor'):el.innerText)||el.name||el.tagName.toLowerCase();
    const value='value' in el?String(el.value):editable(el)?el.innerText:undefined;
    const preview=!sensitive(el)&&value!==undefined?String(value).slice(0,Math.min(remaining,editable(el)?20000:400)):undefined;remaining-=preview?.length??0;
    return {ref,...(el.matches('input')?{inputType:el.type}:{}),...(el.matches('select')?{options:[...el.options].filter(o=>!o.disabled&&!o.parentElement?.disabled).slice(0,50).map(o=>({value:o.value,label:o.text}))}:{}),role:el.getAttribute('role')||(editable(el)?'textbox':el.tagName.toLowerCase()),name:String(label).trim().slice(0,200),...(preview!==undefined?{value:preview}:{})};
  });
  const text=documents.map(doc=>{const clone=doc.body?.cloneNode(true);clone?.querySelectorAll('script,style,input,textarea,[contenteditable]').forEach(el=>el.remove());return clone?.innerText||clone?.textContent||'';}).join(' ').replace(/\\s+/g,' ').slice(0,14000);
  return {text:text+(opaque.length?' [Embedded frames without DOM access: '+opaque.join(', ')+'. Use visual inspection or user takeover.]':''),elements,viewport:{width:innerWidth,height:innerHeight}};
})()`

/** Redact form input and rich-text editors in every inspected frame; opaque frames are masked in full. */
export const MASK_INPUTS = `(() => {
  globalThis.__agentOSMasks=[];
  for(const doc of globalThis.__agentOSDocuments??[document]){
    const controls=[...doc.querySelectorAll('input,textarea,[contenteditable]:not([contenteditable="false"]),iframe,frame')];
    if(doc.designMode==='on'&&doc.body)controls.push(doc.body);
    for(const el of controls){
      if(el.matches('iframe,frame')&&el.contentDocument)continue;
      const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;
      const mask=doc.createElement('div');Object.assign(mask.style,{position:'fixed',left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px',background:'#303030',zIndex:'2147483647',pointerEvents:'none'});
      doc.documentElement.append(mask);globalThis.__agentOSMasks.push(mask);
    }
  }
})()`

/**
 * Select a validated editable target in its own document before trusted insertText.
 * @param ref - Reference from the current observation.
 * @param select - Whether to focus and select the validated editor, or only preflight it.
 * @param value - Replacement used to validate and fill native date, number and select controls.
 * @returns Script that refuses non-editable or replaced controls before changing selection.
 */
export function selectEditableScript(ref: string, select = true, value?: string): string {
  return `(() => {
    const el=globalThis.__agentOSNodes?.get(${JSON.stringify(ref)}),identity=globalThis.__agentOSIdentities?.get(${JSON.stringify(ref)});
    if(!el?.isConnected||identity===undefined||globalThis.__agentOSIdentity(el)!==identity)throw Error('Editor changed; observe again.');
    if(el.matches('input[type="password"],[autocomplete="one-time-code"],[autocomplete="current-password"],[autocomplete="new-password"]')||/password|passcode|secret|token|api.?key|credit.?card|cvv/i.test([el.name,el.id,el.getAttribute('aria-label')].join(' ')))throw Error('Use the vault or human takeover for credentials.');
    if(el.matches(':disabled,[aria-disabled="true"],[readonly]'))throw Error('Editor is read-only.');
    const doc=el.ownerDocument,rich=el.isContentEditable||doc.designMode==='on'&&el===doc.body;
    const native=el.matches('select,input[type="date"],input[type="number"],input[type="time"],input[type="datetime-local"],input[type="month"],input[type="week"]');
    if(native){
      const value=${JSON.stringify(value)};
      if(typeof value!=='string')throw Error('Provide a replacement value for this control.');
      let replacement=value;
      if(el.matches('select')){
        if(el.multiple)throw Error('Use a single-choice dropdown or user takeover for multiple selections.');
        const options=[...el.options].filter(o=>!o.disabled&&!o.parentElement?.disabled);
        const exact=options.filter(o=>o.value===value),matches=exact.length?exact:options.filter(o=>o.text.trim()===value);
        if(matches.length!==1)throw Error('Choose one exact enabled option value or label from the observation.');
        replacement=matches[0].value;
      }else{
        const probe=el.cloneNode();probe.value=value;
        if(probe.value!==value||!probe.validity.valid)throw Error('Invalid control value; use the observed type, ISO date/time format and allowed range.');
      }
      if(!${select})return 'native';
      const view=doc.defaultView,prototype=el.matches('select')?view.HTMLSelectElement.prototype:view.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,replacement);
      el.dispatchEvent(new view.Event('input',{bubbles:true}));el.dispatchEvent(new view.Event('change',{bubbles:true}));
      return 'native';
    }
    if(!rich&&!el.matches('textarea,input:not([type]),input[type="text"],input[type="email"],input[type="search"],input[type="url"],input[type="tel"]'))throw Error('This control is not a text editor; observe and choose a textbox.');
    if(!${select})return;
    el.focus({preventScroll:true});
    if(doc.activeElement!==el&&!el.contains(doc.activeElement))throw Error('Editor did not receive focus; observe again.');
    if(!rich)el.select();else{const s=doc.defaultView.getSelection(),r=doc.createRange();r.selectNodeContents(el);s.removeAllRanges();s.addRange(r);}
  })()`
}
