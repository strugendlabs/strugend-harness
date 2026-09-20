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
    if(el.matches('input[type="password"],[autocomplete="one-time-code"]') ||
      /password|secret|token|api.?key/i.test([el.name,el.id].join(' ')))throw Error('Use the vault or human takeover for credentials.');
    if(el.matches(':disabled,[aria-disabled="true"]'))throw Error('Element is disabled.');
    el.focus({preventScroll:true});
    el.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
    return new Promise((resolve,reject) => {
      let frame,previous;
      const finish=(error,point) => {
        clearTimeout(timer);
        cancelAnimationFrame(frame);
        if(error)reject(error);else resolve(point);
      };
      const timer=setTimeout(()=>finish(Error('Element did not become stable; observe again.')),5000);
      const sample=()=>{
        if(!el.isConnected)return finish(Error('Element changed; observe again.'));
        const r=el.getBoundingClientRect();
        const box=[r.x,r.y,r.width,r.height,innerWidth,innerHeight];
        if(previous && box.every((value,index)=>value===previous[index])){
          const left=Math.max(0,r.x),top=Math.max(0,r.y);
          const right=Math.min(innerWidth,r.x+r.width),bottom=Math.min(innerHeight,r.y+r.height);
          if(right<=left || bottom<=top)return finish(Error('Element is not visible.'));
          const point={x:(left+right)/2,y:(top+bottom)/2};
          const target=document.elementFromPoint(point.x,point.y);
          if(!target || !el.contains(target))return finish(Error('Element is covered; observe again.'));
          return finish(undefined,point);
        }
        previous=box;
        frame=requestAnimationFrame(sample);
      };
      frame=requestAnimationFrame(sample);
    });
  })()`
}
