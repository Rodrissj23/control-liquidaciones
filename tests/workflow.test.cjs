const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function harness() {
 const elements = new Map(), stored = new Map();
 const get = selector => { if (!elements.has(selector)) elements.set(selector,{value:'',files:[],disabled:false,hidden:false,textContent:'',innerHTML:'',classList:{toggle(){}},scrollIntoView(){}}); return elements.get(selector); };
 const context = vm.createContext({ console,crypto:require('node:crypto').webcrypto,setInterval(){},
  document:{querySelector:get,querySelectorAll(){return[];}},window:{},
  localStorage:{getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)} });
 for (const name of ['core.js','numeric-fix.js','app.js','pdf-support.js','truncated-value-fix.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),context);
 return {context,get,stored,run:code=>vm.runInContext(code,context)};
}
test('upload → compare → resolve → save → close keeps missing data visible', async()=>{
 const h=harness();
 const rows=[{src:'ALTAS',dni:'30123456',cuil:'20301234569',nombre:'<img src=x onerror=alert(1)>',plan:'A2',capitas:null,valorPlan:100000,descuento:30,liquidable:70000,row:2}];
 h.context.rowsA=rows;h.context.rowsV=[{...rows[0],src:'VENTAS',capitas:2}];
 h.run("read = async (file,src) => src === 'ALTAS' ? rowsA : rowsV");
 for (const id of ['altas','ventas']) {h.get('#'+id).files=[{name:id+'.pdf',size:100}];await h.run(`selectFile('${id}')`);}
 assert.equal(h.get('#analyze').disabled,false);
 assert.match(h.get('#altas-summary').innerHTML,/Cápitas/);
 h.get('#analyze').onclick();
 assert.equal(h.get('#close-control').disabled,true);
 assert.match(h.get('#review-list').innerHTML,/CÁPITAS SIN DATO VÁLIDO/);
 assert.ok(!h.get('#review-list').innerHTML.includes('<img src=x'));
 h.run("current.cases[0].resolution='ACEPTADA_MANUALMENTE'; current.cases[0].note='Cápitas revisadas'; closeState()");
 assert.equal(h.get('#close-control').disabled,false);
 h.get('#save-control').onclick();
 assert.equal(h.run('storage()[0].cases[0].note'),'Cápitas revisadas');
 h.get('#close-control').onclick();
 assert.equal(h.get('#download-report').disabled,false);
 assert.equal(h.run('storage()[0].closed'),true);
});
test('replacing an upload cannot reuse a stale previous parse',async()=>{
 const h=harness();let finish;
 h.context.pending=new Promise(resolve=>finish=resolve);
 h.run('read = async () => pending');
 h.get('#altas').files=[{name:'original.pdf',size:1}];
 const pending=h.run("selectFile('altas')");
 h.get('#altas').files=[];await h.run("selectFile('altas')");
 finish([{src:'ALTAS',dni:'30123456'}]);await pending;
 assert.equal(h.get('#analyze').disabled,true);assert.equal(h.run('uploads.altas.rows'),undefined);
});
test('storage failure prevents closed control and report download',()=>{
 const h=harness();
 h.run("current={id:'demo',period:'2026-09',createdAt:new Date().toISOString(),files:{altas:'a',ventas:'v'},cases:[],closed:false};localStorage.setItem=()=>{throw Error('full')}");
 h.get('#close-control').onclick();
 assert.equal(h.run('current.closed'),false);assert.equal(h.get('#download-report').disabled,true);assert.match(h.get('#helper').textContent,/No se pudo guardar/);
});
