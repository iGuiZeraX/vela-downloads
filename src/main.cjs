const {app,BrowserWindow,ipcMain,dialog,shell,clipboard,Notification,nativeImage,nativeTheme}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {randomBytes}=require('node:crypto');
const {DownloadEngine}=require('./engine.cjs');
const {startBridge}=require('./bridge.cjs');
let win,engine,server,token,quitting=false,bridgeError=null;
const root=path.join(__dirname,'renderer','index.html');
const rootURL=pathToFileURL(root).href;
if(!app.requestSingleInstanceLock()) app.quit();
else {
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
app.whenReady().then(async()=>{
  app.setAppUserModelId('org.vela.downloads');
  nativeTheme.themeSource='dark';
  const dataDir=process.env.VELA_DATA_DIR || app.getPath('userData');
  fs.mkdirSync(dataDir,{recursive:true});
  const tokenPath=path.join(dataDir,'bridge-token');
  try{token=fs.readFileSync(tokenPath,'utf8').trim();}catch{token=randomBytes(32).toString('hex');fs.writeFileSync(tokenPath,token,{mode:0o600});}
  engine=new DownloadEngine({dataDir,downloadDir:process.env.VELA_DOWNLOAD_DIR || path.join(app.getPath('downloads'),'Vela')});
  try{server=await startBridge(engine,token);}catch(e){bridgeError='A porta de integração está ocupada. Feche outra instância ou o programa que usa a porta 17839.';}
  const extensionPath=app.isPackaged?path.join(process.resourcesPath,'extension'):path.join(app.getAppPath(),'extension');
  const snapshot=()=>({...engine.snapshot(),version:app.getVersion(),bridge:{port:17839,token,extensionPath,error:bridgeError}});
  const channels={
    snapshot:()=>snapshot(),
    add:data=>{engine.add(data);return snapshot();},
    action:async data=>{
      const d=engine.downloads.find(x=>x.id===data?.id);
      if(['open','reveal'].includes(data?.action)) {
        if(!d?.filePath || d.status!=='completed') throw new Error('O arquivo ainda não está disponível.');
        if(data.action==='reveal')shell.showItemInFolder(d.filePath);
        else {const result=await dialog.showMessageBox(win,{type:'question',buttons:['Cancelar','Abrir arquivo'],defaultId:0,cancelId:0,message:'Abrir o arquivo baixado?',detail:d.filename});if(result.response===1){const error=await shell.openPath(d.filePath);if(error)throw new Error(error);}}
      }else engine.action(data);
      return snapshot();
    },
    'pause-all':()=>{engine.pauseAll();return snapshot();},
    'resume-all':()=>{engine.resumeAll();return snapshot();},
    settings:data=>{engine.configure({maxConcurrent:data?.maxConcurrent,connections:data?.connections});return snapshot();},
    folder:async()=>{const r=await dialog.showOpenDialog(win,{title:'Pasta dos novos downloads',defaultPath:engine.settings.downloadDir,properties:['openDirectory','createDirectory']});if(!r.canceled)engine.configure({downloadDir:r.filePaths[0]});return snapshot();},
    'copy-token':()=>{clipboard.writeText(token);return {ok:true};},
    'open-extension':async()=>{const err=await shell.openPath(extensionPath);if(err)throw new Error(err);return {ok:true};},
    window:action=>{if(action==='minimize')win.minimize();if(action==='maximize')win.isMaximized()?win.unmaximize():win.maximize();if(action==='close')win.close();return {ok:true};}
  };
  for(const [name,handler] of Object.entries(channels))ipcMain.handle('vela:'+name,(event,data)=>{
    if(event.sender!==win?.webContents || event.senderFrame?.url!==rootURL)throw new Error('Origem não autorizada.');
    return handler(data);
  });
  win=new BrowserWindow({width:1280,height:840,minWidth:900,minHeight:650,frame:false,backgroundColor:'#0d1117',
    title:'Vela — Seus downloads, no seu ritmo',icon:path.join(app.getAppPath(),'assets','vela.png'),
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(url!==rootURL)event.preventDefault();});
  win.webContents.session.setPermissionRequestHandler((webContents,permission,callback)=>callback(false));
  win.loadFile(root);
  const known=new Set(engine.downloads.filter(d=>d.status==='completed').map(d=>d.id));
  engine.on('update',()=>{
    if(!win?.isDestroyed())win.webContents.send('vela:update',snapshot());
    for(const d of engine.downloads)if(d.status==='completed'&&!known.has(d.id)){
      known.add(d.id);if(Notification.isSupported())new Notification({title:'Download concluído',body:d.filename,silent:true}).show();
    }
  });
  app.on('activate',()=>win?.show());
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{
  if(quitting||!engine)return;
  event.preventDefault();quitting=true;
  server?.close();engine.shutdown().finally(()=>app.quit());
});
}
