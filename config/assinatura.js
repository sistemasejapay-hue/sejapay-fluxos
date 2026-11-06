// Configuração do envio de contratos para assinatura no Assinafy.
// Vale para os contratos White Label E Licenciado (config compartilhada).
// A chave da API e o ID da conta ficam nas variáveis da Cloudflare.
// Para mudar quem assina, edite este arquivo no GitHub: a Cloudflare publica sozinha.

export default {
  // Mensagem que os signatários recebem junto com o pedido de assinatura
  mensagem: "Olá! Segue o contrato da SejaPay para assinatura eletrônica. Qualquer dúvida, fale com a sua Consultora.",

  // Prazo para assinar, em dias (0 = sem prazo)
  prazoDias: 5,

  // Quem assina pela SejaPay. canal: "Email" ou "Whatsapp"
  sejapay: {
    nome: "Gleiriane Dourado Serja Lasse",
    email: "gleiriane@sejapay.com.br",
    whatsapp: "",
    cpf: "017.437.581-62",
    canal: "Email",
  },

  // Testemunha. canal: "Email" ou "Whatsapp"
  testemunhas: [
    { nome: "Carolina Goudinho Arrelaro", email: "Arrelaro17@gmail.com", whatsapp: "", cpf: "038.094.461-81", canal: "Email" },
  ],
};
