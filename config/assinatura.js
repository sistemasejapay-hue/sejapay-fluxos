// Configuracao do envio de contratos para assinatura no Assinafy.
// A chave da API e o ID da conta ficam nas variaveis da Cloudflare.
// Para mudar quem assina, edite este arquivo no GitHub: a Cloudflare publica sozinha.

export default {
  mensagem: "Ola! Segue o contrato White Label da SejaPay para assinatura eletronica. Qualquer duvida, fale com a sua Consultora.",
  prazoDias: 5,
  sejapay: {
    nome: "Caio Lasse Alves",
    email: "caio@sejapay.com.br",
    whatsapp: "",
    cpf: "011.734.691-84",
    canal: "Email",
  },
  testemunhas: [
    { nome: "Gleiriane Dourado Serja Lasse", email: "gleiriane@sejapay.com.br", whatsapp: "", cpf: "017.437.581-62", canal: "Email" },
    ],
};
