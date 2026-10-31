# Processos SejaPay

Site interno da equipe SejaPay, publicado pela Cloudflare Pages.

- `/` página inicial com os processos
- `/fluxo/` fluxograma do cliente White Label e mensagens padrão
- `/contrato/` gerador do contrato White Label, com PDF e envio ao Assinafy

## Configuração na Cloudflare (uma vez)

1. Cloudflare > **Workers e Pages** > **Criar** > **Pages** > **Conectar ao Git**, e escolha este repositório.
2. Configurações de build:
   - Framework: **Nenhum**
   - Comando de build: deixe em branco
   - Diretório de saída: **public**
3. Depois do primeiro deploy, em **Configurações > Variáveis e segredos**, adicione:
   - `ASSINAFY_API_KEY` como **Secreto** (chave da API do Assinafy)
   - `ASSINAFY_ACCOUNT_ID` (ID da conta do Assinafy)
   - `ASSINAFY_AMBIENTE` = `producao` (ou `sandbox` para testes)
4. Faça um novo deploy para as variáveis valerem.
5. Proteja o site com **Cloudflare Access** (Zero Trust > Access > Aplicativos), liberando só os e-mails da equipe.

## Quem assina

Edite `config/assinatura.js` para mudar quem assina pela SejaPay, as testemunhas, a mensagem e o prazo.
A chave da API **nunca** vai neste repositório.
