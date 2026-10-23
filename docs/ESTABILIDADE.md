# Estabilidade de download - 0.2.1

O perfil automático começa com até oito conexões por arquivo e avalia o ganho de taxa a cada dois segundos. Cresce em passos de 50%, até 32, quando há ganho; se a taxa não cresce ao menos 10%, mantém o limite e espaça a próxima avaliação. A seleção manual continua disponível.

Ao receber HTTP 429 ou 503, o download reduz o limite uma única vez por rajada de um segundo. Todas as novas requisições desse arquivo respeitam o mesmo intervalo de espera. Retry-After é respeitado, inclusive quando excede os antigos 30 segundos. As conexões em andamento continuam transferindo. A recuperação aguarda 15 segundos após a espera antes de voltar a aumentar o paralelismo.

O indicador usa os bytes recebidos numa janela móvel de aproximadamente três segundos, medidos com relógio monotônico. Correções dos arquivos parciais no disco não entram no cálculo da taxa. O valor instantâneo e o limite de conexões ficam no texto de ajuda da velocidade. Uma parada real chega a zero depois da janela, e pausa/conclusão zeram o indicador. A média afeta apenas o indicador e a avaliação de crescimento; não limita a banda.

A fila continua reaproveitando conexões keep-alive. O planejamento reduz partes pequenas em arquivos grandes (alvo de 4 MiB por parte, limitado a 512 partes), preservando a validação e a compatibilidade com partes já salvas.

## Verificação

24 testes automatizados passaram localmente, incluindo integridade SHA-256, pausa/retomada, crescimento real além das oito conexões, limite manual de 32, espera compartilhada de Retry-After e queda da média a zero numa interrupção.

`STABILITY-BENCHMARK.json` contém duas execuções por motor sobre um servidor local: arquivo de 32 MiB, no máximo quatro requisições simultâneas e resposta HTTP 429 com espera de um segundo para excesso. A versão 0.2.0 recebeu 28 recusas em cada execução e terminou usando uma conexão. A alteração recebeu quatro recusas em cada execução e manteve quatro conexões. Os tempos foram 16,985/16,718 s antes e 5,866/5,141 s depois. Os arquivos tiveram SHA-256 idêntico.

O coeficiente de variação registrado não demonstra redução uniforme da oscilação real: o primeiro ensaio novo variou mais e o segundo menos que o anterior. Partida, espera e poucos segundos de amostragem afetam a comparação, e houve outros testes locais durante parte da medição. A suavização do indicador foi verificada separadamente com uma sequência determinística de rajadas. Não se deve usar a suavização como prova de estabilidade da rede.

O ensaio não mediu IDM, banda do provedor, TLS, servidores públicos ou estabilidade de longa duração. Para comparar os aplicativos, usar o mesmo link direto, um download de cada vez, mesma rede e disco, várias execuções e comparar tempo total/bytes e taxa por segundo, além do número exibido.

## Distribuição

A alteração do código não resolve a assinatura pendente do Windows. A versão 0.2.1 permanece sem assinatura e sua abertura nativa nesta máquina não foi validada. O iniciador da versão 0.1.0 não foi alterado.

Referência conceitual: [documentação oficial do IDM sobre segmentação e reutilização de conexões](https://www.internetdownloadmanager.com/support/segmentation.html). Nenhum código proprietário foi incorporado e não há alegação de equivalência de desempenho.
