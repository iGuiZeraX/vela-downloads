# Conclusão no disco

Na versão 0.2.1 em desenvolvimento, receber o último byte não significa concluir o arquivo. A interface separa as fases Preparando arquivo, Salvando no disco e Confirmando gravação.

Durante a preparação e uma eventual cópia entre volumes, a barra representa os bytes escritos nessa fase. O progresso reinicia quando passa da preparação para a cópia, pois são operações distintas. O indicador permanece abaixo de 100% até a confirmação final. Ao terminar, a barra mostra 100% e Concluído, com o arquivo disponível na pasta de destino.

O motor espera o fechamento dos fluxos, valida o tamanho, solicita a sincronização do arquivo e aguarda a confirmação do sistema operacional antes de concluir. A mesma confirmação é aplicada ao arquivo final no destino. Isso não é uma nova leitura SHA-256 do arquivo inteiro nem uma garantia contra falhas de hardware que ignorem a sincronização.

A cópia de fallback entre volumes agora usa fluxo com progresso e criação exclusiva. Uma interrupção remove somente o destino parcial criado pela própria operação; arquivos preexistentes são preservados.

Os testes verificam a indicação abaixo de 100% enquanto a sincronização está bloqueada, integridade do resultado, contagem dos bytes escritos, preservação de um destino existente e limpeza da cópia parcial interrompida. Os ensaios de rede têm prazo maior para acomodar a confirmação real de disco em volumes ocupados.

Essa alteração está na proposta de atualização. Não foi aplicada ao Vela 0.1.0 em execução nem aos downloads pessoais em andamento. A assinatura pública continua pendente.
