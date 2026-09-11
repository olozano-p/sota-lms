/**
 * Source catalog. Every user-facing string lives here; `es.ts` and `en.ts` must provide the same
 * keys (enforced by the `Record<MessageKey, string>` type). Placeholders are `{name}`.
 */
export const ca = {
  "app.skipToContent": "Salta al contingut",
  "app.poweredBy": "Fet amb Lodrö",
  "app.signedInAs": "Has entrat com a {name}",

  "nav.courses": "Els meus cursos",
  "nav.teach": "Ensenyar",
  "nav.admin": "Administració",
  "nav.login": "Entra",
  "nav.logout": "Surt",
  "nav.account": "Compte",

  "locale.label": "Idioma",
  "theme.toggle": "Canvia el mode fosc",

  "common.loading": "Carregant…",
  "common.save": "Desa",
  "common.saved": "Desat",
  "common.saving": "Desant…",
  "common.cancel": "Cancel·la",
  "common.confirm": "Confirma",
  "common.back": "Enrere",
  "common.close": "Tanca",
  "common.edit": "Edita",
  "common.delete": "Suprimeix",
  "common.add": "Afegeix",
  "common.remove": "Treu",
  "common.search": "Cerca",
  "common.empty": "No hi ha res aquí encara.",
  "common.error": "Alguna cosa ha fallat. Torna-ho a provar.",
  "common.retry": "Torna-ho a provar",
  "common.yes": "Sí",
  "common.no": "No",
  "common.continue": "Continua",
  "common.next": "Següent",
  "common.previous": "Anterior",
  "common.optional": "opcional",
  "common.required": "obligatori",
  "common.minutes": "{n} min",
  "common.percent": "{n} %",
  "common.date": "Data",
  "common.status": "Estat",
  "common.actions": "Accions",
  "common.name": "Nom",
  "common.email": "Correu",
  "common.title": "Títol",
  "common.none": "Cap",

  "error.notFound.title": "No s'ha trobat la pàgina",
  "error.notFound.lead": "L'adreça no existeix o el contingut ja no hi és.",
  "error.forbidden.title": "No hi tens accés",
  "error.forbidden.lead": "Aquest contingut no forma part dels teus cursos.",
  "error.generic.title": "S'ha produït un error",
  "error.generic.lead": "Torna-ho a provar en uns instants. Si persisteix, avisa'ns.",
  "error.goHome": "Torna als cursos",

  "home.title": "Un lloc tranquil per aprendre",
  "home.lead": "Entra amb el teu compte per veure els cursos als quals tens accés.",
  "home.cta": "Entra",
} as const;

export type MessageKey = keyof typeof ca;
