# Processos SejaPay

Site interno da equipe SejaPay, publicado pela Cloudflare Pages, e conector **SejaPay Assinafy** para o Claude.

- `/` fluxograma White Label, mensagens padrão e gerador de contrato
- `/fluxo/` só o fluxograma
- `/contrato/` gerador do contrato White Label, com PDF e envio ao Assinafy
- `/mcp/<MCP_TOKEN>` conector do Claude que envia contratos ao Assinafy (usado pela Jornada do cliente no Claude)

A lógica do envio fica em `lib/assinafy.js` e é a mesma para o site e para o conector.

## 1. Publicar na Cloudflare (uma vez)

1. Cloudflare > **Workers e Pages** > **Criar** > **Pages** > **Conectar ao Git**, e escolha este repositório.
2. Configurações de build:
   - Framework: **Nenhum**
   - Comando de build: deixe em branco
   - Diretório de saída: **public**
3. Depois do primeiro deploy, em **Configurações > Variáveis e segredos**, adicione:
   - `ASSINAFY_API_KEY` como **Secreto** (chave da API do Assinafy)
   - `ASSINAFY_ACCOUNT_ID` (ID da conta do Assinafy)
   - `ASSINAFY_AMBIENTE` = `producao` (ou `sandbox` para testes)
   - `MCP_TOKEN` como **Secreto**: uma senha longa e aleatória, por exemplo 32 letras e números
4. Em **Implantações**, refaça o último deploy para as variáveis valerem.
5. Proteja o site com **Cloudflare Access** (Zero Trust > Access > Aplicativos), liberando só os e-mails da equipe.
   No Access, deixe o caminho `/mcp/*` **fora** da proteção (regra "Bypass"): o Claude chama esse endereço direto,
   e ele já é protegido pelo `MCP_TOKEN`.

## 2. Adicionar o conector no Claude

1. No Claude: **Configurações > Conectores > Adicionar conector personalizado**.
2. Nome: **SejaPay Assinafy** (exatamente assim, a página da Jornada procura esse nome).
3. URL: `https://<seu-projeto>.pages.dev/mcp/<MCP_TOKEN>`
4. Salve. Cada pessoa da equipe que for enviar contratos precisa ter o conector na própria conta
   (em plano Team ou Enterprise, o administrador pode adicionar para a organização inteira).

Trate o endereço do conector como senha: quem tiver o endereço completo consegue enviar contratos pela conta do Assinafy.
Para trocar, mude o `MCP_TOKEN` na Cloudflare e atualize o endereço do conector.

## Quem assina

Edite `config/assinatura.js` para mudar quem assina pela SejaPay, as testemunhas, a mensagem e o prazo.
A chave da API **nunca** vai neste repositório.
