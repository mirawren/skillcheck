import type { LanguagePack } from "./types.js";

export const es: LanguagePack = {
  code: "es",
  name: "Spanish",
  endonym: "Español",
  scripts: ["latin"],
  stopwords: [
    "a", "al", "algo", "alguien", "ante", "antes", "aqui", "asi", "aunque", "bajo",
    "bien", "cada", "como", "con", "contra", "cual", "cuando", "de", "del", "desde",
    "donde", "dos", "el", "ella", "ellas", "ellos", "en", "entre", "era", "eran",
    "es", "esa", "esas", "ese", "eso", "esos", "esta", "estan", "estas", "este",
    "esto", "estos", "fue", "fueron", "ha", "habia", "han", "hace", "hacer",
    "hacia", "hasta", "hay", "la", "las", "le", "les", "lo", "los", "mas", "me",
    "mi", "mientras", "misma", "mismo", "mucho", "muy", "nos", "nosotros", "o",
    "otra", "otras", "otro", "otros", "para", "pero", "por", "porque", "puede",
    "pueden", "que", "se", "segun", "ser", "si", "sin", "sobre", "solo", "son",
    "su", "sus", "tambien", "tener", "tiene", "tienen", "todo", "todos", "tras",
    "tu", "un", "una", "unas", "uno", "unos", "usa", "usar", "uso", "usuario",
    "usuarios", "utiliza", "utilizar", "ya", "yo",
  ],
  markers: ["cuando", "tambien", "despues", "muy", "usuario", "solicitud", "habilidad"],
  triggerSignals: [
    /\bus[aeo](?:lo|la|se|r|rse|mos|n)?\b[^.]{0,25}\b(cuando|si|para|antes|despues|al|siempre)\b/,
    /\butiliza(?:r|lo|la|se|se)?\b[^.]{0,25}\b(cuando|si|antes|despues|al)\b/,
    /\bcuando\s+(el\s+usuario|la\s+usuaria|un\s+usuario|alguien|el\s+cliente|se\s+|pida|solicite|necesite|pregunte|quiera|haya)/,
    /\bsi\s+(el\s+usuario|un\s+usuario|alguien|se\s+(pide|solicita))\b/,
    /\bsiempre\s+que\b/,
    /\ben\s+casos?\s+de\b/,
    /\b(antes|despues)\s+de\s+\w/,
    /\bal\s+(crear|generar|editar|revisar|convertir|escribir|preparar|trabajar|hacer)\b/,
    /\bpara\s+(tareas|solicitudes|peticiones|casos|situaciones|preguntas|flujos)\b/,
    /\b(indicado|pensado|disenado|destinado|util)\s+(para|cuando)\b/,
    /\bse\s+(usa|utiliza|activa|aplica|invoca)\b/,
    /\baplica(?:r|ble|se)?\s+(cuando|si)\b/,
    /\bcasos?\s+de\s+uso\b/,
    /\binvoca(?:r|lo|la)?\b[^.]{0,25}\bcuando\b/,
  ],
  firstPerson: [
    /^\s*(yo|puedo|te\s+ayud|te\s+puedo)\b/,
    /\b(puedo|podre)\s+(ayudarte|asistirte|mostrarte|guiarte)\b/,
    /\bte\s+(ayudo|ayudare)\b/,
    /\bpuedes\s+usar\s+(esto|esta\s+habilidad)\b/,
  ],
  samples: {
    triggers: [
      "Genera informes PDF a partir de archivos Markdown con la plantilla de la empresa. Úsalo cuando el usuario pida crear un informe imprimible o exportar notas para imprimir.",
      "Revisa los cambios preparados en busca de errores y casos límite. Se usa antes de que el usuario haga un commit, o cuando pide una segunda revisión del diff.",
    ],
    capabilityOnly: [
      "Ofrece un conjunto completo de utilidades para la manipulación de archivos PDF y la extracción de sus tablas.",
    ],
  },
};
