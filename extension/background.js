const API='http://127.0.0.1:17839';
chrome.runtime.onInstalled.addListener(()=>{
  chrome.contextMenus.create({id:'vela-send',title:'Baixar com o Vela',contexts:['link','image','audio','video']});
});
async function send(url,filename){
  const {token}=await chrome.storage.local.get('token');
  if(!token)throw new Error('Conecte o Vela pelo ícone da extensão.');
  if(!/^https?:\/\//i.test(url))throw new Error('Este tipo de link não é um arquivo HTTP/HTTPS direto.');
  const response=await fetch(API+'/downloads',{method:'POST',headers:{'Content-Type':'application/json','X-Vela-Token':token},body:JSON.stringify({urls:[url],filename}),signal:AbortSignal.timeout(10000)});
  const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Não foi possível enviar ao Vela.');
  await chrome.action.setBadgeText({text:''});
  return result;
}
async function failed(error){
  await chrome.storage.local.set({lastError:error.message||'Abra o aplicativo Vela e tente novamente.'});
  await chrome.action.setBadgeBackgroundColor({color:'#b34638'});await chrome.action.setBadgeText({text:'!'});
}
chrome.contextMenus.onClicked.addListener(info=>{if(info.menuItemId==='vela-send')send(info.linkUrl||info.srcUrl).catch(failed);});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message?.type!=='send')return;
  send(message.url).then(()=>reply({ok:true})).catch(e=>reply({error:e.message}));return true;
});
chrome.downloads.onCreated.addListener(async item=>{
  const {automatic}=await chrome.storage.local.get('automatic');
  if(!automatic || item.byExtensionId || !/^https?:\/\//i.test(item.finalUrl||item.url)||item.state!=='in_progress')return;
  let paused=false;
  try{
    await chrome.downloads.pause(item.id);paused=true;
    await send(item.finalUrl||item.url,item.filename?.split(/[\\/]/).pop()||undefined);
    await chrome.downloads.cancel(item.id);
  }catch(e){if(paused)await chrome.downloads.resume(item.id).catch(()=>{});await failed(e);}
});
