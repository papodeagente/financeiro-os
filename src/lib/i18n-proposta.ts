export type IdiomaProposal = 'pt-BR' | 'en' | 'es';

interface Translations {
  // CapaSection
  suaProposta: string;
  // PreviewRenderer
  oQueEstaIncluso: string;
  naoIncluso: string;
  viajouPara: string;
  entrarEmContato: string;
  // AceitarProposta
  aceitarProposta: string;
  solicitarAlteracoes: string;
  nomeCompleto: string;
  liEConcordo: string;
  termosCondicoes: string;
  confirmarAceite: string;
  propostaAceita: string;
  obrigadoAceite: string;
  voltarContato: string;
  suaSolicitacao: string;
  enviarSolicitacao: string;
  feedbackEnviado: string;
  obrigadoFeedback: string;
  // LeadCapture
  interesseViagem: string;
  nomeLeadPlaceholder: string;
  emailLeadPlaceholder: string;
  telefonePlaceholder: string;
  mensagemPlaceholder: string;
  enviarLead: string;
  obrigadoLead: string;
  retornoBreve: string;
  // Countdown
  dias: string;
  horas: string;
  minutos: string;
  grandiaDiaChegou: string;
  // FAQ
  perguntasFrequentes: string;
  // Validade
  validaAte: string;
  // Geral
  carregando: string;
  propostaNaoEncontrada: string;
  linkExpirado: string;
  contateAgente: string;
  // Discovery
  inicio: string;
  resumoAlojamentos: string;
  resumoTransportes: string;
  mapaRota: string;
  itinerario: string;
  precos: string;
  reserveAgora: string;
  voos: string;
  transfers: string;
  checkIn: string;
  checkOut: string;
  noites: string;
  estadia: string;
  regime: string;
  base: string;
  alojamento: string;
  destino: string;
  distancia: string;
  tempoEstimado: string;
  introducao: string;
  termos: string;
  sobreAgencia: string;
  embarque: string;
  desembarque: string;
  regimeRO: string;
  regimeBB: string;
  regimeHB: string;
  regimeFB: string;
  regimeAI: string;
  viagemNoturna: string;
  fimItinerario: string;
  conecteSe: string;
}

const translations: Record<IdiomaProposal, Translations> = {
  'pt-BR': {
    suaProposta: 'Sua Proposta de Viagem',
    oQueEstaIncluso: 'O que esta incluso',
    naoIncluso: 'Nao incluso',
    viajouPara: 'Viajou para',
    entrarEmContato: 'Entrar em contato',
    aceitarProposta: 'Aceitar Proposta',
    solicitarAlteracoes: 'Solicitar Alteracoes',
    nomeCompleto: 'Nome completo',
    liEConcordo: 'Li e concordo com os',
    termosCondicoes: 'termos e condicoes',
    confirmarAceite: 'Confirmar Aceite',
    propostaAceita: 'Proposta Aceita!',
    obrigadoAceite: 'Obrigado! Sua aceitacao foi registrada.',
    voltarContato: 'entraremos em contato em breve.',
    suaSolicitacao: 'Descreva as alteracoes desejadas...',
    enviarSolicitacao: 'Enviar Solicitacao',
    feedbackEnviado: 'Solicitacao Enviada!',
    obrigadoFeedback: 'Obrigado! Recebemos sua solicitacao.',
    interesseViagem: 'Tem interesse nesta viagem?',
    nomeLeadPlaceholder: 'Seu nome',
    emailLeadPlaceholder: 'Seu email',
    telefonePlaceholder: 'Seu telefone',
    mensagemPlaceholder: 'Mensagem (opcional)',
    enviarLead: 'Quero saber mais!',
    obrigadoLead: 'Obrigado pelo interesse!',
    retornoBreve: 'Entraremos em contato em breve.',
    dias: 'dias',
    horas: 'horas',
    minutos: 'min',
    grandiaDiaChegou: 'O grande dia chegou!',
    perguntasFrequentes: 'Perguntas Frequentes',
    validaAte: 'Proposta valida ate',
    carregando: 'Carregando proposta...',
    propostaNaoEncontrada: 'Proposta nao encontrada',
    linkExpirado: 'Este link pode ter expirado ou a proposta foi removida.',
    contateAgente: 'Entre em contato com seu agente de viagens para obter um novo link.',
    inicio: 'Inicio',
    resumoAlojamentos: 'Resumo dos Alojamentos',
    resumoTransportes: 'Resumo de Transportes',
    mapaRota: 'Mapa da Rota',
    itinerario: 'Itinerario',
    precos: 'Precos',
    reserveAgora: 'Reserve Agora',
    voos: 'Voos',
    transfers: 'Transfers',
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    noites: 'Noites',
    estadia: 'Estadia',
    regime: 'Regime',
    base: 'Base',
    alojamento: 'Alojamento',
    destino: 'Destino',
    distancia: 'Distancia',
    tempoEstimado: 'Tempo estimado',
    introducao: 'Introducao',
    termos: 'Termos e Condicoes',
    sobreAgencia: 'Sobre',
    embarque: 'Embarque',
    desembarque: 'Desembarque',
    regimeRO: 'Somente Hospedagem',
    regimeBB: 'Cafe da Manha',
    regimeHB: 'Meia Pensao',
    regimeFB: 'Pensao Completa',
    regimeAI: 'All Inclusive',
    viagemNoturna: 'Viagem noturna',
    fimItinerario: 'Fim do Itinerario',
    conecteSe: 'Conecte-se com',
  },
  en: {
    suaProposta: 'Your Travel Proposal',
    oQueEstaIncluso: 'What\'s included',
    naoIncluso: 'Not included',
    viajouPara: 'Traveled to',
    entrarEmContato: 'Get in touch',
    aceitarProposta: 'Accept Proposal',
    solicitarAlteracoes: 'Request Changes',
    nomeCompleto: 'Full name',
    liEConcordo: 'I have read and agree to the',
    termosCondicoes: 'terms and conditions',
    confirmarAceite: 'Confirm Acceptance',
    propostaAceita: 'Proposal Accepted!',
    obrigadoAceite: 'Thank you! Your acceptance has been recorded.',
    voltarContato: 'we will contact you shortly.',
    suaSolicitacao: 'Describe the changes you would like...',
    enviarSolicitacao: 'Send Request',
    feedbackEnviado: 'Request Sent!',
    obrigadoFeedback: 'Thank you! We received your request.',
    interesseViagem: 'Interested in this trip?',
    nomeLeadPlaceholder: 'Your name',
    emailLeadPlaceholder: 'Your email',
    telefonePlaceholder: 'Your phone',
    mensagemPlaceholder: 'Message (optional)',
    enviarLead: 'I want to know more!',
    obrigadoLead: 'Thank you for your interest!',
    retornoBreve: 'We will contact you shortly.',
    dias: 'days',
    horas: 'hours',
    minutos: 'min',
    grandiaDiaChegou: 'The big day is here!',
    perguntasFrequentes: 'Frequently Asked Questions',
    validaAte: 'Valid until',
    carregando: 'Loading proposal...',
    propostaNaoEncontrada: 'Proposal not found',
    linkExpirado: 'This link may have expired or the proposal has been removed.',
    contateAgente: 'Contact your travel agent for a new link.',
    inicio: 'Home',
    resumoAlojamentos: 'Accommodation Summary',
    resumoTransportes: 'Transport Summary',
    mapaRota: 'Route Map',
    itinerario: 'Itinerary',
    precos: 'Pricing',
    reserveAgora: 'Book Now',
    voos: 'Flights',
    transfers: 'Transfers',
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    noites: 'Nights',
    estadia: 'Stay',
    regime: 'Meal Plan',
    base: 'Basis',
    alojamento: 'Accommodation',
    destino: 'Destination',
    distancia: 'Distance',
    tempoEstimado: 'Estimated time',
    introducao: 'Introduction',
    termos: 'Terms & Conditions',
    sobreAgencia: 'About',
    embarque: 'Pickup',
    desembarque: 'Dropoff',
    regimeRO: 'Room Only',
    regimeBB: 'Bed & Breakfast',
    regimeHB: 'Half Board',
    regimeFB: 'Full Board',
    regimeAI: 'All Inclusive',
    viagemNoturna: 'Overnight travel',
    fimItinerario: 'End of Itinerary',
    conecteSe: 'Connect with',
  },
  es: {
    suaProposta: 'Tu Propuesta de Viaje',
    oQueEstaIncluso: 'Lo que esta incluido',
    naoIncluso: 'No incluido',
    viajouPara: 'Viajo a',
    entrarEmContato: 'Contactar',
    aceitarProposta: 'Aceptar Propuesta',
    solicitarAlteracoes: 'Solicitar Cambios',
    nomeCompleto: 'Nombre completo',
    liEConcordo: 'He leido y acepto los',
    termosCondicoes: 'terminos y condiciones',
    confirmarAceite: 'Confirmar Aceptacion',
    propostaAceita: 'Propuesta Aceptada!',
    obrigadoAceite: 'Gracias! Tu aceptacion ha sido registrada.',
    voltarContato: 'nos pondremos en contacto pronto.',
    suaSolicitacao: 'Describa los cambios deseados...',
    enviarSolicitacao: 'Enviar Solicitud',
    feedbackEnviado: 'Solicitud Enviada!',
    obrigadoFeedback: 'Gracias! Recibimos su solicitud.',
    interesseViagem: 'Te interesa este viaje?',
    nomeLeadPlaceholder: 'Tu nombre',
    emailLeadPlaceholder: 'Tu email',
    telefonePlaceholder: 'Tu telefono',
    mensagemPlaceholder: 'Mensaje (opcional)',
    enviarLead: 'Quiero saber mas!',
    obrigadoLead: 'Gracias por tu interes!',
    retornoBreve: 'Nos pondremos en contacto pronto.',
    dias: 'dias',
    horas: 'horas',
    minutos: 'min',
    grandiaDiaChegou: 'El gran dia ha llegado!',
    perguntasFrequentes: 'Preguntas Frecuentes',
    validaAte: 'Valida hasta',
    carregando: 'Cargando propuesta...',
    propostaNaoEncontrada: 'Propuesta no encontrada',
    linkExpirado: 'Este enlace puede haber expirado o la propuesta fue eliminada.',
    contateAgente: 'Contacte a su agente de viajes para obtener un nuevo enlace.',
    inicio: 'Inicio',
    resumoAlojamentos: 'Resumen de Alojamientos',
    resumoTransportes: 'Resumen de Transportes',
    mapaRota: 'Mapa de Ruta',
    itinerario: 'Itinerario',
    precos: 'Precios',
    reserveAgora: 'Reserve Ahora',
    voos: 'Vuelos',
    transfers: 'Transfers',
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    noites: 'Noches',
    estadia: 'Estadia',
    regime: 'Regimen',
    base: 'Base',
    alojamento: 'Alojamiento',
    destino: 'Destino',
    distancia: 'Distancia',
    tempoEstimado: 'Tiempo estimado',
    introducao: 'Introduccion',
    termos: 'Terminos y Condiciones',
    sobreAgencia: 'Acerca de',
    embarque: 'Embarque',
    desembarque: 'Desembarque',
    regimeRO: 'Solo Alojamiento',
    regimeBB: 'Desayuno Incluido',
    regimeHB: 'Media Pension',
    regimeFB: 'Pension Completa',
    regimeAI: 'Todo Incluido',
    viagemNoturna: 'Viaje nocturno',
    fimItinerario: 'Fin del Itinerario',
    conecteSe: 'Conectese con',
  },
};

export function t(idioma: IdiomaProposal = 'pt-BR'): Translations {
  return translations[idioma] || translations['pt-BR'];
}

export const IDIOMAS: { id: IdiomaProposal; label: string; flag: string }[] = [
  { id: 'pt-BR', label: 'Portugues', flag: '🇧🇷' },
  { id: 'en', label: 'English', flag: '🇺🇸' },
  { id: 'es', label: 'Espanol', flag: '🇪🇸' },
];
