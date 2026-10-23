# Vela

Gerenciador de downloads de código aberto para Windows x64. Interface somente em modo escuro, fila persistente, pausa e retomada, até 32 conexões por arquivo e extensão Chrome opcional. Licença MIT.

## Estado da distribuição

Versão 0.2.0. Os binários atuais ainda não têm assinatura pública de código. O Smart App Control pode bloquear sua execução. Nenhum certificado ou provedor de assinatura foi aprovado para este projeto. Não são feitas alterações nas proteções do Windows.

## Funcionalidades

- Links diretos HTTP/HTTPS, redirecionamentos e nomes de arquivo definidos pelo servidor.
- Até oito arquivos simultâneos; perfil automático com até 32 conexões por arquivo, sem limite de banda imposto pelo Vela.
- Retomada com validação de tamanho e identificador; distribuição das partes entre conexões livres, keep-alive e redução do paralelismo quando o servidor limita conexões.
- Busca, histórico, pasta configurável, velocidade e progresso.
- Extensão Chrome Manifest V3 para enviar links e assumir downloads de forma opcional.

A taxa depende da rede, do servidor e do disco. O projeto não promete equivalência completa ao IDM. Não inclui login/cookies, extração de YouTube, HLS/DASH, DRM, FTP ou agendamento. Uma URL de página pode resultar no download do HTML.

## Desenvolvimento

Node.js 24+, npm e Windows x64 para compilar o pacote desta versão.

```powershell
npm ci
node node_modules/electron/install.js
npm test
npm start
npm run package
```

A distribuição fica em `release/0.2.0/Vela-win32-x64`. A extensão fica em `resources/extension`. Para conectá-la, abra Conectar ao Chrome no aplicativo, carregue essa pasta em chrome://extensions e cole o código de conexão no popup. A captura automática começa desligada.

`node scripts/benchmark.cjs` executa uma comparação local controlada, não um teste da internet. `node scripts/verify-signatures.cjs` verifica assinaturas, retornando erro enquanto houver componentes sem assinatura válida.

## Privacidade

O Vela não usa conta nem envia telemetria. Faz solicitações aos links que o usuário adiciona e salva arquivos localmente. A extensão comunica-se apenas com o receptor local autenticado do aplicativo em 127.0.0.1:17839. URLs, histórico e o código de conexão são armazenados no perfil local e não fazem parte do repositório.

## Compilação verificável

O workflow [Windows build](../../actions/workflows/windows.yml) instala as dependências do lockfile, executa os testes e compila a distribuição Windows. Os artefatos são explicitamente identificados como **unsigned**, acompanhados de SHA-256. Eles ainda podem ser bloqueados pelo Smart App Control.

## Code signing policy

Veja [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md). O projeto ainda não foi inscrito ou aprovado em um programa de assinatura.
