const fs=require('node:fs');
const fsp=fs.promises;
const {pipeline}=require('node:stream/promises');

async function writeWithProgress(input,destination,{signal,flags='w',onProgress}) {
  const output=fs.createWriteStream(destination,{flags,highWaterMark:1024*1024});
  let created=false;
  output.once('open',()=>{created=true;});
  const timer=setInterval(()=>onProgress(output.bytesWritten),100);
  try {
    await pipeline(input,output,{signal});
    onProgress(output.bytesWritten);
  }catch(error){
    // Never remove a pre-existing destination when exclusive creation failed.
    if(created&&flags==='wx')await fsp.unlink(destination).catch(()=>{});
    throw error;
  }finally{clearInterval(timer);}
}

async function syncFile(filename) {
  const handle=await fsp.open(filename,'r+');
  try{await handle.sync();}finally{await handle.close();}
}

module.exports={writeWithProgress,syncFile};
