import { Proposta } from '@/lib/crm-types';
import { MessageCircle, Mail, Phone } from 'lucide-react';

interface Props {
  proposta: Proposta;
}

export function RodapeSection({ proposta }: Props) {
  const { rodape, visual } = proposta;
  const corPrimaria = visual.cor_primaria || '#004aad';

  return (
    <div className="border-t border-gray-200 mt-12 pt-8 pb-12">
      {rodape.mensagem && (
        <p className="text-center text-lg opacity-70 max-w-2xl mx-auto mb-8 italic">
          {rodape.mensagem}
        </p>
      )}

      <div className="text-center">
        {rodape.nome_vendedor && (
          <p className="font-semibold text-lg">{rodape.nome_vendedor}</p>
        )}
        <div className="flex items-center justify-center gap-4 mt-3 text-sm opacity-70">
          {rodape.whatsapp_vendedor && (
            <a
              href={`https://wa.me/55${rodape.whatsapp_vendedor.replace(/\D/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:opacity-100"
              style={{ color: corPrimaria }}
            >
              <MessageCircle className="w-4 h-4" /> {rodape.whatsapp_vendedor}
            </a>
          )}
          {rodape.telefone_vendedor && (
            <span className="flex items-center gap-1">
              <Phone className="w-4 h-4" /> {rodape.telefone_vendedor}
            </span>
          )}
          {rodape.email_vendedor && (
            <a href={`mailto:${rodape.email_vendedor}`} className="flex items-center gap-1 hover:opacity-100" style={{ color: corPrimaria }}>
              <Mail className="w-4 h-4" /> {rodape.email_vendedor}
            </a>
          )}
        </div>
      </div>

      <div className="text-center text-xs opacity-30 mt-8">
        Proposta gerada por Entur OS
      </div>
    </div>
  );
}
