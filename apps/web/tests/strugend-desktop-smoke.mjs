/** Exercise the packaged desktop with isolated local provider and browser fixtures. */
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { once } from 'node:events'
import assert from 'node:assert/strict'
const APP = path.resolve(import.meta.dirname, '../../desktop');
const executable = process.argv[2];
if (!executable || !path.isAbsolute(executable)) throw new Error('Pass the absolute path of the packaged Strugend executable');
const REPO = path.resolve(APP, '../..');
const evidenceRoot = path.join(REPO, '.artifacts/strugend');
fs.mkdirSync(evidenceRoot, {recursive:true});
const OUT = fs.mkdtempSync(path.join(evidenceRoot, 'packaged-' + process.platform + '-' + process.arch + '-'));
(async () => {
 fs.mkdirSync(OUT, {recursive:true});
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'strugend-e2e-'));
 const home=path.join(root,'home'), workspace=path.join(root,'workspace');
 fs.mkdirSync(home); fs.mkdirSync(workspace);
 const errors=[], checks=[], serviceCalls=[]; let app,page,base,step=0,probeStep=0,probing=true,finalCount=0,decisionFails=false,backgroundProbe=false,backgroundStep=0,waitingForDecision,heldDecision,delivering=false,deliveryStep=0,deliveryJob,mainLog='';
 const redact=value=>value.replace(/token=[^\s]+/g,'token=[redacted]');
 const record=(name,data={})=>{checks.push({name,...data}); console.log('PASS:',name)};
 const ptcResponses=new WeakSet();
 const send=(res,model,delta,finish)=>{if(ptcResponses.has(res)&&delta.tool_calls)delta={...delta,tool_calls:delta.tool_calls.map(call=>({...call,function:{name:'run_code',arguments:JSON.stringify({code:call.function.name==='job_output'?`return (await tools.job_output(${call.function.arguments})).text;`:`return JSON.stringify((await tools[${JSON.stringify(call.function.name)}](${call.function.arguments}))${call.function.name==='desktop_browser'?'.observation':''});`,description:'Verify the packaged Strugend workflow'})}}))};res.setHeader('Content-Type','text/event-stream');for(const[d,f]of[[delta,null],[{},finish]])res.write('data: '+JSON.stringify({id:'strugend-e2e',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model,choices:[{index:0,delta:d,finish_reason:f}]})+'\n\n');res.end('data: [DONE]\n\n')};
 const toolResult=body=>{const message=[...body.messages].reverse().find(x=>x.role==='tool');assert(message,'Missing tool result');const content=typeof message.content==='string'?message.content:message.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');try{return JSON.parse(content)}catch{return JSON.parse(content.split('\n')[0])}};
 const review={intent:'review_evidence',goal:'Verify the changed software behavior.',evidence:'The build exited with code zero, but no behavior test has run.'};
 const server=http.createServer(async(req,res)=>{
  if(req.method==='POST'){
   let body;
   try{
    let raw=''; for await(const chunk of req)raw+=chunk; body=JSON.parse(raw);
    if(body.tools?.some(tool=>tool.function?.name==='run_code'))ptcResponses.add(res);
    if(req.url==='/v1/systemone'){
     if(backgroundProbe){serviceCalls.push('Background held');heldDecision=res;waitingForDecision?.();return}
     if(decisionFails){serviceCalls.push('Decision');res.writeHead(503);res.end('{}');return}
     assert.equal(req.headers.authorization,'Bearer synthetic-decision-key');
     assert(['convaiinnovations/laya','convaiinnovations/laya-multilingual'].includes(body.model));
     const answers=Object.fromEntries(Object.entries(body.questions).map(([id,q])=>[id,q.type==='noul'?{type:'noul',noul:0.94}:{type:'choice',choice:Object.keys(q.criteria)[0],probabilities:Object.fromEntries(Object.keys(q.criteria).map((k,i)=>[k,i===0?1:0])),confidence:1}]));
     serviceCalls.push('Decision');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({model:body.model,answers,usage:{input_tokens:16,output_tokens:2}}));return;
    }
    if(req.url.endsWith('/chat/completions')){
     if(!body.tools){send(res,body.model,{content:JSON.stringify(body.messages).includes('whether optional')?'Optional service check':'Workspace verification'},'stop');return}
     const system=JSON.stringify(body.messages.filter(x=>x.role==='system'));const upstream=system.match(/.{0,60}(DeepSeek Harness|powered by the deepseek|Current DSH file policy).{0,80}/i);assert(!upstream,'Received branded system prompt contains upstream identity: '+upstream?.[0]);
     const hasTool=name=>ptcResponses.has(res)?system.includes(' '+name+': {'):body.tools.some(x=>x.function?.name===name);
     assert.equal(hasTool('decision_check'),!probing);
     assert(!body.tools.some(x=>/video/i.test(x.function?.name)));
     assert(!hasTool('memory_graph'));
     assert(!hasTool('video_edit'));
     assert(hasTool('deliver_project'));
     assert(hasTool('crawl_website'));
     if(backgroundProbe){
      if(backgroundStep++===0){const name=process.platform==='win32'?'pwsh':'bash';send(res,body.model,{role:'assistant',tool_calls:[{index:0,id:'background-proof',type:'function',function:{name,arguments:JSON.stringify({command:'echo build-observation',description:'Produce observed output for optional background review'})}}]},'tool_calls');return}
      const observation=[...body.messages].reverse().find(message=>message.role==='tool');assert(observation,'The background checkpoint has no tool observation');
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Background review did not start for the tool observation: '+JSON.stringify(observation.content))),5000);waitingForDecision=()=>{clearTimeout(timer);resolve()};if(serviceCalls.includes('Background held'))waitingForDecision()});
      assert(heldDecision&&!heldDecision.destroyed&&!heldDecision.writableEnded,'Core waited until auxiliary inference stopped');
      send(res,body.model,{content:'Core completed while Decision was still pending.'},'stop');return;
     }
     if(probing){
      if(probeStep++===0){assert.deepEqual(body.tools.map(tool=>tool.function.name),['run_code']);record('Coding exposes only the PTC tool transport');send(res,body.model,{role:'assistant',tool_calls:[{index:0,id:'base-runtime',type:'function',function:{name:'load_workspace_dependencies',arguments:'{}'}}]},'tool_calls');return}
      const dependencies=toolResult(body);assert.equal(dependencies.documents.state,'absent');assert.equal(dependencies.python,undefined);assert(fs.existsSync(dependencies.node));assert(fs.existsSync(dependencies.pnpm));
      send(res,body.model,{content:'Core remains available without optional services.'},'stop');return;
     }
     if(delivering){
      let name='deliver_project',args;
      if(deliveryStep===0)args={action:'start',recipe:{kind:'app',directory:workspace,buildCommand:'node build.mjs',checks:['node verify.mjs'],repositoryName:'local-fixture-app',artifacts:['app.cjs'],production:false}};
      else if(deliveryStep===1){deliveryJob=toolResult(body).jobId;assert(deliveryJob);name='job_output';args={job_id:deliveryJob,wait:true,timeout_ms:30000}}
      else if(deliveryStep===2){const receipt=toolResult(body);assert.equal(receipt.phase,'complete');assert.equal(receipt.artifacts.length,1);assert.equal(receipt.artifacts[0].size,fs.statSync(path.join(workspace,'app.cjs')).size);assert.match(receipt.artifacts[0].sha256,/^[a-f0-9]{64}$/);args={action:'status'}}
      else{assert.equal(toolResult(body).run.phase,'complete');send(res,body.model,{content:'Application build and artifact verification passed.'},'stop');return}
      deliveryStep++;send(res,body.model,{role:'assistant',tool_calls:[{index:0,id:'delivery-'+deliveryStep,type:'function',function:{name,arguments:JSON.stringify(args)}}]},'tool_calls');return;
     }
     let name='desktop_browser',args;
     if(step===0){name='decision_check';args=review}
     else if(step===1){assert.equal(toolResult(body).answers.review.choice,'check_behavior');args={action:'open',url:base+'form'}}
     else if(step===5){const seen=toolResult(body);assert.equal(seen.engine,'Spider (Rust)');assert(seen.pages.some(p=>p.title==='Draft editor'&&p.text.includes('Local verification')));record('Packaged Rust crawler reads the local page through its isolated worker');send(res,body.model,{content:finalCount++===0?'Workspace verification passed.':'Final decision review complete.'},'stop');return}
     else{
      const seen=toolResult(body);assert.equal(seen.state.error,undefined);
      if(step===2){const field=seen.elements.find(x=>x.name==='Caption');assert(field);args={action:'fill',tabId:seen.state.tabId,revision:seen.state.revision,ref:field.ref,value:'Strugend test draft'}}
      else if(step===3){assert.equal(seen.elements.find(x=>x.name==='Caption').value,'Strugend test draft');args={action:'click',tabId:seen.state.tabId,revision:seen.state.revision,ref:seen.elements.find(x=>x.name==='Save draft').ref}}
      else {assert(seen.text.includes('Saved: Strugend test draft'),'Click result: '+seen.text);name='crawl_website';args={url:base+'form',maxPages:1,maxDepth:1,timeoutMs:25000}}
     }
     step++;send(res,body.model,{role:'assistant',tool_calls:[{index:0,id:'verify-'+step,type:'function',function:{name,arguments:JSON.stringify(args)}}]},'tool_calls');return;
    }
   }catch(error){errors.push(String(error));if(req.url.endsWith('/chat/completions'))send(res,body?.model||'local-test',{content:'Workspace verification failed.'},'stop');else{res.writeHead(500);res.end('{}')}return}
  }
  if(req.url==='/form'){
   // Focus moves the button before trusted pointer input reaches the page.
   res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Draft editor</title><style>body{font:18px system-ui;padding:30px;background:#eff2ed;color:#202432}label,input,button{display:block;margin:18px 0}input,button{padding:12px}</style><h1>Local verification</h1><label>Caption <input aria-label="Caption"></label><button onfocus="this.style.marginTop=\'120px\'" onclick="document.querySelector(\'output\').textContent=\'Saved: \'+document.querySelector(\'input\').value">Save draft</button><output></output>');return;
  }
  res.writeHead(404);res.end();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/`;
 fs.writeFileSync(path.join(home,'settings.yaml'),JSON.stringify({'ui-theme':{preference:'dark'},'llm-deepseek':{protocol:'chat-completions',thinking:'disabled',maxTokens:2048},'strugend-intelligence':{decisionMode:'remote',decisionUrl:base+'v1/systemone',timeoutMs:60000,advisorDeadlineMs:60000}}));
 const env={...process.env,DSH_TELEMETRY_DISABLED:'1',DSH_HOME:home,DSH_DESKTOP_HOST_PORT:'0',DSH_DESKTOP_OPEN_DEVTOOLS:'0',DEEPSEEK_API_KEY:'local-e2e-only',DEEPSEEK_BASE_URL:base+'v1'};
 for(const key of ['ELECTRON_RUN_AS_NODE','IMPOSSIBL_API_KEY','TYPESAFE_API_KEY','CHRONOGRAPH_TOKEN','STRUGEND_GITHUB_TOKEN','STRUGEND_VERCEL_TOKEN'])delete env[key];
 async function launch(){
  const started=Date.now();
  app=await electron.launch({executablePath:executable,args:[`--user-data-dir=${path.join(root,'chromium')}`],env,timeout:60000});
  const child=app.process();
  for(const stream of [child.stdout,child.stderr])stream?.on('data',data=>{mainLog=(mainLog+data.toString()).slice(-100000)});
  page=await app.firstWindow({timeout:60000});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));await page.waitForURL('dsh-app://app/');return started;
 }
 async function closeApp(){
  if(!app)return;
  const owned=app;app=undefined;const child=owned.process();
  const exited=child.exitCode!==null||child.signalCode!==null?Promise.resolve():once(child,'exit');
  let forced=false;
  const timer=setTimeout(()=>{forced=true;child.kill('SIGKILL')},10000);
  try{await owned.close()}finally{await exited;clearTimeout(timer)}
  if(forced)throw new Error('The packaged application did not exit within 10 seconds');
 }
 async function settings(){
  await page.locator('[data-strugend-topbar]').getByRole('button',{name:'Settings',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Settings',exact:true});
  await dialog.getByRole('button',{name:'Connections',exact:true}).click();
  await dialog.locator('summary').filter({hasText:/^Intelligence$/}).click();
  await dialog.getByLabel('Decision API key').waitFor();
 }
 async function closeSettings(){await page.getByRole('dialog',{name:'Settings',exact:true}).getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('dialog',{name:'Settings',exact:true}).waitFor({state:'hidden'});await page.locator('[contenteditable="true"]').first().waitFor()}
 async function newChat(){await page.locator('[data-strugend-topbar]').getByRole('button',{name:'New chat',exact:true}).last().click();await page.getByText('What shall we work on?',{exact:true}).waitFor();await page.locator('[contenteditable="true"]').first().waitFor()}
 const noVendor=async()=>{const text=await page.locator('body').innerText();assert(!/DeepSeek Harness|\bdsh\b|@deepseek-ai/i.test(text),'Visible upstream branding: '+text.match(/.{0,50}(DeepSeek Harness|\bdsh\b|@deepseek-ai).{0,50}/i)?.[0])};
 try{
  const started=await launch();await page.getByRole('button',{name:'Continue',exact:true}).click({timeout:60000});
  const initialComponents=await page.evaluate(async()=>{const response=await fetch('/api/strugend/components');return response.json()});
  if(!initialComponents.setupComplete)await page.getByRole('button',{name:'Skip for now',exact:true}).last().click({timeout:60000});
  await page.getByRole('dialog').waitFor({state:'hidden'});
  const componentsBefore=await page.evaluate(async()=>{const response=await fetch('/api/strugend/components');return response.json()});
  assert.equal(componentsBefore.setupComplete,true);assert(componentsBefore.components.every(x=>x.state==='absent'||x.state==='incompatible'));record('Fresh base opens with optional components absent and persists Skip');
  record('Cold launch reaches Strugend onboarding',{elapsedMs:Date.now()-started});
  await page.getByRole('button',{name:'Coding mode',exact:true}).waitFor();
  await page.getByRole('button',{name:'Coding mode',exact:true}).click();
  for(const label of ['Coding mode','Job mode','Normal mode','Repair mode'])await page.getByRole('menuitem',{name:new RegExp('^'+label)}).waitFor();
  await page.keyboard.press('Escape');
  assert(await page.locator('[data-strugend-topbar] img').evaluate(img=>img.complete&&img.naturalWidth>0));
  record('Coding is the default; all four task modes and the Strugend logo load');
  await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]})},workspace);
  await page.getByRole('button',{name:'Choose workspace',exact:true}).click();
  await page.getByText('What shall we work on?',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Choose workspace',exact:true}).getByText(path.basename(workspace),{exact:true}).waitFor();
  await page.locator('[contenteditable="true"]').first().waitFor();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,900));
  await page.waitForFunction(()=>innerWidth===1440);
  await noVendor();assert.equal(await page.locator('[data-agent-os-browser]').count(),0);
  await page.screenshot({path:path.join(OUT,'empty-chat.png')});
  assert.equal(await page.getByRole('button',{name:'History',exact:true}).getAttribute('aria-expanded'),'true');
  const initialHistory=await page.locator('#strugend-history').boundingBox(),initialComposer=await page.locator('[contenteditable="true"]').first().boundingBox();
  assert(initialHistory&&initialComposer&&initialComposer.x>=initialHistory.x+initialHistory.width,'Default history covers the composer');
  record('History opens beside the usable chat by default without vendor labels');
  const history=page.locator('#strugend-history');
  await history.getByText(path.basename(workspace),{exact:true}).waitFor();
  await history.getByRole('button',{name:'Add workspace',exact:true}).waitFor();
  await page.screenshot({path:path.join(OUT,'history-drawer.png')});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1024,600));
  await page.waitForFunction(()=>innerWidth===1024&&innerHeight===600);
  const historyLayout=await history.evaluate(drawer=>{
   const list=drawer.querySelector('[role="tree"][aria-label="Sessions"]');
   if(!list)throw new Error('History has no conversation tree');
   const box=list.getBoundingClientRect();
   const rows=[...list.querySelectorAll('[role="treeitem"]')];
   return {height:list.clientHeight,width:drawer.clientWidth,
    visibleRows:rows.filter(row=>{const rect=row.getBoundingClientRect();return rect.top>=box.top&&rect.bottom<=Math.min(box.bottom,innerHeight)}).length,
    titleWidths:[...list.querySelectorAll('[class$="_title"]')].map(title=>title.clientWidth),
    horizontalOverflow:drawer.scrollWidth>drawer.clientWidth};
  });
  assert(historyLayout.height>=130,'History conversations are squeezed by navigation controls');
  assert(historyLayout.visibleRows>=2,'Workspace and conversation must both remain visible');
  assert(historyLayout.titleWidths.length>=2&&historyLayout.titleWidths.every(width=>width>=220),'Conversation titles lack room');
  assert.equal(historyLayout.horizontalOverflow,false);
  await page.screenshot({path:path.join(OUT,'history-compact.png')});
  record('Compact history keeps readable conversations in a short window',historyLayout);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,900));
  await page.waitForFunction(()=>innerWidth===1440);
  await history.getByRole('button',{name:'Close history',exact:true}).click();
  await history.waitFor({state:'hidden'});record('History exposes workspace management and closes only when requested');
  const disabledVideo=await page.evaluate(async()=>{try{await window.agentOS.request({type:'media.import'});return ''}catch(error){return String(error)}});assert.match(disabledVideo,/coming soon/i);record('Video studio is unavailable through the native bridge as well as agent tools');
  const native=await app.evaluate(({app,nativeImage})=>{const image=nativeImage.createFromPath(process.resourcesPath+'/icon.png');return {name:app.getName(),empty:image.isEmpty(),size:image.getSize()}});
  assert.equal(native.empty,false);assert.deepEqual(native.size,{width:1024,height:1024});
  record('New desktop icon decodes; internal profile identity remains stable',{applicationName:native.name,size:native.size});
  await page.locator('[contenteditable="true"]').first().fill('Check whether optional Decision is configured; continue with Core if missing.');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.getByText(/^(Core remains available without optional services\.|Workspace verification failed\.)$/).waitFor({timeout:60000});assert.deepEqual(errors,[]);
  assert.equal(probeStep,2);assert.deepEqual(serviceCalls,[]);record('Absent Decision is omitted from Core tools and context; graph and video tools are absent');
  const messageSpacing=await page.locator('[data-chat-flow]').evaluate(flow=>{
   const rows=[...flow.children].filter(row=>!row.hasAttribute('hidden')&&row.getBoundingClientRect().height>0);
   return rows.slice(1).map((row,index)=>row.getBoundingClientRect().top-rows[index].getBoundingClientRect().bottom);
  });
  assert(messageSpacing.length>=3&&messageSpacing.every(gap=>gap>=0&&gap<=12.5),'Chat messages have excessive or overlapping gaps');
  record('Chat messages and responses use compact nonoverlapping spacing',{gaps:messageSpacing});
  probing=false;await newChat();
  await settings();
  for(const [role,value] of [['Decision','synthetic-decision-key']]){
   const input=page.getByLabel(role+' API key');await input.focus();
   await page.locator('[contenteditable="true"]').first().evaluate(element=>element.focus());
   assert(await input.evaluate(element=>document.activeElement===element),'Background composer stole credential focus');
   await page.keyboard.type(value);assert.equal(await input.inputValue(),value);assert.equal(await page.locator('[contenteditable="true"]').first().innerText(),'');
   await input.locator('xpath=ancestor::form').getByRole('button',{name:'Apply',exact:true}).click();
   await page.getByText('Saved. Credentials are checked when the service is used.').waitFor();await input.waitFor();assert.equal(await input.inputValue(),'');
  }
  assert.equal(await page.getByLabel('Memory API key').count(),0);assert.equal(await page.getByLabel('Memory service address').count(),0);await page.getByText('Coming soon',{exact:true}).waitFor();
  await page.getByLabel('Decision API key').locator('xpath=ancestor::form').getByRole('button',{name:'Test connection',exact:true}).click();
  await page.getByRole('status').getByText('Connection verified',{exact:true}).waitFor();
  await noVendor();await page.getByRole('heading',{name:'Intelligence',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(OUT,'intelligence-settings.png')});
  record('Intelligence tests Laya, saves a write-only key, disables graph settings and protects credential focus');
  await closeSettings();
  await page.locator('[contenteditable="true"]').first().fill('Check the test evidence and save a draft in the local verification page.');await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.getByText(/Workspace verification (passed|failed)\./).waitFor({timeout:60000});assert.deepEqual(errors,[]);assert.equal(step,5);assert(serviceCalls.length>=3);assert(serviceCalls.every(x=>x==='Decision'));
  const nativePage=await app.evaluate(async({webContents,BrowserWindow},url)=>{const view=webContents.getAllWebContents().find(w=>w.getURL()===url);if(!view)throw Error('Sidebar native page not found');const mounted=BrowserWindow.getAllWindows().flatMap(w=>w.contentView.children).find(child=>child.webContents===view);if(!mounted)throw Error('Browser page is not attached to the application window');return {visible:mounted.getVisible(),bounds:mounted.getBounds(),text:await view.executeJavaScript('document.body.innerText'),image:(await view.capturePage()).toDataURL()}},base+'form');
  assert.equal(nativePage.visible,true);assert(nativePage.bounds.width>100&&nativePage.bounds.height>100);assert(nativePage.text.includes('Saved: Strugend test draft'));fs.writeFileSync(path.join(OUT,'sidebar-form.png'),Buffer.from(nativePage.image.split(',')[1],'base64'));
  await page.screenshot({path:path.join(OUT,'chat-after-action.png')});
  await noVendor();record('Real agent loop operates the visible sidebar form after focus moves the button');
  await page.getByText('Workspace verification',{exact:true}).first().waitFor();
  await closeApp();
  const resources=process.platform==='darwin'?path.resolve(path.dirname(executable),'../Resources'):path.join(path.dirname(executable),'resources');
  const catalog=JSON.parse(fs.readFileSync(path.join(resources,'runtime','component-catalog.json'),'utf8'));
  const decisionPack=catalog.components.find(x=>x.id==='decision');assert(decisionPack);
  const staged=process.env.LAYA_COMPONENT_ROOT||path.join(APP,'.desktop-build','targets',`${process.platform==='darwin'?'mac':'win'}-${process.arch}`,'components','decision');
  const installedPack=path.join(home,'strugend-components','decision',decisionPack.version);
  fs.mkdirSync(path.dirname(installedPack),{recursive:true});fs.cpSync(staged,installedPack,{recursive:true,dereference:true});
  fs.writeFileSync(path.join(installedPack,'.installed.json'),JSON.stringify({sha256:decisionPack.sha256,version:decisionPack.version}));
  await launch();
  await page.getByText('Workspace verification passed.',{exact:true}).waitFor({timeout:60000});
  await page.waitForFunction(expected=>document.querySelector('[data-agent-os-browser] input')?.value===expected,base+'form');
  await settings();assert.equal(await page.getByLabel('Decision API key').getAttribute('placeholder'),'Configured — enter a new value to replace');
  record('Restart retains chat, browser URL and encrypted Decision key');
  await closeSettings();
  backgroundProbe=true;const primaryStarted=Date.now();
  await page.locator('[contenteditable="true"]').first().fill('Write the deterministic Core response while the auxiliary service is held pending.');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.getByText('Core completed while Decision was still pending.',{exact:true}).waitFor({timeout:15000});
  assert(serviceCalls.includes('Background held'));assert.deepEqual(errors,[]);
  backgroundProbe=false;record('Core completes before a held auxiliary response; background Decision does not block or add turns',{elapsedMs:Date.now()-primaryStarted});
  await settings();
  const runtime=await page.evaluate(async()=>{const response=await fetch('/api/strugend/decision/runtime');return response.json()});
  if(runtime.localAllowed){
  await page.getByLabel('Decision runtime').selectOption('local');
  const localCalls=serviceCalls.length;
  await page.getByLabel('Decision API key').locator('xpath=ancestor::form').getByRole('button',{name:'Test connection',exact:true}).click();
  await page.getByRole('status').getByText('Connection verified',{exact:true}).waitFor({timeout:90000});
  assert.equal(serviceCalls.length,localCalls);record('Packaged local Laya verifies a real decision with no API request');
  decisionFails=true;await page.getByLabel('Decision runtime').selectOption('auto');
  await page.getByLabel('Decision API key').locator('xpath=ancestor::form').getByRole('button',{name:'Test connection',exact:true}).click();
  await page.getByRole('status').getByText('Connection verified',{exact:true}).waitFor({timeout:90000});
  assert.equal(serviceCalls.length,localCalls+1);record('Unavailable remote Decision automatically falls back to the installed optional model');
  } else {assert.equal(runtime.resident,false);record('Memory admission keeps local weights unloaded',{reason:runtime.reason})}
  await page.getByLabel('Decision runtime').selectOption('remote');
  decisionFails=false;
  await closeSettings();
  await page.evaluate(folder=>window.agentOS.request({type:'location.open',path:folder}),workspace);
  record('Native location bridge opens the real workspace in Finder or File Explorer');
  const missingLocation=await page.evaluate(async folder=>{try{await window.agentOS.request({type:'location.open',path:folder});return ''}catch(error){return String(error)}},path.join(workspace,'missing-location'));
  assert.match(missingLocation,/moved|exist/i);record('Native location failure reaches the caller instead of reporting success');
  fs.writeFileSync(path.join(workspace,'build.mjs'),"import {writeFileSync} from 'node:fs'; writeFileSync('app.cjs', 'console.log(42)');");
  fs.writeFileSync(path.join(workspace,'verify.mjs'),"import {execFileSync} from 'node:child_process'; import assert from 'node:assert/strict'; assert.equal(execFileSync(process.execPath, ['app.cjs'], {encoding:'utf8'}).trim(), '42');");
  delivering=true;
  await page.locator('[contenteditable="true"]').first().fill('Build the fixture application locally and verify the real artifact; keep it local.');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.getByText(/^(Application build and artifact verification passed\.|Workspace verification failed\.)$/).first().waitFor({timeout:120000});
  assert.deepEqual(errors,[]);assert.equal(deliveryStep,3);record('Agent starts a delivery job, builds and executes a local application, and collects its hashed receipt');
  delivering=false;
  await newChat();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(880,600));await page.waitForFunction(()=>innerWidth===880);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(OUT,'empty-chat-small.png')});
  record('New chat fits the minimum window width without horizontal overflow');
  await page.addInitScript(()=>{let gate;Object.defineProperty(window,'__DSH_BOOT_READY__',{configurable:true,get:()=>gate,set:value=>{gate=value;const resolve=value.resolve;value.resolve=(...args)=>{window.__releaseStrugendBoot=()=>resolve(...args)}}})});
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'no-preference'});await page.reload();await page.waitForFunction(()=>typeof window.__releaseStrugendBoot==='function'&&document.querySelector('[data-dsh-boot] img')?.naturalWidth===512);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,900));await page.waitForFunction(()=>innerWidth===1440);await noVendor();await page.screenshot({path:path.join(OUT,'loading-dark.png')});
  await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});const reduced=await page.evaluate(()=>({mark:getComputedStyle(document.querySelector('[data-dsh-boot] img')).animationName,track:getComputedStyle(document.querySelector('[data-dsh-boot-spinner]'),'::after').animationName}));assert.equal(reduced.mark,'none');assert.equal(reduced.track,'none');await page.screenshot({path:path.join(OUT,'loading-light.png')});
  await page.evaluate(()=>window.__releaseStrugendBoot());await page.locator('[data-dsh-boot]').waitFor({state:'detached',timeout:60000});await page.locator('[contenteditable="true"]').first().waitFor();assert.deepEqual(errors,[]);
  record('Branded loading supports light/dark, reduced motion and a clean handoff');
  fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({passed:true,provider:'Deterministic Core and remote Decision fixtures; graph disabled',localInference:runtime.localAllowed?'exercised':'skipped-memory-admission',checks,serviceCalls,errors},null,2));
 }catch(error){fs.writeFileSync(path.join(OUT,'errors.json'),JSON.stringify(errors,null,2));if(errors.length)console.error('Fixture errors:',errors);if(page){await page.screenshot({path:path.join(OUT,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(OUT,'failure-dom.txt'),await page.locator('body').innerText().catch(()=>''))}throw error}
 finally{try{await closeApp()}finally{fs.writeFileSync(path.join(OUT,'main.log'),redact(mainLog));server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}}
})().catch(error=>{console.error(String(error.message).split('Browser logs:')[0].replace(/token=[^\s]+/g,'token=[redacted]'));process.exitCode=1});
