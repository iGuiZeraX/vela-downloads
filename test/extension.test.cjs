const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
function harness({automatic=true,fail=false}={}){
 const listeners={},events=[];
 const event=name=>({addListener:fn=>listeners[name]=fn});
 const chrome={runtime:{onInstalled:event('installed'),onMessage:event('message')},contextMenus:{create:()=>{},onClicked:event('context')},
 storage:{local:{get:async()=>({automatic,token:'a'.repeat(64)}),set:async()=>{}}},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
 downloads:{onCreated:event('created'),pause:async()=>events.push('pause'),cancel:async()=>events.push('cancel'),resume:async()=>events.push('resume')}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../extension/background.js'),'utf8'),{chrome,AbortSignal,fetch:async()=>{events.push('send');if(fail)throw new Error('Offline');return{ok:true,json:async()=>({ok:true})};}});
 return {listeners,events};
}
test('Chrome download is cancelled only after Vela acknowledgement',async()=>{const {listeners,events}=harness();await listeners.created({id:1,url:'https://example.com/file.zip',state:'in_progress'});assert.deepEqual(events,['pause','send','cancel']);});
test('Chrome resumes the original download when Vela is offline',async()=>{const {listeners,events}=harness({fail:true});await listeners.created({id:1,url:'https://example.com/file.zip',state:'in_progress'});assert.deepEqual(events,['pause','send','resume']);});
test('capture remains opt-in; blob URLs and other extensions are not intercepted',async()=>{for(const options of [{automatic:false,item:{url:'https://example.com/x'}},{item:{url:'blob:https://example.com/1'}},{item:{url:'https://example.com/x',byExtensionId:'other'}}]){const {listeners,events}=harness(options);await listeners.created({id:1,state:'in_progress',...options.item});assert.equal(events.length,0);}});
