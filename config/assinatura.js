// Configuração do envio de contratos para assinatura no Assinafy.
// Este arquivo NÃO tem a chave da API. A chave e o ID da conta ficam
// nas variáveis do projeto na Cloudflare (ASSINAFY_API_KEY e ASSINAFY_ACCOUNT_ID).
// Para mudar quem assina, edite este arquivo no GitHub: a Cloudflare publica sozinha.

export default {
  // Mensagem que os signatários recebem junto com o pedido de assinatura
  mensagem: "Olá! Segue o contrato White Label da SejaPay para assinatura eletrônica. Qualquer dúvida, fale com a sua Consultora.",

  // Prazo para assinar, em dias (0 = sem prazo)
  prazoDias: 7,

  // Quem assina pela SejaPay. canal: "Email" ou "Whatsapp"
  sejapay: {
    nome: "NOME DE QUEM ASSINA PELA SEJAPAY",
    email: "email@sejapay.com.br",
    whatsapp: "",
    cpf: "",
    canal: "Email",
  },

  // As duas testemunhas de costume. canal: "Email" ou "Whatsapp"
  testemunhas: [
    { nome: "TESTEMUNHA 1", email: "testemunha1@sejapay.com.br", whatsapp: "", cpf: "", canal: "Email" },
    { nome: "TESTEMUNHA 2", email: "testemunha2@sejapay.com.br", whatsapp: "", cpf: "", canal: "Email" },
  ],
};
