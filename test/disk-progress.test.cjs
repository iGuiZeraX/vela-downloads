const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {Readable}=require('node:stream');
const {writeWithProgress}=require('../src/disk-progress.cjs');
const progress=require('../src/renderer/progress.js');

test('100 percent is reserved for a completed file; disk progress is distinct from reception',()=>{
 const d={status:'downloading',size:100,downloaded:100,diskTotal:100,diskWritten:40};
 assert.equal(progress({...d,phase:'transferring'}).percent,99);
 assert.equal(progress({...d,phase:'assembling'}).percent,40);
 assert.equal(progress({...d,phase:'copying'}).label,'Salvando no disco');
 assert.equal(progress({...d,phase:'syncing',diskWritten:100}).percent,99);
 assert.equal(progress({...d,status:'completed'}).percent,100);
});

test('disk progress counts written bytes and exclusive creation preserves an existing file',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vela-disk-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const target=path.join(dir,'output'),body=Buffer.alloc(2*1024*1024,41);const samples=[];
 await writeWithProgress(Readable.from([body]),target,{flags:'wx',onProgress:n=>samples.push(n)});
 assert.equal(samples.at(-1),body.length);assert.deepEqual(await fs.readFile(target),body);
 await assert.rejects(writeWithProgress(Readable.from(['replacement']),target,{flags:'wx',onProgress:()=>{}}),{code:'EEXIST'});
 assert.deepEqual(await fs.readFile(target),body);
});

test('interrupted final copy removes only its own partial destination',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vela-copy-abort-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const target=path.join(dir,'output'),controller=new AbortController();
 const input=Readable.from((async function*(){yield Buffer.alloc(1024);await new Promise(r=>setTimeout(r,30));controller.abort();yield Buffer.alloc(1024);})());
 await assert.rejects(writeWithProgress(input,target,{flags:'wx',signal:controller.signal,onProgress:()=>{}}),{name:'AbortError'});
 await assert.rejects(fs.stat(target),{code:'ENOENT'});
});
