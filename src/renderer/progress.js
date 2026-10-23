(function(root){
  function progressState(d){
    if(d.status==='completed')return {percent:100,finalizing:false,label:'✓ Concluído'};
    const labels={assembling:'Preparando arquivo',copying:'Salvando no disco',syncing:'Confirmando gravação'};
    const finalizing=d.status==='downloading'&&Object.hasOwn(labels,d.phase);
    const received=d.size>0?d.downloaded/d.size*100:0;
    const written=d.diskTotal>0?d.diskWritten/d.diskTotal*100:0;
    return {percent:Math.min(99,Math.max(0,finalizing?(d.phase==='syncing'?99:written):received)),finalizing,label:finalizing?labels[d.phase]:null};
  }
  if(typeof module!=='undefined'&&module.exports)module.exports=progressState;
  else root.velaProgress=progressState;
})(typeof window!=='undefined'?window:globalThis);
