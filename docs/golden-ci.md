# Golden Production

A suíte de produção usa autenticação de serviço assinada e não depende de sessão do navegador. Configure o mesmo segredo de serviço na hospedagem e nos secrets do workflow. Depois disso, cada execução autentica automaticamente.

O projeto informado ao workflow precisa existir e pertencer ao owner. Ele pode ser antigo e não publicado: a rota Golden usa o registro somente para validar a propriedade e não persiste nele os cinco aplicativos avaliados.
