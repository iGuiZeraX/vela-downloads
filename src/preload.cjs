const {contextBridge,ipcRenderer}=require('electron');
const call=(name)=>(data)=>ipcRenderer.invoke('vela:'+name,data);
contextBridge.exposeInMainWorld('vela',{
  snapshot:call('snapshot'),add:call('add'),action:call('action'),
  pauseAll:call('pause-all'),resumeAll:call('resume-all'),settings:call('settings'),
  chooseFolder:call('folder'),copyToken:call('copy-token'),openExtensionFolder:call('open-extension'),
  windowControl:call('window'),
  onUpdate(callback){const listener=(_,data)=>callback(data);ipcRenderer.on('vela:update',listener);return()=>ipcRenderer.removeListener('vela:update',listener);}
});
