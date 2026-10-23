// Read-only release gate. Does not change Windows policies or certificate stores.
const path=require('node:path');
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const root=path.resolve(process.argv[2]||path.join(__dirname,'../release',require('../package.json').version,'Vela-win32-x64'));
if(!fs.existsSync(path.join(root,'Vela.exe')))throw new Error('Distribuição Vela não encontrada. Informe a pasta do executável.');
const command=`$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$root=[System.IO.Path]::GetFullPath($env:VELA_VERIFY_ROOT)
$files=@(Get-ChildItem -LiteralPath $root -File -Recurse | Where-Object {$_.Extension -in '.exe','.dll','.node'} | ForEach-Object {
 $signature=Get-AuthenticodeSignature -LiteralPath $_.FullName
 [pscustomobject]@{file=$_.FullName.Substring($root.Length+1);signature=[string]$signature.Status;signer=$signature.SignerCertificate.Subject}
})
ConvertTo-Json -InputObject $files -Depth 4 -Compress`;
const env={...process.env,VELA_VERIFY_ROOT:root};
const options={encoding:'utf8',env,windowsHide:true,maxBuffer:1024*1024};
const args=['-NoProfile','-NonInteractive','-Command',command];
let text;
try{text=execFileSync('pwsh.exe',args,options);}
catch(error){
 if(error.code!=='ENOENT')throw error;
 // Windows PowerShell needs its own default module paths, not inherited PS7 modules.
 const legacyEnv={...env};delete legacyEnv.PSModulePath;
 text=execFileSync('powershell.exe',args,{...options,env:legacyEnv});
}
const files=JSON.parse(text.replace(/^\uFEFF/,''));
if(!Array.isArray(files)||!files.length)throw new Error('Nenhum binário foi verificado.');
const failures=files.filter(f=>f.signature!=='Valid');
const report={checkedAt:new Date().toISOString(),root,allSignaturesValid:failures.length===0,files,limitation:'Valida Authenticode no Windows local. Não comprova por si só a aceitação pelo Smart App Control nem substitui teste do aplicativo com essa proteção ativa.'};
fs.mkdirSync(path.resolve(__dirname,'../docs'),{recursive:true});
fs.writeFileSync(path.resolve(__dirname,'../docs/SIGNATURES.json'),JSON.stringify(report,null,2)+'\n');
if(failures.length){console.error(`Distribuição ainda não assinada: ${failures.length} de ${files.length} binários sem assinatura válida. É necessário certificado ou serviço de assinatura confiável.`);process.exitCode=1;}
else console.log('Todos os binários apresentam assinatura Authenticode válida. Falta confirmar a aceitação pelo Smart App Control em teste real.');
