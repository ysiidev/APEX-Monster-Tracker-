const {JSDOM, VirtualConsole} = require('jsdom'); const fs = require('fs'); const assert = require('assert');
let data=JSON.parse(fs.readFileSync('app/snapshot.json','utf8')); let errors=[];
const wait=()=>new Promise(r=>setTimeout(r,200));
(async()=>{
 let vc=new VirtualConsole(); vc.on('jsdomError',e=>errors.push(e.message)); vc.on('error',e=>errors.push(String(e)));
 const dom=await JSDOM.fromFile('app/index.html',{runScripts:'dangerously',resources:'usable',virtualConsole:vc,beforeParse(w){ let listener; w.scrollTo=()=>{}; w.chrome={webview:{addEventListener(type,fn){listener=fn},postMessage(req){let val=null; if(req.op==='read') val=data; if(req.op==='write') data=JSON.parse(JSON.stringify(req.value)); if(req.op==='backup'||req.op==='csv') val=true; setTimeout(()=>listener({data:{id:req.id,value:JSON.parse(JSON.stringify(val))}}),0);}}}; }});
 await wait(); const d=dom.window.document;
 console.log('page errors',errors); console.log('banner',d.querySelector('#banner').textContent, 'hidden:',d.querySelector('#banner').hidden);
 assert.equal(errors.length,0); assert.equal(d.querySelector('#banner').hidden,true); assert(d.body.textContent.includes('Rebecca')); console.log('existing data loaded');
 for(const name of ['tracker','statistics','accounting','money','history','stock']) {dom.window.location.hash=name; await wait(); console.log('route',name,'view?', !d.querySelector('#view-'+name).hidden);}
 dom.window.location.hash='tracker'; await wait(); d.querySelector('#f-buyer').value='TEST BUYER'; d.querySelector('#f-qty').value='1'; d.querySelector('#f-price').value='95';
 d.querySelector('#sale-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})); await wait(); console.log('sale message',d.querySelector('#sale-msg').textContent); assert.equal(data.sales.length,5); assert.equal(data.sales[4].buyer,'TEST BUYER'); console.log('sales write passes');
 d.querySelector('#backup-data').click(); await wait(); assert(d.querySelector('#backup-status').textContent.includes('saved')); console.log('backup command passes'); assert.equal(errors.length,0); dom.window.close();
})().catch(e=>{console.error(e);process.exit(1)});
