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
const OUT = path.join(REPO, '.artifacts/strugend/packaged-' + process.platform + '-' + process.arch);
(async () => {
 fs.mkdirSync(OUT, {recursive:true});
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'strugend-e2e-'));
 const home=path.join(root,'home'), workspace=path.join(root,'workspace');
 fs.mkdirSync(home); fs.mkdirSync(workspace);
 const errors=[], checks=[], serviceCalls=[]; let app,page,base,step=0,probeStep=0,probing=true,mainLog='';
 const redact=value=>value.replace(/token=[^\s]+/g,'token=[redacted]');
 const record=(name,data={})=>{checks.push({name,...data}); console.log('PASS:',name)};
 const send=(res,model,delta,finish)=>{res.setHeader('Content-Type','text/event-stream');for(const[d,f]of[[delta,null],[{},finish]])res.write('data: '+JSON.stringify({id:'strugend-e2e',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model,choices:[{index:0,delta:d,finish_reason:f}]})+'\n\n');res.end('data: [DONE]\n\n')};
 const toolResult=body=>{const message=[...body.messages].reverse().find(x=>x.role==='tool');assert(message,'Missing tool result');const content=typeof message.content==='string'?message.content:message.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');return JSON.parse(content.split('\n')[0])};
 const questions={evidence:{type:'noul',instructions:'Does the supplied test evidence show a saved draft?'}};
 const server=http.createServer(async(req,res)=>{
  if(req.method==='POST'){
   let body;
   try{
    let raw=''; for await(const chunk of req)raw+=chunk; body=JSON.parse(raw);
    if(req.url==='/v1/systemone'){
     assert.equal(req.headers.authorization,'Bearer synthetic-decision-key');
     assert.deepEqual(body,{model:'jev-latest',state:'The local form reported Saved: draft.',questions});
     serviceCalls.push('Decision');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({model:'jev-fixture',answers:{evidence:{type:'noul',noul:0.94}},usage:{input_tokens:16,output_tokens:2}}));return;
    }
    if(req.url==='/v1/stats'){
     assert.equal(req.headers.authorization,'Bearer synthetic-memory-token');assert.deepEqual(body,{});
     serviceCalls.push('Memory');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({nodes:'3',edges:'2'}));return;
    }
    if(req.url.endsWith('/chat/completions')){
     if(!body.tools){send(res,body.model,{content:JSON.stringify(body.messages).includes('whether optional')?'Optional service check':'Workspace verification'},'stop');return}
     assert(body.tools.some(x=>x.function?.name==='decision_check'));
     assert(body.tools.some(x=>x.function?.name==='memory_graph'));
     assert(body.tools.some(x=>x.function?.name==='crawl_website'));
     if(probing){
      let name,args;
      if(probeStep===0){name='decision_check';args={model:'jev-latest',state:'No keys are configured.',questions}}
      else if(probeStep===1){assert.equal(toolResult(body).available,false);name='memory_graph';args={action:'stats'}}
      else{assert.equal(toolResult(body).available,false);send(res,body.model,{content:'Core remains available without optional services.'},'stop');return}
      probeStep++;send(res,body.model,{role:'assistant',tool_calls:[{index:0,id:'probe-'+probeStep,type:'function',function:{name,arguments:JSON.stringify(args)}}]},'tool_calls');return;
     }
     let name='desktop_browser',args;
     if(step===0){name='decision_check';args={model:'jev-latest',state:'The local form reported Saved: draft.',questions}}
     else if(step===1){const seen=toolResult(body);assert.equal(seen.answers.evidence.noul,0.94);name='memory_graph';args={action:'stats'}}
     else if(step===2){assert.equal(toolResult(body).nodes,'3');args={action:'open',url:base+'form'}}
     else if(step===6){const seen=toolResult(body);assert.equal(seen.engine,'Spider (Rust)');assert(seen.pages.some(p=>p.title==='Draft editor'&&p.text.includes('Local verification')));record('Packaged Rust crawler reads the local page through its isolated worker');send(res,body.model,{content:'Workspace verification passed.'},'stop');return}
     else{
      const seen=toolResult(body);assert.equal(seen.state.error,undefined);
      if(step===3){const field=seen.elements.find(x=>x.name==='Caption');assert(field);args={action:'fill',tabId:seen.state.tabId,revision:seen.state.revision,ref:field.ref,value:'Strugend test draft'}}
      else if(step===4){assert.equal(seen.elements.find(x=>x.name==='Caption').value,'Strugend test draft');args={action:'click',tabId:seen.state.tabId,revision:seen.state.revision,ref:seen.elements.find(x=>x.name==='Save draft').ref}}
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
 fs.writeFileSync(path.join(home,'settings.yaml'),JSON.stringify({'ui-theme':{preference:'dark'},'llm-deepseek':{protocol:'chat-completions',thinking:'disabled',maxTokens:2048},'strugend-intelligence':{decisionUrl:base+'v1/systemone'}}));
 const env={...process.env,DSH_TELEMETRY_DISABLED:'1',DSH_HOME:home,DSH_DESKTOP_HOST_PORT:'0',DSH_DESKTOP_OPEN_DEVTOOLS:'0',DEEPSEEK_API_KEY:'local-e2e-only',DEEPSEEK_BASE_URL:base+'v1'};
 for(const key of ['ELECTRON_RUN_AS_NODE','TYPESAFE_API_KEY','CHRONOGRAPH_TOKEN'])delete env[key];
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
 async function settings(){await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Intelligence',exact:true}).click();await page.getByLabel('Decision API key').waitFor()}
 async function closeSettings(){await page.keyboard.press('Escape');await page.locator('[contenteditable="true"]').first().waitFor()}
 const noVendor=async()=>{const text=await page.locator('body').innerText();assert(!/deepseek|\bdsh\b/i.test(text),'Visible vendor name: '+text.match(/.{0,50}(deepseek|\bdsh\b).{0,50}/i)?.[0])};
 try{
  const started=await launch();await page.getByRole('button',{name:'Continue',exact:true}).click({timeout:60000});await page.getByRole('dialog').waitFor({state:'hidden'});
  record('Cold launch reaches Strugend onboarding',{elapsedMs:Date.now()-started});
  await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]})},workspace);
  await page.getByRole('button',{name:'Choose workspace',exact:true}).click();
  await page.getByText('What shall we work on?',{exact:true}).waitFor();
  await page.locator('[contenteditable="true"]').first().waitFor();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,900));
  await page.waitForFunction(()=>innerWidth===1440);
  await noVendor();assert.equal(await page.locator('[data-agent-os-browser]').count(),0);
  await page.screenshot({path:path.join(OUT,'empty-chat.png')});
  record('Minimal empty chat hides tools until needed and has no vendor labels');
  const native=await app.evaluate(({app,nativeImage})=>{const image=nativeImage.createFromPath(process.resourcesPath+'/icon.png');return {name:app.getName(),empty:image.isEmpty(),size:image.getSize()}});
  assert.equal(native.empty,false);assert.deepEqual(native.size,{width:1024,height:1024});
  record('New desktop icon decodes; internal profile identity remains stable',{applicationName:native.name,size:native.size});
  await page.locator('[contenteditable="true"]').first().fill('Check whether optional Decision and Memory services are configured; continue with Core if missing.');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.getByText('Core remains available without optional services.',{exact:true}).waitFor({timeout:60000});
  assert.equal(probeStep,2);assert.deepEqual(serviceCalls,[]);record('Missing Decision and Memory return clear unavailable results without network calls or blocking Core');
  probing=false;await page.getByRole('button',{name:'New chat',exact:true}).last().click();await page.locator('[contenteditable="true"]').first().waitFor();
  await settings();
  for(const [role,value] of [['Decision','synthetic-decision-key'],['Memory','synthetic-memory-token']]){
   const input=page.getByLabel(role+' API key');await input.focus();
   await page.locator('[contenteditable="true"]').first().evaluate(element=>element.focus());
   assert(await input.evaluate(element=>document.activeElement===element),'Background composer stole credential focus');
   await page.keyboard.type(value);assert.equal(await input.inputValue(),value);assert.equal(await page.locator('[contenteditable="true"]').first().innerText(),'');
   await input.locator('xpath=ancestor::form').getByRole('button',{name:'Apply',exact:true}).click();
   await page.getByText('Saved. Credentials are checked when the service is used.').waitFor();await input.waitFor();assert.equal(await input.inputValue(),'');
  }
  const address=page.getByLabel('Memory service address');await address.fill(base.slice(0,-1));await address.locator('xpath=ancestor::form').getByRole('button',{name:'Apply',exact:true}).click();
  await page.getByText('Saved. Credentials are checked when the service is used.').waitFor();
  await noVendor();await page.getByRole('heading',{name:'Intelligence',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(OUT,'intelligence-settings.png')});
  record('Intelligence saves write-only Decision and Memory keys plus graph origin; background autofocus cannot capture credentials');
  await closeSettings();
  await page.locator('[contenteditable="true"]').first().fill('Check the test evidence, read related memory, and save a draft in the local verification page.');await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.getByText(/Workspace verification (passed|failed)\./).waitFor({timeout:60000});assert.deepEqual(errors,[]);assert.equal(step,6);assert.deepEqual(serviceCalls,['Decision','Memory']);
  const nativePage=await app.evaluate(async({webContents,BrowserWindow},url)=>{const view=webContents.getAllWebContents().find(w=>w.getURL()===url);if(!view)throw Error('Sidebar native page not found');const mounted=BrowserWindow.getAllWindows().flatMap(w=>w.contentView.children).find(child=>child.webContents===view);if(!mounted)throw Error('Browser page is not attached to the application window');return {visible:mounted.getVisible(),bounds:mounted.getBounds(),text:await view.executeJavaScript('document.body.innerText'),image:(await view.capturePage()).toDataURL()}},base+'form');
  assert.equal(nativePage.visible,true);assert(nativePage.bounds.width>100&&nativePage.bounds.height>100);assert(nativePage.text.includes('Saved: Strugend test draft'));fs.writeFileSync(path.join(OUT,'sidebar-form.png'),Buffer.from(nativePage.image.split(',')[1],'base64'));
  await page.screenshot({path:path.join(OUT,'chat-after-action.png')});
  await noVendor();record('Real agent loop operates the visible sidebar form after focus moves the button');
  await page.getByText('Workspace verification',{exact:true}).first().waitFor();
  await closeApp();await launch();
  await page.getByText('Workspace verification',{exact:true}).first().waitFor({timeout:60000});await page.getByText('Workspace verification',{exact:true}).first().click();
  await page.getByText('Workspace verification passed.',{exact:true}).waitFor();
  await page.waitForFunction(expected=>document.querySelector('[data-agent-os-browser] input')?.value===expected,base+'form');
  await settings();assert.equal(await page.getByLabel('Decision API key').getAttribute('placeholder'),'Configured — enter a new value to replace');assert.equal(await page.getByLabel('Memory API key').getAttribute('placeholder'),'Configured — enter a new value to replace');assert.equal(await page.getByLabel('Memory service address').inputValue(),base.slice(0,-1));
  record('Restart retains chat, browser URL, encrypted service keys and graph address');await closeSettings();
  await page.getByRole('button',{name:'New chat',exact:true}).last().click();await page.getByText('What shall we work on?',{exact:true}).waitFor();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(880,600));await page.waitForFunction(()=>innerWidth===880);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(OUT,'empty-chat-small.png')});
  record('New chat fits the minimum window width without horizontal overflow');
  await page.addInitScript(()=>{let gate;Object.defineProperty(window,'__DSH_BOOT_READY__',{configurable:true,get:()=>gate,set:value=>{gate=value;const resolve=value.resolve;value.resolve=(...args)=>{window.__releaseStrugendBoot=()=>resolve(...args)}}})});
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'no-preference'});await page.reload();await page.waitForFunction(()=>typeof window.__releaseStrugendBoot==='function'&&document.querySelector('[data-dsh-boot] img')?.naturalWidth===512);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,900));await page.waitForFunction(()=>innerWidth===1440);await noVendor();await page.screenshot({path:path.join(OUT,'loading-dark.png')});
  await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});const reduced=await page.evaluate(()=>({mark:getComputedStyle(document.querySelector('[data-dsh-boot] img')).animationName,track:getComputedStyle(document.querySelector('[data-dsh-boot-spinner]'),'::after').animationName}));assert.equal(reduced.mark,'none');assert.equal(reduced.track,'none');await page.screenshot({path:path.join(OUT,'loading-light.png')});
  await page.evaluate(()=>window.__releaseStrugendBoot());await page.locator('[data-dsh-boot]').waitFor({state:'detached',timeout:60000});await page.locator('[contenteditable="true"]').first().waitFor();assert.deepEqual(errors,[]);
  record('Branded loading supports light/dark, reduced motion and a clean handoff');
  fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({passed:true,provider:'Local deterministic fixtures; live Jev and Chronograph not tested',checks,serviceCalls,errors},null,2));
 }catch(error){if(page){await page.screenshot({path:path.join(OUT,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(OUT,'failure-dom.txt'),await page.locator('body').innerText().catch(()=>''))}throw error}
 finally{try{await closeApp()}finally{fs.writeFileSync(path.join(OUT,'main.log'),redact(mainLog));server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}}
})().catch(error=>{console.error(String(error.message).split('Browser logs:')[0].replace(/token=[^\s]+/g,'token=[redacted]'));process.exitCode=1});
