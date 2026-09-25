/** Prepare a page element before dispatching trusted pointer input. */

/**
 * Focus and scroll an observed element, then wait for a stable, unobscured click position.
 * @param ref - Validated reference from the current isolated-world observation.
 * @returns Isolated-world JavaScript resolving viewport coordinates, or rejecting before input if the target is unavailable.
 */
export function elementTargetScript(ref: string): string {
  return `(() => {
    const el=globalThis.__agentOSNodes?.get(${JSON.stringify(ref)});
    if(!el?.isConnected)throw Error('Element changed; observe again.');
    const identity=globalThis.__agentOSIdentities?.get(${JSON.stringify(ref)});
    const sameTarget=()=>identity!==undefined && globalThis.__agentOSIdentity?.(el)===identity;
    if(!sameTarget())throw Error('Element label or destination changed; observe again.');
    if(el.matches('input[type="password"],[autocomplete="one-time-code"]') ||
      /password|passcode|secret|token|api.?key|credit.?card|cvv/i.test([el.name,el.id,el.getAttribute('aria-label')].join(' ')))throw Error('Use the vault or human takeover for credentials.');
    if(el.matches(':disabled,[aria-disabled="true"]'))throw Error('Element is disabled.');
    const frames=[];let view=el.ownerDocument.defaultView;
    while(view!==window){const frame=view.frameElement;if(!frame?.isConnected)throw Error('Editor frame changed; observe again.');frames.push(frame);view=frame.ownerDocument.defaultView;}
    el.focus({preventScroll:true});
    el.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
    for(const frame of frames)frame.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
    return new Promise((resolve,reject) => {
      let sampleTimer,previous;
      const finish=(error,point) => {
        clearTimeout(timer);
        clearTimeout(sampleTimer);
        if(error)reject(error);else resolve(point);
      };
      const timer=setTimeout(()=>finish(Error('Element did not become stable; observe again.')),5000);
      const sample=()=>{
        if(!el.isConnected)return finish(Error('Element changed; observe again.'));
        if(!sameTarget())return finish(Error('Element label or destination changed; observe again.'));
        if(el.matches(':disabled,[aria-disabled="true"]'))return finish(Error('Element is disabled.'));
        try {
        const r=el.getBoundingClientRect(),own=el.ownerDocument.defaultView;
        const boxes=frames.map(frame=>{if(!frame.isConnected)throw Error('Editor frame changed; observe again.');return frame.getBoundingClientRect();});
        const box=[r.x,r.y,r.width,r.height,own.innerWidth,own.innerHeight,innerWidth,innerHeight,...boxes.flatMap(b=>[b.x,b.y,b.width,b.height])];
        if(previous && box.every((value,index)=>Math.abs(value-previous[index])<=0.5)){
          const left=Math.max(0,r.x),top=Math.max(0,r.y);
          const right=Math.min(own.innerWidth,r.x+r.width),bottom=Math.min(own.innerHeight,r.y+r.height);
          if(right<=left || bottom<=top)return finish(Error('Element is not visible.'));
          const point={x:(left+right)/2,y:(top+bottom)/2};
          const target=el.ownerDocument.elementFromPoint(point.x,point.y);
          if(!target || !el.contains(target))return finish(Error('Element is covered; observe again.'));
          for(let i=0;i<frames.length;i++){
            const frame=frames[i],b=boxes[i],parent=frame.ownerDocument.defaultView;
            const sx=b.width/frame.offsetWidth,sy=b.height/frame.offsetHeight;
            if(!Number.isFinite(sx)||!Number.isFinite(sy)||sx<=0||sy<=0)throw Error('Editor frame is not visible.');
            point.x=b.x+(frame.clientLeft+point.x)*sx;point.y=b.y+(frame.clientTop+point.y)*sy;
            if(point.x<0||point.y<0||point.x>=parent.innerWidth||point.y>=parent.innerHeight||frame.ownerDocument.elementFromPoint(point.x,point.y)!==frame)throw Error('Editor frame is covered; observe again.');
          }
          return finish(undefined,point);
        }
        previous=box;
        sampleTimer=setTimeout(sample,32);
        }catch(error){finish(error);}
      };
      sampleTimer=setTimeout(sample,32);
    });
  })()`
}
