import type { LanguagePack } from "./types.js";

export const pt: LanguagePack = {
  code: "pt",
  name: "Portuguese",
  endonym: "Português",
  scripts: ["latin"],
  stopwords: [
    "a", "ao", "aos", "apos", "aqui", "as", "ate", "cada", "com", "como", "da",
    "das", "de", "dele", "dela", "depois", "desde", "do", "dos", "e", "ela",
    "elas", "ele", "eles", "em", "entao", "entre", "era", "eram", "essa", "esse",
    "esta", "estao", "estas", "este", "estes", "eu", "foi", "foram", "isso",
    "isto", "ja", "la", "mais", "mas", "me", "mesmo", "meu", "muito", "na", "nao",
    "nas", "nem", "no", "nos", "nossa", "nosso", "num", "numa", "o", "os", "ou",
    "para", "pela", "pelo", "pode", "podem", "por", "porque", "qual", "quando",
    "que", "se", "sem", "sempre", "sendo", "ser", "seu", "seus", "sob", "sobre",
    "sua", "suas", "tambem", "tem", "tenha", "ter", "todo", "todos", "tu", "um",
    "uma", "usa", "usar", "uso", "usuario", "usuarios", "utilizar", "voce",
    "voces", "vos",
  ],
  markers: ["quando", "tambem", "depois", "muito", "nao", "voce", "entao", "utilizacao"],
  triggerSignals: [
    /\bus[ae](?:r|-o|-a|se|mos|em)?\b[^.]{0,25}\b(quando|se|antes|depois|ao|sempre)\b/,
    /\butiliz[ae](?:r|-o|se|em)?\b[^.]{0,25}\b(quando|se|antes|depois|ao)\b/,
    /\bquando\s+(o\s+usuario|a\s+usuaria|um\s+usuario|alguem|o\s+cliente|pedir|solicitar|precisar|perguntar|quiser)/,
    /\bse\s+(o\s+usuario|um\s+usuario|alguem)\b/,
    /\bsempre\s+que\b/,
    /\bem\s+casos?\s+de\b/,
    /\b(antes|depois)\s+de\s+\w/,
    /\bao\s+(criar|gerar|editar|revisar|converter|escrever|preparar|trabalhar|fazer)\b/,
    /\bpara\s+(tarefas|solicitacoes|pedidos|casos|situacoes|perguntas|fluxos)\b/,
    /\b(indicado|pensado|projetado|destinado|util)\s+(para|quando)\b/,
    /\bse\s+(aplica|usa|utiliza|ativa)\b/,
    /\bcasos?\s+de\s+uso\b/,
    /\bdeve\s+ser\s+(usad|utilizad)/,
  ],
  firstPerson: [
    /^\s*(eu|posso|vou)\b/,
    /\b(posso|poderei)\s+(ajudar|auxiliar|mostrar|guiar)\b/,
    /\bvoce\s+pode\s+usar\s+(isto|isso|esta\s+habilidade)\b/,
  ],
  samples: {
    triggers: [
      "Gera relatórios PDF a partir de arquivos Markdown com o modelo da empresa. Use quando o usuário pedir para criar um relatório imprimível ou exportar notas para impressão.",
      "Revisa as alterações preparadas em busca de erros e casos extremos. Aplica-se ao criar um commit, ou quando o usuário pede uma segunda revisão do diff.",
    ],
    capabilityOnly: [
      "Oferece um conjunto completo de utilitários para a manipulação de arquivos PDF e a extração de suas tabelas.",
    ],
  },
};
